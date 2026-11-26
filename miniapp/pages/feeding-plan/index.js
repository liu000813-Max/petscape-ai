const { getPet, listCareLogs } = require('../../utils/request');
const { formatDateTime } = require('../../utils/format');
const { routePetId } = require('../../utils/pet-route');
const { WEEKDAYS, FIRST_DATE, LAST_DATE, changeMonth, calendarMonth, validatePlan, readPlan, savePlan,
  isScheduled, feedingHistory, planPortion, latestWeight } = require('../../utils/feeding-plan');

Page({
  data: { weekdays: WEEKDAYS, firstDate: FIRST_DATE, lastDate: LAST_DATE, pet: null, today: '', selected: '', month: '', monthLabel: '', days: [],
    plan: null, planError: '', historyError: '', dayLogs: [], dayScheduled: false, loading: true,
    petError: '', editing: false, form: null, formError: '', portion: '', basis: '', draftPortion: '', draftBasis: '',
    canMoveBack: false, canMoveForward: false },

  onLoad(options) {
    this.petId = routePetId(options?.petId);
    this.history = new Map();
  },

  onShow() {
    this.openingRecord = false;
    const today = formatDateTime(Date.now()).slice(0, 10);
    const selected = this.data.selected || today;
    this.setData({ today, selected, month: this.data.month || selected.slice(0, 7) });
    return this.load();
  },

  onUnload() {
    this.sequence = (this.sequence || 0) + 1;
    this.settingsSession = null;
  },

  async load() {
    const sequence = (this.sequence || 0) + 1;
    this.sequence = sequence;
    this.setData({ loading: true, petError: '', historyError: '', planError: '' });
    let pet;
    try {
      if (this.petId) pet = await getPet(this.petId);
      if (!pet || pet.id !== this.petId) throw new Error('unavailable_pet');
    } catch (_) {
      if (sequence === this.sequence) this.setData({ pet: null, plan: null, loading: false, petError: '宠物档案暂不可用' });
      return;
    }
    if (sequence !== this.sequence) return;
    let plan = null;
    let planError = '';
    try { plan = readPlan(this.petId); }
    catch (_) { planError = '设备上的喂食计划读取失败'; }
    let logs = [];
    let historyError = '';
    try { ({ logs } = await listCareLogs({ petId: this.petId, limit: 100 })); }
    catch (_) { historyError = '近期喂食记录读取失败'; }
    if (sequence !== this.sequence) return;
    this.history = feedingHistory(logs || [], this.petId);
    this.weight = latestWeight(logs || [], this.petId);
    this.setData({ pet: { name: pet.name }, plan, planError, historyError, loading: false, ...planPortion(plan, this.weight, historyError) });
    this.renderCalendar();
    if (this.data.editing) this.updateDraft(this.data.form);
  },

  renderCalendar() {
    const { month, today, selected, plan } = this.data;
    const [year, number] = month.split('-');
    this.setData({ monthLabel: `${year} 年 ${Number(number)} 月`,
      canMoveBack: month > FIRST_DATE.slice(0, 7), canMoveForward: month < LAST_DATE.slice(0, 7),
      days: calendarMonth(month, today, selected, plan, this.history),
      dayLogs: this.history.get(selected) || [], dayScheduled: isScheduled(plan, selected, today) });
  },

  moveMonth(event) {
    const delta = Number(event.currentTarget.dataset.delta);
    if (this.data.loading || this.data.editing || ![-1, 1].includes(delta)) return;
    if (delta < 0 ? !this.data.canMoveBack : !this.data.canMoveForward) return;
    const month = changeMonth(this.data.month, delta);
    this.setData({ month, selected: month === this.data.today.slice(0, 7) ? this.data.today : month + '-01' });
    this.renderCalendar();
  },

  goToday() {
    if (this.data.loading || this.data.editing) return;
    const { today } = this.data;
    this.setData({ month: today.slice(0, 7), selected: today });
    this.renderCalendar();
  },

  selectDay(event) {
    const date = event.currentTarget.dataset.date;
    if (this.data.editing || !this.data.days.some(day => !day.blank && day.date === date)) return;
    this.setData({ selected: date });
    this.renderCalendar();
  },

  openSettings() {
    if (this.data.loading || this.data.planError || !this.data.pet) return;
    const { today, selected, plan } = this.data;
    const form = plan || { start: selected < today ? today : selected, interval: '', mode: 'none', amount: '' };
    this.settingsSession = {};
    this.setData({ editing: true });
    this.updateDraft(form);
    wx.pageScrollTo?.({ scrollTop: 0, duration: 0 });
  },

  closeSettings() {
    this.settingsSession = null;
    this.setData({ editing: false, form: null, formError: '' });
  },
  onStart(event) { this.updateDraft({ ...this.data.form, start: event.detail.value }); },
  onInterval(event) { this.updateDraft({ ...this.data.form, interval: event.detail.value }); },
  onAmount(event) { this.updateDraft({ ...this.data.form, amount: event.detail.value }); },
  onPortionMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!this.data.form || !['none', 'grams', 'ratio'].includes(mode) || mode === this.data.form.mode) return;
    this.updateDraft({ ...this.data.form, mode, amount: '' });
  },

  updateDraft(form) {
    const { plan } = validatePlan({ ...form, interval: '1' });
    const { portion, basis } = planPortion(plan, this.weight, this.data.historyError);
    this.setData({ form, formError: '', draftPortion: portion, draftBasis: basis });
  },

  saveSettings() {
    if (!this.data.editing || this.data.loading || !this.data.pet || this.data.planError) return;
    const { plan, error } = validatePlan(this.data.form);
    if (error) { this.setData({ formError: error }); return; }
    this.persist(plan);
  },

  stopPlan() {
    if (this.data.editing && this.data.plan && !this.data.loading && !this.data.planError) {
      const session = this.settingsSession;
      wx.showModal({ title: '停止喂食计划', content: '已经保存的喂食记录仍可查看。',
        confirmText: '停止计划', success: result => {
          if (result.confirm && session === this.settingsSession && !this.data.loading && !this.data.planError) this.persist(null);
        },
      });
    }
  },

  persist(plan) {
    try { savePlan(this.petId, plan); }
    catch (_) { this.setData({ formError: '保存到此设备失败，请重试' }); return; }
    this.setData({ plan, ...planPortion(plan, this.weight, this.data.historyError) });
    this.closeSettings();
    this.renderCalendar();
    wx.showToast({ title: plan ? '计划已保存' : '计划已停止', icon: 'none' });
  },

  openFeedingRecord() {
    const { selected, today, pet, loading, editing } = this.data;
    if (this.openingRecord || loading || editing || !pet || !selected || selected > today) return;
    this.openingRecord = true;
    wx.navigateTo({ url: `/pages/care-log/index?petId=${encodeURIComponent(this.petId)}&kind=feeding&date=${selected}`, fail: () => {
      this.openingRecord = false;
      wx.showToast({ title: '记录页未打开，请重试', icon: 'none' });
    } });
  },
});
