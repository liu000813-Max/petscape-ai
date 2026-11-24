const { listPets, listCareLogs, createCareLog } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { track } = require('../../utils/analytics');
const { describeError } = require('../../utils/errors');
const { formatDateTime } = require('../../utils/format');
const { syncTabBar } = require('../../utils/navigation');
const { weightInGrams, recentWeights, weightChange } = require('../../utils/weight-records');

function chartSummary(records) {
  const latest = records[records.length - 1] || null;
  const max = records.length ? Math.max(...records.map((record) => record.grams)) : 1;
  const points = records.map((record, index) => ({ id: record.id, grams: record.grams,
    x: records.length === 1 ? 122 : 10 + index * 224 / (records.length - 1), y: 110 - record.grams / max * 100 }));
  const segments = points.slice(1).map((point, index) => {
    const previous = points[index]; const dx = point.x - previous.x; const dy = point.y - previous.y;
    return { id: point.id, x: previous.x, y: previous.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI };
  });
  return { latest, change: weightChange(records), count: records.length, firstDate: records[0]?.date || '', points, segments,
    history: records.map((record) => ({ ...record, height: record.grams / max * 100, isLatest: record === latest })) };
}

const EMPTY_CHART = chartSummary([]);

const CARE_KINDS = [
  { kind: '喂食', icon: 'feeding', hint: '记录进食与食量' },
  { kind: '换水', icon: 'water', hint: '留下换水时间' },
  { kind: '清洁', icon: 'cleaning', hint: '记录清洁与整理' },
  { kind: '生病', icon: 'health', hint: '记录症状与观察' },
];

function latestCareRecord(logs, petId, kind) {
  const [log] = logs.filter((item) => item.petId === petId && item.kind === kind && Number.isFinite(Date.parse(item.recordedAt)))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || String(b.id).localeCompare(String(a.id)));
  return log ? { ...log, time: formatDateTime(log.recordedAt), displayValue: log.value || `已记录${kind}` } : null;
}

function presentPet(pet) {
  const species = getSpeciesMeta(pet.speciesCode);
  return { ...pet, speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : species.label,
    speciesEmoji: species.emoji, speciesImage: species.image, avatarUrl: pet.coverUrl || species.image };
}

