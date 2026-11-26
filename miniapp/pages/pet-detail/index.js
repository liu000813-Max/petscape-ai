const { getPet, listCareLogs, listPetGrowthEntries } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { lifeStageLabel } = require('../../utils/life-stages');
const { describeError } = require('../../utils/errors');
const { formatDateTime } = require('../../utils/format');
const { routePetId } = require('../../utils/pet-route');
const { recentWeights, weightChange, weightLabel, careAmountLabel, timePositions, chartDates } = require('../../utils/weight-records');
const { chooseImageFiles } = require('../../utils/pet-photo');

const PLOT_WIDTH = 302;
const PLOT_HEIGHT = 152;
const GROWTH_PAGE_SIZE = 12;

function plotFor(records, barMode) {
  if (!records.length) return { ticks: [], points: [], segments: [] };
  const weights = records.map(record => record.grams);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = barMode ? max : Math.max(max - min, max * 0.025, 0.002);
  const magnitude = 10 ** Math.floor(Math.log10(span / 2));
  const step = Math.max(0.1, Math.ceil(span / 2 / magnitude) * magnitude);
  const lower = barMode ? 0 : Math.max(0, (Math.floor(min / step) - 1) * step);
  const upper = Math.max(lower + 2 * step, Math.ceil(max / step) * step);
  const ticks = [upper, (upper + lower) / 2, lower].map(weightLabel);
  const positions = !barMode ? timePositions(records, 14, PLOT_WIDTH - 14) : [];
  const points = records.map((record, index) => ({
    id: record.id,
    x: barMode ? (records.length === 1 ? PLOT_WIDTH / 2 : 14 + index * (PLOT_WIDTH - 28) / (records.length - 1)) : positions[index],
    y: PLOT_HEIGHT * (1 - (record.grams - lower) / (upper - lower)),
    barHeight: PLOT_HEIGHT * record.grams / upper,
    latest: index === records.length - 1,
  }));
  const segments = barMode ? [] : points.slice(1).flatMap((point, index) => {
    const start = points[index];
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return dx > 0 ? [{ id: point.id, x: start.x, y: start.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI }] : [];
  });
  return { ticks, points, segments };
}

function errorView(error) {
  const detail = describeError(error);
  return { title: detail.loadErrorTitle, message: detail.loadError, detail: detail.loadErrorDetail };
}

