const { listPets, listCareLogs, createCareLog } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { track } = require('../../utils/analytics');
const { describeError } = require('../../utils/errors');
const { formatDateTime } = require('../../utils/format');
const { syncTabBar, openOfficialPosts } = require('../../utils/navigation');
const { recentWeights, weightChange, careAmountLabel, timePositions, chartDates } = require('../../utils/weight-records');
const { ranges, quantityIndexes, wheelQuantity, convertQuantity, quantityInGrams } = require('../../utils/quantity-picker');
const { careFields } = require('../../utils/care-records');
const { slideDistance, animatePetTrack } = require('../../utils/pet-slide');

function chartSummary(records) {
  const latest = records[records.length - 1] || null;
  const max = records.length ? Math.max(...records.map((record) => record.grams)) : 1;
  const positions = timePositions(records, 10, 234);
  const points = records.map((record, index) => ({ id: record.id, grams: record.grams,
    x: positions[index], y: 110 - record.grams / max * 100 }));
  const segments = points.slice(1).flatMap((point, index) => {
    const previous = points[index]; const dx = point.x - previous.x; const dy = point.y - previous.y;
    return dx > 0 ? [{ id: point.id, x: previous.x, y: previous.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI }] : [];
  });
  return { latest, change: weightChange(records), count: records.length, dates: chartDates(records), points, segments,
    history: records.map((record) => ({ ...record, height: record.grams / max * 100, isLatest: record === latest })) };
}

const EMPTY_CHART = chartSummary([]);
const EMPTY_DAILY_RECORDS = { weightChart: EMPTY_CHART, feedingChart: EMPTY_CHART, latestFeeding: null, careLatest: null };

const CARE_KINDS = [
  { kind: '喂食', icon: 'feeding', hint: '记录进食与食量' },
  { kind: '换水', icon: 'water', hint: '留下换水时间' },
  { kind: '清洁', icon: 'cleaning', hint: '记录清洁与整理' },
  { kind: '生病', icon: 'health', hint: '记录症状与观察' },
];

function latestCareRecord(logs, petId, kind) {
  const [log] = logs.filter((item) => item.petId === petId && item.kind === kind && Number.isFinite(Date.parse(item.recordedAt)))
    .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || String(b.id).localeCompare(String(a.id)));
  return log ? { ...log, time: formatDateTime(log.recordedAt), displayValue: careAmountLabel(log) || `已记录${kind}` } : null;
}

function presentPet(pet) {
  const species = getSpeciesMeta(pet.speciesCode);
  return { ...pet, speciesLabel: pet.speciesCode === 'other' && pet.customSpeciesName ? pet.customSpeciesName : species.label,
    speciesEmoji: species.emoji, speciesImage: species.image, avatarUrl: pet.coverUrl || species.image };
}

