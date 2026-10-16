const { listPets, listCareLogs, createCareLog, listCareReminders, createCareReminder, completeCareReminder } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');
const { track } = require('../../utils/analytics');

Page({
  data: { pets: [], petIndex: 0, kinds: ['喂食', '饮水', '清洁', '体重', '观察'], kindIndex: 0, logs: [], note: '', value: '', loading: true, submitting: false, reminders: [], reminderTitle: '', reminderDate: '', reminderTime: '09:00', reminding: false, error: '' },

  onShow() {
    if (!this.data.reminderDate) this.setData({ reminderDate: formatDateTime(Date.now() + 86400000).slice(0, 10) });
    return this.loadData();
  },

  async loadData() {
    const sequence = (this.loadSequence || 0) + 1; this.loadSequence = sequence;
    this.setData({ loading: true, error: '' });
    try {
      const petsResult = await listPets();
      const pets = petsResult.pets || [];
      const petIndex = Math.max(0, Math.min(this.data.petIndex, pets.length - 1));
      const [logsResult, remindersResult] = pets.length ? await Promise.all([listCareLogs({ petId: pets[petIndex].id }), listCareReminders({ petId: pets[petIndex].id })]) : [{ logs: [] }, { reminders: [] }];
      if (sequence !== this.loadSequence) return;
      this.setData({ pets, petIndex, logs: (logsResult.logs || []).map((item) => ({ ...item, displayTime: formatDateTime(item.recordedAt) })), reminders: (remindersResult.reminders || []).map((item) => ({ ...item, displayTime: formatDateTime(item.dueAt), overdue: !item.completedAt && new Date(item.dueAt).getTime() <= Date.now() })), loading: false });
    } catch (error) { if (sequence === this.loadSequence) this.setData({ loading: false, error: '养护记录读取失败，请重试' }); }
  },

  async onPetChange(event) {
    const petIndex = Number(event.detail.value);
    this.setData({ petIndex });
    return this.loadData();
  },
  onKindChange(event) { this.setData({ kindIndex: Number(event.detail.value) }); },
  onNoteInput(event) { this.setData({ note: event.detail.value }); },
  onValueInput(event) { this.setData({ value: event.detail.value }); },

  async submit() {
    if (this.data.submitting) return;
    const { pets, petIndex, kinds, kindIndex, note, value } = this.data;
    if (!pets.length) { wx.showToast({ title: '请先建立宠物档案', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      await createCareLog({ petId: pets[petIndex].id, kind: kinds[kindIndex], note: note.trim() || null, value: value.trim() || null, recordedAt: new Date().toISOString() });
      track('care.save');
      this.setData({ note: '', value: '', submitting: false });
      await this.loadData();
      wx.showToast({ title: '记录已保存', icon: 'success' });
    } catch (error) { this.setData({ submitting: false }); wx.showToast({ title: '保存失败', icon: 'none' }); }
  },

  onReminderTitle(event) { this.setData({ reminderTitle: event.detail.value }); },
  onReminderDate(event) { this.setData({ reminderDate: event.detail.value }); },
  onReminderTime(event) { this.setData({ reminderTime: event.detail.value }); },
  async addReminder() {
    if (this.data.reminding) return;
    const { pets, petIndex, reminderTitle, reminderDate, reminderTime } = this.data;
    const dueAt = new Date(`${reminderDate}T${reminderTime}:00`);
    if (!pets.length || !reminderTitle.trim() || Number.isNaN(dueAt.getTime())) { wx.showToast({ title: '请填写提醒和时间', icon: 'none' }); return; }
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
    if (this.completing) return;
    this.completing = true;
    try { await completeCareReminder(event.currentTarget.dataset.id); await this.loadData(); }
    catch (error) { wx.showToast({ title: '更新失败', icon: 'none' }); }
    finally { this.completing = false; }
  },
});
