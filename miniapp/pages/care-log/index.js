const { listPets, listCareLogs, createCareLog, listCareReminders, createCareReminder, completeCareReminder } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');
const { track } = require('../../utils/analytics');

const draftFields = ['note', 'value', 'kindIndex', 'reminderTitle', 'reminderDate', 'reminderTime'];
function emptyDraft() {
  return { note: '', value: '', kindIndex: 0, reminderTitle: '', reminderDate: formatDateTime(Date.now() + 86400000).slice(0, 10), reminderTime: '09:00' };
}

Page({
  data: { pets: [], petIndex: 0, selectedPetId: '', kinds: ['喂食', '饮水', '清洁', '体重', '观察'], kindIndex: 0, logs: [], note: '', value: '', loading: true, submitting: false, reminders: [], reminderTitle: '', reminderDate: '', reminderTime: '09:00', reminding: false, completingId: '', error: '' },

  onShow() {
    if (this.isWriting()) return;
    if (!this.data.reminderDate) this.setData({ reminderDate: formatDateTime(Date.now() + 86400000).slice(0, 10) });
    return this.loadData();
  },

  isWriting() { return this.data.submitting || this.data.reminding || Boolean(this.data.completingId); },
  isBusy() { return this.data.loading || this.isWriting(); },

  selectPet(pets, petIndex) {
    const selectedPetId = pets[petIndex] ? pets[petIndex].id : '';
    const previous = this.data.selectedPetId;
    let draft = {};
    if (selectedPetId !== previous) {
      if (!this.petDrafts) this.petDrafts = new Map();
      if (previous && pets.some((pet) => pet.id === previous)) {
        this.petDrafts.set(previous, Object.fromEntries(draftFields.map((field) => [field, this.data[field]])));
      } else if (previous) this.petDrafts.delete(previous);
      draft = this.petDrafts.get(selectedPetId) || emptyDraft();
    }
    this.setData({ pets, petIndex, selectedPetId, ...draft });
  },

  async loadData() {
    const sequence = (this.loadSequence || 0) + 1; this.loadSequence = sequence;
    this.setData({ loading: true, error: '', logs: [], reminders: [] });
    try {
      const petsResult = await listPets();
      if (sequence !== this.loadSequence) return;
      const pets = petsResult.pets || [];
      const petIndex = Math.max(0, pets.findIndex((pet) => pet.id === this.data.selectedPetId));
      this.selectPet(pets, petIndex);
      const [logsResult, remindersResult] = pets.length ? await Promise.all([listCareLogs({ petId: pets[petIndex].id }), listCareReminders({ petId: pets[petIndex].id })]) : [{ logs: [] }, { reminders: [] }];
      if (sequence !== this.loadSequence) return;
      this.setData({ pets, petIndex, logs: (logsResult.logs || []).map((item) => ({ ...item, displayTime: formatDateTime(item.recordedAt) })), reminders: (remindersResult.reminders || []).map((item) => ({ ...item, displayTime: formatDateTime(item.dueAt), overdue: !item.completedAt && new Date(item.dueAt).getTime() <= Date.now() })), loading: false });
    } catch (error) { if (sequence === this.loadSequence) this.setData({ loading: false, error: '养护记录读取失败，请重试' }); }
  },

  async onPetChange(event) {
    if (this.isBusy()) return;
    const petIndex = Number(event.detail.value);
    if (!Number.isInteger(petIndex) || !this.data.pets[petIndex] || petIndex === this.data.petIndex) return;
    this.selectPet(this.data.pets, petIndex);
    return this.loadData();
  },
  onKindChange(event) {
    const kindIndex = Number(event.detail.value);
    if (!this.isBusy() && this.data.kinds[kindIndex]) this.setData({ kindIndex });
  },
  onNoteInput(event) { if (!this.isBusy()) this.setData({ note: event.detail.value }); },
  onValueInput(event) { if (!this.isBusy()) this.setData({ value: event.detail.value }); },

  async submit() {
    if (this.isBusy() || this.data.error) return;
    const { pets, petIndex, kinds, kindIndex, note, value } = this.data;
    if (!pets[petIndex]) { wx.showToast({ title: '请先建立宠物档案', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      await createCareLog({ petId: pets[petIndex].id, kind: kinds[kindIndex], note: note.trim() || null, value: value.trim() || null, recordedAt: new Date().toISOString() });
      track('care.save');
      this.setData({ note: '', value: '' });
      await this.loadData();
      wx.showToast({ title: '记录已保存', icon: 'success' });
    } catch (error) { wx.showToast({ title: '保存失败，可重试', icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  },

  onReminderTitle(event) { if (!this.isBusy()) this.setData({ reminderTitle: event.detail.value }); },
  onReminderDate(event) { if (!this.isBusy()) this.setData({ reminderDate: event.detail.value }); },
  onReminderTime(event) { if (!this.isBusy()) this.setData({ reminderTime: event.detail.value }); },
  async addReminder() {
    if (this.isBusy() || this.data.error) return;
    const { pets, petIndex, reminderTitle, reminderDate, reminderTime } = this.data;
    const dueAt = new Date(`${reminderDate}T${reminderTime}:00`);
    if (!pets[petIndex] || !reminderTitle.trim() || Number.isNaN(dueAt.getTime())) { wx.showToast({ title: '请填写提醒和时间', icon: 'none' }); return; }
    if (dueAt.getTime() <= Date.now()) { wx.showToast({ title: '请选择未来的时间', icon: 'none' }); return; }
    this.setData({ reminding: true });
    try {
      await createCareReminder({ petId: pets[petIndex].id, title: reminderTitle.trim(), dueAt: dueAt.toISOString() });
      track('reminder.create'); this.setData({ reminderTitle: '' }); await this.loadData();
      wx.showToast({ title: '提醒已添加', icon: 'success' });
    } catch (error) { wx.showToast({ title: '添加失败', icon: 'none' }); }
    finally { this.setData({ reminding: false }); }
  },
  async completeReminder(event) {
    if (this.isBusy() || this.data.error) return;
    const id = event.currentTarget.dataset.id;
    const reminder = this.data.reminders.find((item) => item.id === id);
    if (!reminder || reminder.completedAt) return;
    this.setData({ completingId: id });
    try { await completeCareReminder(id); await this.loadData(); }
    catch (error) { wx.showToast({ title: '更新失败', icon: 'none' }); }
    finally { this.setData({ completingId: '' }); }
  },

  openPets() { wx.switchTab({ url: '/pages/pet/index' }); },
});