Page({
  data: {
    brandLaunching: false,
    greeting: '',
    pet: null,
    pets: [],
    petCount: 0,
    selectedPetId: '',
    petIndex: 0,
    petPreviewMargin: 220,
    petSlideDuration: 280,
    petSlideTransform: '',
    petSliding: false,
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
    quantityRanges: ranges,
    quantitySelection: quantityIndexes(''),
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
    clearTimeout(this.brandLaunchTimer);
    this.openingPetPage = false;
    const app = getApp();
    const brandLaunching = Boolean(app.takeBrandLaunch?.());
    const hour = new Date().getHours();
    const greeting = hour < 5 || hour >= 18 ? '晚上好' : hour < 12 ? '早上好' : '下午好';
    this.setData({ brandLaunching, greeting, mockMode: app.globalData.mockMode });
    syncTabBar(this, brandLaunching || Boolean(this.data.activeModal));
    if (brandLaunching) {
      this.brandLaunchTimer = setTimeout(() => {
        this.setData({ brandLaunching: false });
        syncTabBar(this, false);
        this.showHome();
      }, 420);
      return;
    }
    return this.showHome();
  },

  showHome() {
    if (getApp().openOnboarding?.(() => this.loadSummary())) return;
    if (this.isWriting() || this.data.activeModal) return;
    track('home.view');
    return this.loadSummary();
  },

  onHide() {
    clearTimeout(this.brandLaunchTimer);
    this.cancelPetSlide();
  },
  onUnload() { clearTimeout(this.brandLaunchTimer); clearTimeout(this.petSlideTimer); },

  async loadSummary() {
    if (this.isWriting() || this.data.activeModal) return;
    const sequence = (this.summarySequence || 0) + 1; this.summarySequence = sequence;
    this.weightSequence = (this.weightSequence || 0) + 1;
    this.cancelPetSlide();
    this.setData({ loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '' });
    try {
      const result = await listPets();
      if (sequence !== this.summarySequence) return;
      const pets = (result.pets || []).map(presentPet);
      const pet = pets.find((item) => item.id === this.data.selectedPetId) || pets[0] || null;
      if (this.weightDrafts) for (const id of this.weightDrafts.keys()) if (!pets.some((item) => item.id === id)) this.weightDrafts.delete(id);
      const switched = (pet ? pet.id : '') !== this.data.selectedPetId;
      const sameVisiblePet = Boolean(pet && pet.id === this.data.pet?.id);
      this.setData({
        pet, pets, petCount: pets.length, selectedPetId: pet ? pet.id : '', petIndex: pet ? pets.findIndex((item) => item.id === pet.id) : 0, loading: false,
        ...(!sameVisiblePet ? { ...EMPTY_DAILY_RECORDS, weightLoading: false, weightError: '', weightDiagnostic: '' } : {}),
        ...(switched ? { weightInput: '', weightUnit: 'g', weightNotice: '', weightUnconfirmed: false, recordNotice: '' } : {}),
      });
      if (pet) await this.loadWeights({ keepVisible: sameVisiblePet });
    } catch (error) {
      if (sequence !== this.summarySequence) return;
      this.setData({
        pet: null, pets: [], petCount: 0, petIndex: 0, loading: false,
        ...EMPTY_DAILY_RECORDS, weightLoading: false, weightError: '', weightDiagnostic: '',
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
    this.setData({ pet, selectedPetId: pet.id, recordNotice: '', petSlideTransform: '', petSliding: false,
      petIndex: this.data.pets.findIndex((item) => item.id === pet.id), ...(this.weightDrafts.get(pet.id) || {
      weightInput: '', weightUnit: 'g', weightNotice: '', weightUnconfirmed: false,
    }) });
    return this.loadWeights();
  },

  onPetSwipe(event) {
    const { current: index, source } = event.detail;
    // Tapping a side avatar already selects it. Ignore the swiper's programmatic echo.
    if (source !== undefined && source !== 'touch') return;
    if (this.data.petSliding) return;
    if (!Number.isInteger(index) || !this.data.pets[index]) return;
    if (this.isWriting() || this.data.loading || this.data.activeModal) {
      // Saving replaces the swiper with a static selected portrait. Ignore any
      // change event already queued before that switch.
      this.setData({ petIndex: Math.max(0, this.data.pets.findIndex((pet) => pet.id === this.data.selectedPetId)) });
      return;
    }
    return this.selectPet({ currentTarget: { dataset: { id: this.data.pets[index].id } } });
  },

  onPetAvatarTap(event) {
    const { loading, activeModal, petSliding, petIndex, pets } = this.data;
    if (loading || this.isWriting() || activeModal || petSliding || this.openingPetPage) return;
    const index = pets.findIndex((pet) => pet.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    if (index === petIndex) return this.openPet();
    this.pendingPetTap = pets[index].id;
    animatePetTrack(this, slideDistance(petIndex, index, pets.length));
  },

  finishPetSlide() {
    const id = this.pendingPetTap;
    if (!id) return;
    clearTimeout(this.petSlideTimer);
    this.pendingPetTap = null;
    const selection = this.selectPet({ currentTarget: { dataset: { id } } });
    if (this.data.petSliding) this.setData({ petSlideTransform: '', petSliding: false });
    return selection;
  },

  cancelPetSlide() {
    clearTimeout(this.petSlideTimer);
    this.pendingPetTap = null;
    if (this.data.petSliding) this.setData({ petSlideTransform: '', petSliding: false });
  },

  async loadWeights({ keepVisible = false } = {}) {
    const petId = this.data.selectedPetId;
    if (!petId || this.data.loading) return false;
    const sequence = (this.weightSequence || 0) + 1; this.weightSequence = sequence;
    this.setData({ weightLoading: true, weightError: '', weightDiagnostic: '', ...(keepVisible ? {} : EMPTY_DAILY_RECORDS) });
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
      this.setData({ ...EMPTY_DAILY_RECORDS, weightLoading: false, weightError: diagnostic.loadErrorTitle, weightDiagnostic: diagnostic.loadErrorDetail });
      return false;
    }
  },

  openWeightModal() {
    if (this.data.loading || this.data.petSliding || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    this.setData({ activeModal: 'weight', modalPetId: this.data.selectedPetId, modalPetName: this.data.pet.name,
      quantitySelection: quantityIndexes(this.data.weightInput, this.data.weightUnit),
      ...(!this.data.weightUnconfirmed && !this.data.weightError ? { weightNotice: '' } : {}) });
    syncTabBar(this, true);
  },
  onQuantityChange(event) {
    if (this.isWriting()) return;
    const isWeight = this.data.activeModal === 'weight';
    if (!isWeight && (this.data.activeModal !== 'care' || this.data.careKind !== '喂食')) return;
    const unit = isWeight ? this.data.weightUnit : 'g';
    const selection = event.detail.value;
    const value = wheelQuantity(selection, unit);
    if (value === '0') {
      this.setData({ [isWeight ? 'weightInput' : 'feedingGrams']: '', quantitySelection: selection });
      return;
    }
    if (value === null) {
      wx.showToast({ title: '请选择有效重量', icon: 'none' });
      this.setData({ quantitySelection: quantityIndexes(isWeight ? this.data.weightInput : this.data.feedingGrams, unit) });
      return;
    }
    this.setData({ [isWeight ? 'weightInput' : 'feedingGrams']: value, quantitySelection: selection });
  },
  // Keep the old handlers for existing native test adapters and older page callers.
  onWeightInput(event) {
    if (this.data.activeModal === 'weight' && !this.isWriting()) {
      const value = String(event.detail.value || '');
      this.setData({ weightInput: value, quantitySelection: quantityIndexes(value, this.data.weightUnit) });
    }
  },
  onFeedingGrams(event) {
    if (this.data.activeModal === 'care' && this.data.careKind === '喂食' && !this.isWriting()) {
      const value = String(event.detail.value || '');
      this.setData({ feedingGrams: value, quantitySelection: quantityIndexes(value) });
    }
  },
  onWeightUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    if (this.data.activeModal !== 'weight' || this.isWriting() || unit === this.data.weightUnit || (unit !== 'g' && unit !== 'kg')) return;
    const input = convertQuantity(this.data.weightInput, this.data.weightUnit, unit);
    if (input === null) {
      wx.showToast({ title: '切换会改变重量，请保留当前单位', icon: 'none' });
      return;
    }
    this.setData({ weightUnit: unit, weightInput: input, quantitySelection: quantityIndexes(input, unit) });
  },

  async saveWeight() {
    if (this.data.activeModal !== 'weight' || this.data.weightLoading || this.isWriting() || this.data.weightUnconfirmed || this.data.weightError) return;
    const petId = this.data.modalPetId;
    if (!petId || petId !== this.data.selectedPetId) return;
    const grams = quantityInGrams(this.data.weightInput, this.data.weightUnit);
    if (grams === null) { wx.showToast({ title: '请选择本次体重', icon: 'none' }); return; }
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
    if (this.data.loading || this.data.petSliding || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    const kind = event.currentTarget.dataset.kind;
    if (!CARE_KINDS.some(item => item.kind === kind)) return;
    const draft = this.careDrafts && this.careDrafts.get(`${this.data.selectedPetId}:${kind}`);
    this.careModalSequence = (this.careModalSequence || 0) + 1;
    this.setData({ activeModal: 'care', modalPetId: this.data.selectedPetId, modalPetName: this.data.pet.name, careKind: kind,
      careLatest: kind === '喂食' ? this.data.latestFeeding : null,
      quantitySelection: quantityIndexes(draft?.feedingGrams, 'g'),
      ...(draft || { careValue: '', careNote: '', feedingGrams: '', careUnconfirmed: false, careNotice: '' }) });
    syncTabBar(this, true);
  },

  onCareValue(event) { if (this.data.activeModal === 'care' && !this.isWriting()) this.setData({ careValue: event.detail.value }); },
  onCareNote(event) { if (this.data.activeModal === 'care' && !this.isWriting()) this.setData({ careNote: event.detail.value }); },
  clearFeedingQuantity() {
    if (this.data.activeModal === 'care' && this.data.careKind === '喂食' && !this.isWriting()) {
      this.setData({ feedingGrams: '', quantitySelection: quantityIndexes('', 'g') });
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
    const { value, note, error: validationError } = careFields(kind, careValue, careNote, feedingGrams);
    if (validationError) { wx.showToast({ title: validationError, icon: 'none' }); return; }
    this.setData({ careSaving: true, careNotice: '', recordNotice: '' });
    try {
      await createCareLog({ petId, kind, value, note, recordedAt: new Date().toISOString() });
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

  openDevice() {
    if (this.data.loading || this.data.petSliding || this.isWriting() || this.data.activeModal || !this.data.pet) return;
    this.openPetPage(`/pages/pet-devices/index?petId=${encodeURIComponent(this.data.pet.id)}`);
  },

  onAvatarError(event) {
    const id = event.currentTarget.dataset.id;
    const pets = this.data.pets.map((pet) => pet.id === id ? { ...pet, avatarUrl: pet.avatarUrl === pet.speciesImage ? '' : pet.speciesImage } : pet);
    this.setData({ pets, pet: pets.find((pet) => pet.id === this.data.selectedPetId) || null });
  },

  openAction(event) {
    if (this.isWriting() || this.data.activeModal) return;
    const url = event.currentTarget.dataset.path;
    if (url === '/pages/knowledge/index') openOfficialPosts();
    else if (url === '/pages/pet/index') wx.switchTab({ url });
    else wx.navigateTo({ url });
  },

  openPet() {
    if (this.data.loading || this.data.petSliding || this.isWriting() || this.data.activeModal) return;
    if (this.data.pet) this.openPetPage(`/pages/pet-detail/index?id=${encodeURIComponent(this.data.pet.id)}`);
    else wx.switchTab({ url: '/pages/pet/index' });
  },

  openCare() {
    if (this.data.loading || this.isWriting() || this.data.activeModal || this.data.petSliding) return;
    const petId = this.data.pet?.id;
    if (petId) this.openPetPage(`/pages/care-log/index?petId=${encodeURIComponent(petId)}`);
  },

  openFeedingPlan() {
    if (this.data.loading || this.isWriting() || this.data.activeModal || this.data.petSliding) return;
    const petId = this.data.pet?.id;
    if (petId) this.openPetPage(`/pages/feeding-plan/index?petId=${encodeURIComponent(petId)}`);
  },

  openPetPage(url) {
    if (this.openingPetPage) return;
    this.openingPetPage = true;
    wx.navigateTo({ url, fail: () => {
      this.openingPetPage = false;
      wx.showToast({ title: '页面未打开，请重试', icon: 'none' });
    } });
  },
});
