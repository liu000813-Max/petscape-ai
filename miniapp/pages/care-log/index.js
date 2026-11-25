const { listPets, listCareLogs, createCareLog, updateCareLog, deleteCareLog, listCareReminders, createCareReminder, completeCareReminder } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');
const { track } = require('../../utils/analytics');
const { routePetId } = require('../../utils/pet-route');
const { ranges, quantityIndexes, wheelQuantity, convertQuantity, quantityInGrams } = require('../../utils/quantity-picker');
const { careFields } = require('../../utils/care-records');
const { careAmountLabel, recordedGrams } = require('../../utils/weight-records');

const recordDraftFields = ['note', 'value', 'amount', 'unit', 'selection', 'kindIndex', 'recordDate', 'recordTime'];
const draftFields = [...recordDraftFields, 'reminderTitle', 'reminderDate', 'reminderTime'];
function recordDraft() {
  return { note: '', value: '', amount: '', unit: 'g', selection: quantityIndexes(''), kindIndex: 0, recordDate: '', recordTime: '' };
}
function emptyDraft() {
  return { ...recordDraft(),
    reminderTitle: '', reminderDate: formatDateTime(Date.now() + 86400000).slice(0, 10), reminderTime: '09:00' };
}

Page({
  data: { pets: [], petIndex: 0, selectedPetId: '', kinds: ['喂食', '换水', '清洁', '体重', '生病', '观察'],
    ...recordDraft(), logs: [], ranges, today: '', nowTime: '', composerOpen: false, editingId: '', editingKind: '', preservedValue: null,
    loading: true, submitting: false, deletingId: '', reminders: [], reminderTitle: '', reminderDate: '', reminderTime: '09:00', reminding: false, completingId: '', error: '' },

  onLoad(options) {
    if (typeof options?.petId !== 'string' || !options.petId) return;
    this.scopedEntry = true;
    this.setData({ selectedPetId: routePetId(options.petId) });
  },

  onShow() {
    if (this.isWriting()) return;
    if (!this.data.reminderDate) this.setData({ reminderDate: formatDateTime(Date.now() + 86400000).slice(0, 10) });
    return this.loadData();
  },

  isWriting() { return this.data.submitting || this.data.reminding || Boolean(this.data.completingId || this.data.deletingId); },
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
      const selectedIndex = pets.findIndex((pet) => pet.id === this.data.selectedPetId);
      if (this.scopedEntry && selectedIndex === -1) {
        this.setData({ pets: [], petIndex: 0, loading: false, error: '这只宠物的档案已不可用，请返回重新选择。' });
        return;
      }
      const petIndex = Math.max(0, selectedIndex);
      this.selectPet(pets, petIndex);
      const [logsResult, remindersResult] = pets.length ? await Promise.all([listCareLogs({ petId: pets[petIndex].id }), listCareReminders({ petId: pets[petIndex].id })]) : [{ logs: [] }, { reminders: [] }];
      if (sequence !== this.loadSequence) return;
      const logs = (logsResult.logs || []).map(item => ({ ...item, displayValue: careAmountLabel(item), displayTime: formatDateTime(item.recordedAt) }));
      const reminders = (remindersResult.reminders || []).map(item => ({ ...item, displayTime: formatDateTime(item.dueAt), overdue: !item.completedAt && new Date(item.dueAt).getTime() <= Date.now() }));
      this.setData({ pets, petIndex, logs, reminders, loading: false });
    } catch (error) { if (sequence === this.loadSequence) this.setData({ loading: false, error: '养护记录读取失败，请重试' }); }
  },

  async onPetChange(event) {
    if (this.isBusy() || this.data.editingId) return;
    const petIndex = Number(event.detail.value);
    if (!Number.isInteger(petIndex) || !this.data.pets[petIndex] || petIndex === this.data.petIndex) return;
    this.selectPet(this.data.pets, petIndex);
    return this.loadData();
  },
  onKindChange(event) {
    const kindIndex = Number(event.detail.value);
    if (!this.isBusy() && !this.data.editingId && this.data.kinds[kindIndex] && kindIndex !== this.data.kindIndex) {
      this.setData({ kindIndex, amount: '', unit: 'g', selection: quantityIndexes('') });
    }
  },
  onQuantityChange(event) {
    if (this.isBusy()) return;
    const selection = event.detail.value;
    const amount = wheelQuantity(selection, this.data.unit);
    if (amount === null) {
      this.setData({ selection: quantityIndexes(this.data.amount, this.data.unit) });
      wx.showToast({ title: '请选择有效重量', icon: 'none' });
      return;
    }
    this.setData({ amount: amount === '0' ? '' : amount, selection, preservedValue: null });
  },
  onWeightUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    if (this.isBusy() || this.recordKind() !== '体重' || !['g', 'kg'].includes(unit) || unit === this.data.unit) return;
    const amount = convertQuantity(this.data.amount, this.data.unit, unit);
    if (amount === null) {
      wx.showToast({ title: '切换会改变重量，请保留当前单位', icon: 'none' });
      return;
    }
    this.setData({ unit, amount, selection: quantityIndexes(amount, unit) });
  },
  clearQuantity() {
    if (!this.isBusy()) this.setData({ amount: '', preservedValue: null, selection: quantityIndexes('', this.data.unit) });
  },
  onNoteInput(event) { if (!this.isBusy()) this.setData({ note: event.detail.value }); },
  onValueInput(event) { if (!this.isBusy()) this.setData({ value: event.detail.value }); },

  recordKind() { return this.data.editingKind || this.data.kinds[this.data.kindIndex]; },
  showComposer(fields = {}) {
    const [today, nowTime] = formatDateTime(Date.now()).split(' ');
    this.setData({ today, nowTime, composerOpen: true, ...fields });
    wx.pageScrollTo?.({ scrollTop: 0, duration: 150 });
  },
  openComposer() {
    if (!this.isBusy() && !this.data.error && this.data.selectedPetId) this.showComposer();
  },
  openEdit(event) {
    if (this.isBusy() || this.data.error || this.data.editingId) return;
    const log = this.data.logs.find(item => item.id === event.currentTarget.dataset.id && item.petId === this.data.selectedPetId);
    if (!log) return;
    this.newRecordDraft = Object.fromEntries(recordDraftFields.map(field => [field, this.data[field]]));
    this.editingRecordedAt = log.recordedAt;
    const hasQuantity = log.kind === '体重' || log.kind === '喂食';
    const grams = hasQuantity && log.value ? recordedGrams(log.value) : null;
    const amount = grams !== null && quantityInGrams(String(grams), 'g') !== null ? String(grams) : '';
    const preserve = log.value && (log.kind === '体重' || grams !== null) && !amount;
    const [recordDate, recordTime] = formatDateTime(log.recordedAt).split(' ');
    this.showComposer({ editingId: log.id, editingKind: log.kind, recordDate, recordTime, amount,
      preservedValue: preserve ? log.value : null, unit: 'g', selection: quantityIndexes(amount),
      note: log.note || '', value: log.kind === '体重' || grams !== null ? '' : log.value || '' });
  },
  resetComposer(fields = {}) {
    this.setData({ composerOpen: false, editingId: '', editingKind: '', preservedValue: null, ...fields });
    this.newRecordDraft = undefined;
    this.editingRecordedAt = undefined;
  },
  closeComposer() {
    if (!this.isBusy()) this.resetComposer(this.newRecordDraft);
  },
  onRecordDate(event) {
    if (!this.isBusy()) this.setData({ recordDate: event.detail.value, recordTime: this.data.recordTime || this.data.nowTime });
  },
  onRecordTime(event) {
    if (!this.isBusy()) this.setData({ recordDate: this.data.recordDate || this.data.today, recordTime: event.detail.value });
  },
  useCurrentTime() {
    if (!this.isBusy()) this.setData({ recordDate: '', recordTime: '' });
  },
  recordTimestamp() {
    const { recordDate, recordTime } = this.data;
    if (!recordDate && !recordTime) return new Date().toISOString();
    const local = recordDate + ' ' + recordTime;
    const stamp = new Date(recordDate + 'T' + recordTime + ':00');
    if (formatDateTime(stamp) !== local || stamp.getTime() > Date.now()) return null;
    return this.editingRecordedAt && formatDateTime(this.editingRecordedAt) === local ? this.editingRecordedAt : stamp.toISOString();
  },

  async submit() {
    if (this.isBusy() || this.data.error) return;
    const { pets, petIndex, editingId, preservedValue } = this.data;
    if (!pets[petIndex]) { wx.showToast({ title: '请先建立宠物档案', icon: 'none' }); return; }
    const kind = this.recordKind();
    const recordedAt = this.recordTimestamp();
    if (!recordedAt) { wx.showToast({ title: '请选择有效的过去时间', icon: 'none' }); return; }
    const { value, note, error } = careFields(preservedValue ? '观察' : kind, kind === '体重' ? '' : this.data.value, this.data.note, this.data.amount, this.data.unit);
    if (error) { wx.showToast({ title: error, icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      const fields = { note, value: preservedValue || value, recordedAt };
      if (editingId) await updateCareLog(editingId, fields);
      else await createCareLog({ petId: pets[petIndex].id, kind, ...fields });
      track('care.save');
      this.resetComposer(this.newRecordDraft || { ...recordDraft(), kindIndex: this.data.kindIndex, unit: this.data.unit, selection: quantityIndexes('', this.data.unit) });
      await this.loadData();
      wx.showToast({ title: '记录已保存', icon: 'success' });
    } catch (error) { wx.showToast({ title: '保存失败，可重试', icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  },

  deleteRecord(event) {
    if (this.isBusy() || this.data.error || this.data.composerOpen) return;
    const log = this.data.logs.find(item => item.id === event.currentTarget.dataset.id && item.petId === this.data.selectedPetId);
    if (!log) return;
    this.setData({ deletingId: log.id });
    wx.showModal({ title: '删除这条养护记录', content: log.kind + ' · ' + log.displayTime, confirmText: '删除', confirmColor: '#a1274e',
      success: result => { if (result.confirm) return this.confirmDelete(log.id); this.setData({ deletingId: '' }); },
      fail: () => this.setData({ deletingId: '' }),
    });
  },
  async confirmDelete(id) {
    if (id !== this.data.deletingId) return;
    try {
      await deleteCareLog(id);
      wx.showToast({ title: '记录已删除', icon: 'success' });
      await this.loadData();
    } catch (error) {
      await this.loadData();
      wx.showToast({ title: '请核对列表中的删除结果', icon: 'none' });
    } finally { this.setData({ deletingId: '' }); }
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
