const { getPet, listCareLogs } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { lifeStageLabel } = require('../../utils/life-stages');
const { describeError } = require('../../utils/errors');
const { formatDateTime } = require('../../utils/format');
const { routePetId } = require('../../utils/pet-route');
const { recentWeights, weightChange } = require('../../utils/weight-records');

const PLOT_WIDTH = 608;
const PLOT_HEIGHT = 144;

function plotFor(records, barMode) {
  if (!records.length) return { ticks: [], points: [], segments: [] };
  const weights = records.map(record => record.grams);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = barMode ? max : Math.max(max - min, max * 0.025, 0.002);
  const magnitude = 10 ** Math.floor(Math.log10(span / 2));
  const step = Math.max(0.001, Math.ceil(span / 2 / magnitude) * magnitude);
  const lower = barMode ? 0 : Math.max(0, (Math.floor(min / step) - 1) * step);
  const upper = Math.max(lower + 2 * step, Math.ceil(max / step) * step);
  const ticks = [upper, (upper + lower) / 2, lower].map(value => Number(value.toFixed(4)).toString());
  const points = records.map((record, index) => ({
    id: record.id,
    x: records.length === 1 ? PLOT_WIDTH / 2 : 24 + index * (PLOT_WIDTH - 48) / (records.length - 1),
    y: PLOT_HEIGHT * (1 - (record.grams - lower) / (upper - lower)),
    latest: index === records.length - 1,
  }));
  const segments = points.slice(1).map((point, index) => {
    const start = points[index];
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    return { id: point.id, x: start.x, y: start.y, length: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) * 180 / Math.PI };
  });
  return { ticks, points, segments };
}

function datesFor(records) {
  if (!records.length) return { first: '', middle: '', last: '' };
  const first = records[0].date;
  const last = records[records.length - 1].date;
  if (records.length === 1 || records.every(record => record.time.slice(0, 10) === records[0].time.slice(0, 10))) {
    return { first: '', middle: last, last: '' };
  }
  const middle = records.length > 2 && records.length % 2 ? records[Math.floor(records.length / 2)].date : '';
  return { first, middle: middle === first || middle === last ? '' : middle, last };
}

function errorView(error) {
  const detail = describeError(error);
  return { title: detail.loadErrorTitle, message: detail.loadError, detail: detail.loadErrorDetail };
}

Page({
  data: {
    pet: null, petLoading: true, petError: null, recordsLoading: false, recordsError: null,
    weights: [], latestWeight: null, weightDelta: '', chartMode: 'line', plot: null, dates: null, recentCare: [], hasRecentCare: false,
  },

  onLoad(options) { this.petId = routePetId(options?.id); },
  onShow() { return this.loadDetail(); },
  onUnload() { this.loadSequence = (this.loadSequence || 0) + 1; },

  async loadDetail() {
    const petId = this.petId;
    const sequence = (this.loadSequence || 0) + 1;
    this.loadSequence = sequence;
    this.setData({ pet: null, petLoading: true, petError: null, recordsLoading: false, recordsError: null,
      weights: [], latestWeight: null, weightDelta: '', plot: null, dates: null, recentCare: [], hasRecentCare: false });

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
    return this.loadRecords();
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
          id: log.id, kind: log.kind, summary: [log.value, log.note].filter(Boolean).join(' · '),
          time: formatDateTime(log.recordedAt).slice(5),
        }));
      this.setData({ recordsLoading: false, weights, latestWeight: weights[weights.length - 1] || null,
        weightDelta: weightChange(weights), plot: plotFor(weights, this.data.chartMode === 'bar'), dates: datesFor(weights),
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

  openDevice() {
    if (this.data.pet) wx.showModal({ title: '温湿度设备', content: '该宠物尚未连接设备，配对功能暂未开放。', showCancel: false });
  },
});