Page({
  data: {
    pet: null,
    pets: [],
    petCount: 0,
    selectedPetId: '',
    petIndex: 0,
    loading: true,
    loadError: '',
    loadErrorTitle: '',
    loadErrorDetail: '',
    mockMode: true,
    weightChart: EMPTY_CHART,
    feedingChart: EMPTY_CHART,
    weightLoading: false,
    weightSaving: false,
    weightError: '',
    weightDiagnostic: '',
    weightNotice: '',
    weightUnconfirmed: false,
    weightInput: '',
    weightUnit: 'g',
    activeModal: '',
    modalPetId: '',
    modalPetName: '',
    keyboardHeight: 0,
    weightChartMode: 'bar',
    feedingChartMode: 'bar',
    latestFeeding: null,
    careKinds: CARE_KINDS,
    careKind: '',
    careValue: '',
    feedingGrams: '',
    careNote: '',
    careSaving: false,
    careNotice: '',
    careUnconfirmed: false,
    careLatest: null,
    recordNotice: '',
    quickActions: [
      { title: '完善宠物档案', note: '记录物种与生活习性', path: '/pages/pet/index', tone: 'dark' },
      { title: '查看养护知识', note: '按物种快速查找', path: '/pages/knowledge/index', tone: 'light' },
    ],
    highlights: [
      { tag: '今日养护', title: '温度、湿度和躲避空间', note: '把知识变成每天能执行的小动作。' },
      { tag: '宠境观察', title: '让宠物的生活空间更像它自己', note: '从体型、习性和环境笔记开始了解它。' },
    ],
  },

  onShow() {
    syncTabBar(this, Boolean(this.data.activeModal));
    this.setData({ mockMode: getApp().globalData.mockMode });
    if (getApp().openOnboarding && getApp().openOnboarding(() => this.loadSummary())) return;
    if (this.isWriting() || this.data.activeModal) return;
    track('home.view');
    return this.loadSummary();
  },

  async loadSummary() {
    if (this.isWriting() || this.data.activeModal) return;
    const sequence = (this.summarySequence || 0) + 1; this.summarySequence = sequence;
    this.weightSequence = (this.weightSequence || 0) + 1;
    this.setData({ pet: null, pets: [], petCount: 0, loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '',
      weightChart: EMPTY_CHART, feedingChart: EMPTY_CHART, latestFeeding: null, careLatest: null,
      weightError: '', weightDiagnostic: '', weightLoading: false });
    try {
      const result = await listPets();
      if (sequence !== this.summarySequence) return;
      const pets = (result.pets || []).map(presentPet);
      const pet = pets.find((item) => item.id === this.data.selectedPetId) || pets[0] || null;
      if (this.weightDrafts) for (const id of this.weightDrafts.keys()) if (!pets.some((item) => item.id === id)) this.weightDrafts.delete(id);
      const switched = (pet ? pet.id : '') !== this.data.selectedPetId;
      this.setData({
        pet, pets, petCount: pets.length, selectedPetId: pet ? pet.id : '', petIndex: pet ? pets.findIndex((item) => item.id === pet.id) : 0, loading: false,
        ...(switched ? { weightInput: '', weightUnit: 'g', weightNotice: '', weightUnconfirmed: false, recordNotice: '' } : {}),
      });
      if (pet) await this.loadWeights();
    } catch (error) {
      if (sequence !== this.summarySequence) return;
      this.setData({
        loading: false,
        ...describeError(error),
      });
    }
  },

  async selectPet(event) {
    if (this.data.loading || this.isWriting() || this.data.activeModal) return;
    const pet = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    if (!pet || pet.id === this.data.selectedPetId) return;
    if (!this.weightDrafts) this.weightDrafts = new Map();
    this.weightDrafts.set(this.data.selectedPetId, {
      weightInput: this.data.weightInput, weightUnit: this.data.weightUnit,
      weightNotice: this.data.weightNotice, weightUnconfirmed: this.data.weightUnconfirmed,
    });
    this.setData({ pet, selectedPetId: pet.id, recordNotice: '', petIndex: this.data.pets.findIndex((item) => item.id === pet.id), ...(this.weightDrafts.get(pet.id) || {
      weightInput: '', weightUnit: 'g', weightNotice: '', weightUnconfirmed: false,
    }) });
    return this.loadWeights();
  },

  onPetSwipe(event) {
    const index = event.detail.current;
    if (!Number.isInteger(index) || !this.data.pets[index]) return;
    if (this.isWriting() || this.data.loading || this.data.activeModal) {
      // Saving replaces the swiper with a static selected portrait. Ignore any
      // change event already queued before that switch.
      this.setData({ petIndex: Math.max(0, this.data.pets.findIndex((pet) => pet.id === this.data.selectedPetId)) });
      return;
    }
    return this.selectPet({ currentTarget: { dataset: { id: this.data.pets[index].id } } });
  },

  openPetProfile(event) {
    if (this.data.loading || this.isWriting() || this.data.activeModal) return;
    const pet = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    if (pet) wx.navigateTo({ url: `/pages/pet-detail/index?id=${encodeURIComponent(pet.id)}` });
  },

  async loadWeights() {
    const petId = this.data.selectedPetId;
    if (!petId) return false;
    const sequence = (this.weightSequence || 0) + 1; this.weightSequence = sequence;
    this.setData({ weightLoading: true, weightError: '', weightDiagnostic: '', weightChart: EMPTY_CHART,
      feedingChart: EMPTY_CHART, latestFeeding: null, careLatest: null });
    try {
      const result = await listCareLogs({ petId, limit: 100 });
      if (sequence !== this.weightSequence || petId !== this.data.selectedPetId) return false;
      const logs = result.logs || [];
      const latestFeeding = latestCareRecord(logs, petId, '喂食');
      this.setData({ weightChart: chartSummary(recentWeights(logs, petId)), feedingChart: chartSummary(recentWeights(logs, petId, '喂食')),
        latestFeeding, careLatest: this.data.careKind === '喂食' ? latestFeeding : latestCareRecord(logs, petId, this.data.careKind),
        weightLoading: false, weightUnconfirmed: false,
        ...(this.data.weightUnconfirmed ? { weightNotice: '记录已刷新，请核对后再保存。' } : {}) });
      return true;
    } catch (error) {
      if (sequence !== this.weightSequence || petId !== this.data.selectedPetId) return false;
      const diagnostic = describeError(error);
      this.setData({ weightLoading: false, weightError: diagnostic.loadErrorTitle, weightDiagnostic: diagnostic.loadErrorDetail });
      return false;
    }
  },

  openWeightModal() {
    if (this.data.loading || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    this.setData({ activeModal: 'weight', modalPetId: this.data.selectedPetId, modalPetName: this.data.pet.name, ...(!this.data.weightUnconfirmed && !this.data.weightError ? { weightNotice: '' } : {}) });
    syncTabBar(this, true);
  },
  onWeightInput(event) {
    if (this.data.activeModal === 'weight' && !this.isWriting()) this.setData({ weightInput: event.detail.value });
  },
  onWeightUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    if (this.data.activeModal === 'weight' && !this.isWriting() && (unit === 'g' || unit === 'kg')) this.setData({ weightUnit: unit });
  },

  async saveWeight() {
    if (this.data.activeModal !== 'weight' || this.data.weightLoading || this.isWriting() || this.data.weightUnconfirmed || this.data.weightError) return;
    const petId = this.data.modalPetId;
    if (!petId || petId !== this.data.selectedPetId) return;
    const grams = weightInGrams(this.data.weightInput, this.data.weightUnit);
    if (grams === null) { wx.showToast({ title: '请输入有效正数，最多三位小数', icon: 'none' }); return; }
    this.setData({ weightSaving: true, weightNotice: '' });
    try {
      await createCareLog({ petId, kind: '体重', value: `${grams}g`, note: null, recordedAt: new Date().toISOString() });
      track('care.save');
      this.setData({ weightInput: '', weightNotice: '体重已保存' });
      if (this.weightDrafts) this.weightDrafts.delete(petId);
      const refreshed = await this.loadWeights();
      if (!refreshed) this.setData({ weightNotice: '体重已保存，列表暂未刷新，请重试读取。' });
      this.dismissModal();
      wx.showToast({ title: '体重已保存', icon: 'success' });
    } catch (error) {
      const diagnostic = describeError(error);
      this.setData({ weightUnconfirmed: true, weightNotice: `保存结果未确认：${diagnostic.loadErrorTitle}。请先刷新记录，核对后再保存。` });
      wx.showToast({ title: '保存未确认，请先刷新记录', icon: 'none' });
    } finally { this.setData({ weightSaving: false }); }
  },

  isWriting() { return this.data.weightSaving || this.data.careSaving; },
  stopTouch() {},

  onKeyboardHeightChange({ detail }) {
    if ((this.data.activeModal === 'weight' || this.data.activeModal === 'care') && Number.isFinite(detail.height)) {
      this.setData({ keyboardHeight: Math.max(0, detail.height) });
    }
  },

  dismissModal() {
    this.setData({ activeModal: '', modalPetId: '', modalPetName: '', keyboardHeight: 0 });
    syncTabBar(this);
  },

  setChartMode(event) {
    const { mode, kind } = event.currentTarget.dataset;
    if (mode === 'bar' || mode === 'line') this.setData({ [kind === '喂食' ? 'feedingChartMode' : 'weightChartMode']: mode });
  },

  closeModal() {
    if (this.isWriting()) return;
    if (this.data.activeModal === 'care') {
      if (!this.careDrafts) this.careDrafts = new Map();
      this.careDrafts.set(`${this.data.modalPetId}:${this.data.careKind}`, {
        careValue: this.data.careValue, careNote: this.data.careNote, feedingGrams: this.data.feedingGrams,
        careUnconfirmed: this.data.careUnconfirmed, careNotice: this.data.careNotice,
      });
    }
    this.dismissModal();
  },

  openCareModal(event) {
    if (this.data.loading || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    const kind = event.currentTarget.dataset.kind;
    if (!CARE_KINDS.some(item => item.kind === kind)) return;
    const draft = this.careDrafts && this.careDrafts.get(`${this.data.selectedPetId}:${kind}`);
    this.careModalSequence = (this.careModalSequence || 0) + 1;
    this.setData({ activeModal: 'care', modalPetId: this.data.selectedPetId, modalPetName: this.data.pet.name, careKind: kind,
      careLatest: kind === '喂食' ? this.data.latestFeeding : null,
      ...(draft || { careValue: '', careNote: '', feedingGrams: '', careUnconfirmed: false, careNotice: '' }) });
    syncTabBar(this, true);
  },

  onCareValue(event) { if (this.data.activeModal === 'care' && !this.isWriting()) this.setData({ careValue: event.detail.value }); },
  onCareNote(event) { if (this.data.activeModal === 'care' && !this.isWriting()) this.setData({ careNote: event.detail.value }); },
  onFeedingGrams(event) {
    if (this.data.activeModal === 'care' && this.data.careKind === '喂食' && !this.isWriting()) {
      this.setData({ feedingGrams: event.detail.value });
    }
  },

  async refreshCareRecords() {
    if (this.data.activeModal !== 'care' || this.isWriting() || this.data.weightLoading) return;
    const sequence = this.careModalSequence;
    // The list can still be useful to the home page after close, but only the
    // modal that initiated the refresh can unlock its uncertain submit.
    if (await this.loadWeights() && this.data.activeModal === 'care' && this.careModalSequence === sequence) {
      this.setData({ careUnconfirmed: false, careNotice: '记录已刷新，请核对最近一次记录后再保存。' });
    }
  },

  async saveCareRecord() {
    if (this.data.activeModal !== 'care' || this.isWriting() || this.data.weightLoading || this.data.weightError || this.data.careUnconfirmed) return;
    const { modalPetId: petId, careKind: kind, careValue, careNote, feedingGrams } = this.data;
    if (!petId || petId !== this.data.selectedPetId || !CARE_KINDS.some(item => item.kind === kind)) return;
    let value = careValue.trim();
    let note = careNote.trim();
    if (kind === '生病' && !note) { wx.showToast({ title: '请描述观察到的症状', icon: 'none' }); return; }
    if (kind === '喂食' && feedingGrams.trim()) {
      const grams = weightInGrams(feedingGrams, 'g');
      if (grams === null) { wx.showToast({ title: '请输入有效克数，最多三位小数', icon: 'none' }); return; }
      if (value) note = note ? `食物：${value}\n${note}` : `食物：${value}`;
      value = `${grams}g`;
    }
    this.setData({ careSaving: true, careNotice: '', recordNotice: '' });
    try {
      await createCareLog({ petId, kind, value: value || null, note: note || null, recordedAt: new Date().toISOString() });
      track('care.save');
      this.setData({ careValue: '', careNote: '', feedingGrams: '', recordNotice: `${kind}已保存` });
      if (this.careDrafts) this.careDrafts.delete(`${petId}:${kind}`);
      if (!await this.loadWeights()) this.setData({ recordNotice: `${kind}已保存，记录暂未刷新，请重试读取。` });
      this.dismissModal();
      wx.showToast({ title: `${kind}已记录`, icon: 'success' });
    } catch (error) {
      this.setData({ careUnconfirmed: true, careNotice: `保存结果未确认：${describeError(error).loadErrorTitle}。请先刷新记录核对。` });
      wx.showToast({ title: '结果未确认，请先刷新记录', icon: 'none' });
    } finally { this.setData({ careSaving: false }); }
  },

  openDeviceModal() {
    if (this.data.loading || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    this.setData({ activeModal: 'device', modalPetId: this.data.selectedPetId, modalPetName: this.data.pet.name });
    syncTabBar(this, true);
  },

  onAvatarError(event) {
    const id = event.currentTarget.dataset.id;
    const pets = this.data.pets.map((pet) => pet.id === id ? { ...pet, avatarUrl: pet.avatarUrl === pet.speciesImage ? '' : pet.speciesImage } : pet);
    this.setData({ pets, pet: pets.find((pet) => pet.id === this.data.selectedPetId) || null });
  },

  openAction(event) {
    if (this.isWriting() || this.data.activeModal) return;
    const url = event.currentTarget.dataset.path;
    if (url === '/pages/knowledge/index' || url === '/pages/pet/index') wx.switchTab({ url });
    else wx.navigateTo({ url });
  },

  openPet() {
    if (this.isWriting() || this.data.activeModal) return;
    if (this.data.pet) return this.openPetProfile({ currentTarget: { dataset: { id: this.data.pet.id } } });
    wx.switchTab({ url: '/pages/pet/index' });
  },

  openCare() {
    if (this.isWriting() || this.data.activeModal) return;
    wx.navigateTo({ url: '/pages/care-log/index' });
  },
});