Page({
  data: {
    pet: null, petLoading: true, petError: null, recordsLoading: false, recordsError: null,
    weights: [], latestWeight: null, weightDelta: '', chartMode: 'line', plot: null, dates: null, recentCare: [], hasRecentCare: false,
    growthEntries: [], growthLoading: false, growthError: null, growthHasMore: false, growthOffset: 0,
    choosingGrowthPhotos: false,
  },

  onLoad(options) { this.petId = routePetId(options?.id); },
  onShow() { return this.loadDetail(); },
  onUnload() {
    this.closed = true;
    this.loadSequence = (this.loadSequence || 0) + 1;
  },

  async loadDetail() {
    const petId = this.petId;
    const sequence = (this.loadSequence || 0) + 1;
    this.loadSequence = sequence;
    this.setData({ pet: null, petLoading: true, petError: null, recordsLoading: false, recordsError: null,
      weights: [], latestWeight: null, weightDelta: '', plot: null, dates: null, recentCare: [], hasRecentCare: false,
      growthEntries: [], growthLoading: false, growthError: null, growthHasMore: false, growthOffset: 0 });

    try {
      const pet = petId ? await getPet(petId) : null;
      if (sequence !== this.loadSequence) return;
      if (!pet || pet.id !== petId) {
        this.setUnavailable();
        return;
      }
      const species = getSpeciesMeta(pet.speciesCode);
      const speciesName = (pet.speciesCode === 'other' && pet.customSpeciesName) || species.label;
      const speciesLabel = pet.breed && pet.breed !== speciesName ? speciesName + ' · ' + pet.breed : speciesName;
      this.setData({
        pet: { id: pet.id, name: pet.name, speciesLabel, stage: lifeStageLabel(pet.lifeStage),
          avatar: pet.coverUrl || species.image, speciesImage: species.image },
        petLoading: false,
      });
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      if (error?.statusCode === 404) this.setUnavailable();
      else this.setData({ petLoading: false, petError: errorView(error) });
      return;
    }
    return Promise.all([this.loadRecords(), this.loadGrowth()]);
  },

  setUnavailable() {
    this.setData({ petLoading: false, petError: { title: '宠物档案不可用', message: '请返回后重新选择宠物。', detail: '' } });
  },

  async loadRecords() {
    if (!this.data.pet || this.data.recordsLoading) return;
    const petId = this.data.pet.id;
    const sequence = this.loadSequence;
    this.setData({ recordsLoading: true, recordsError: null, weights: [], latestWeight: null, weightDelta: '',
      plot: null, dates: null, recentCare: [], hasRecentCare: false });
    try {
      const result = await listCareLogs({ petId, limit: 100 });
      if (sequence !== this.loadSequence) return;
      const logs = result.logs || [];
      const weights = recentWeights(logs, petId);
      const recentCare = logs.filter(log => log.petId === petId && log.kind !== '体重' && log.recordedAt && Number.isFinite(Date.parse(log.recordedAt)))
        .sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt) || String(a.id).localeCompare(String(b.id)))
        .slice(0, 3).map(log => ({
          id: log.id, kind: log.kind, summary: [careAmountLabel(log), log.note].filter(Boolean).join(' · '),
          time: formatDateTime(log.recordedAt).slice(5),
        }));
      this.setData({ recordsLoading: false, weights, latestWeight: weights[weights.length - 1] || null,
        weightDelta: weightChange(weights), plot: plotFor(weights, this.data.chartMode === 'bar'), dates: chartDates(weights),
        recentCare, hasRecentCare: recentCare.length > 0 });
    } catch (error) {
      if (sequence !== this.loadSequence) return;
      this.setData({ recordsLoading: false, recordsError: errorView(error) });
    }
  },

  setChartMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if ((mode !== 'line' && mode !== 'bar') || mode === this.data.chartMode) return;
    this.setData({ chartMode: mode, plot: plotFor(this.data.weights, mode === 'bar') });
  },

  onAvatarError(event) {
    const pet = this.data.pet;
    if (!pet || event.currentTarget.dataset.src !== pet.avatar) return;
    this.setData({ 'pet.avatar': pet.avatar === pet.speciesImage ? '' : pet.speciesImage });
  },

  openEdit() {
    if (this.data.pet) wx.navigateTo({ url: '/pages/pet-edit/index?id=' + encodeURIComponent(this.data.pet.id) });
  },

  openCare() {
    if (this.data.pet) wx.navigateTo({ url: '/pages/care-log/index?petId=' + encodeURIComponent(this.data.pet.id) });
  },

  async loadGrowth(reset = true) {
    const petId = this.data.pet?.id;
    if (!petId || this.data.growthLoading) return;
    const sequence = this.loadSequence;
    const offset = reset ? 0 : this.data.growthOffset;
    this.setData({ growthLoading: true, growthError: null, ...(reset ? { growthEntries: [], growthHasMore: false, growthOffset: 0 } : {}) });
    try {
      const { entries, hasMore } = await listPetGrowthEntries(petId, { limit: GROWTH_PAGE_SIZE, offset });
      if (sequence !== this.loadSequence) return;
      const seen = new Set(this.data.growthEntries.map(entry => entry.id));
      const additions = [];
      for (const entry of entries) {
        if (entry.petId !== petId || seen.has(entry.id)) continue;
        seen.add(entry.id);
        additions.push({ ...entry, dateLabel: formatDateTime(entry.recordedAt).slice(0, 10) });
      }
      const nextOffset = offset + entries.length;
      this.setData({ growthEntries: [...this.data.growthEntries, ...additions], growthHasMore: Boolean(hasMore) && nextOffset <= 10000,
        growthOffset: nextOffset, growthLoading: false });
    } catch (error) {
      if (sequence === this.loadSequence) this.setData({ growthLoading: false, growthError: errorView(error) });
    }
  },

  retryGrowth() { return this.loadGrowth(!this.data.growthEntries.length); },
  loadMoreGrowth() { if (this.data.growthHasMore) return this.loadGrowth(false); },

  async openGrowthEditor() {
    const petId = this.data.pet?.id;
    if (!petId || this.data.choosingGrowthPhotos) return;
    this.setData({ choosingGrowthPhotos: true });
    try {
      const files = await chooseImageFiles(6);
      // Returning from the native picker can trigger onShow and refresh this same pet.
      if (this.closed || this.petId !== petId || !files.length) return;
      await new Promise((resolve, reject) => {
        wx.navigateTo({
          url: '/pages/pet-growth-edit/index?petId=' + encodeURIComponent(petId),
          success: ({ eventChannel }) => {
            if (!eventChannel || typeof eventChannel.emit !== 'function') { reject(new Error('照片传递失败，请返回后重试')); return; }
            try { eventChannel.emit('growthPhotosChosen', files); resolve(); }
            catch { reject(new Error('照片传递失败，请返回后重试')); }
          },
          fail: () => reject(new Error('无法打开照片确认页')),
        });
      });
    } catch (error) {
      if (!this.closed) wx.showToast({ title: error.message, icon: 'none' });
    } finally {
      if (!this.closed) this.setData({ choosingGrowthPhotos: false });
    }
  },

  previewGrowthPhoto(event) {
    const { entryId, assetId } = event.currentTarget.dataset;
    const photos = this.data.growthEntries.find(entry => entry.id === entryId)?.photos || [];
    const photo = photos.find(item => item.assetId === assetId);
    if (photo) wx.previewImage({
      current: photo.downloadUrl, urls: photos.map(item => item.downloadUrl),
      fail: () => wx.showToast({ title: '请刷新照片后重试', icon: 'none' }),
    });
  },

  shareGrowthPhoto(event) {
    const entry = this.data.growthEntries.find(item => item.id === event.currentTarget.dataset.entryId);
    const petId = this.data.pet?.id;
    const photos = entry?.photos.filter(photo => !photo.unavailable && photo.downloadUrl) || [];
    if (!petId || this.openingCommunityEditor) return;
    if (!photos.length) {
      wx.showToast({ title: '请刷新照片后再分享', icon: 'none' });
      return;
    }
    this.openingCommunityEditor = true;
    const open = photo => wx.navigateTo({
      url: '/pages/community-edit/index?source=growth&petId=' + encodeURIComponent(petId)
        + '&entryId=' + encodeURIComponent(entry.id) + '&assetId=' + encodeURIComponent(photo.assetId),
      complete: () => { this.openingCommunityEditor = false; },
      fail: () => wx.showToast({ title: '发帖页未打开，请重试', icon: 'none' }),
    });
    if (photos.length === 1) open(photos[0]);
    else wx.showActionSheet({
      itemList: photos.map((_, index) => '分享第 ' + (index + 1) + ' 张照片'),
      success: ({ tapIndex }) => {
        if (photos[tapIndex]) open(photos[tapIndex]);
        else this.openingCommunityEditor = false;
      },
      fail: () => { this.openingCommunityEditor = false; },
    });
  },

  onGrowthPhotoError(event) {
    const { entryId, assetId, url } = event.currentTarget.dataset;
    const entryIndex = this.data.growthEntries.findIndex(entry => entry.id === entryId);
    const photoIndex = this.data.growthEntries[entryIndex]?.photos.findIndex(photo => photo.assetId === assetId && photo.downloadUrl === url);
    if (photoIndex >= 0) this.setData({ [`growthEntries[${entryIndex}].photos[${photoIndex}].unavailable`]: true });
  },

  refreshGrowthPhotos() { return this.loadGrowth(); },

  openDevice() {
    if (this.data.pet) wx.navigateTo({ url: `/pages/pet-devices/index?petId=${encodeURIComponent(this.data.pet.id)}` });
  },
});
