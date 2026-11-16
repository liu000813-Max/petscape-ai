const { listPets, listCareLogs, createCareLog } = require('../../utils/request');
const { getSpeciesMeta } = require('../../utils/species');
const { track } = require('../../utils/analytics');
const { describeError } = require('../../utils/errors');
const { formatDateTime } = require('../../utils/format');

// Existing care records are free text. Never assume a unit for old values.
function weightInGrams(value, unit) {
  if (typeof value !== 'string' || !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(value.trim())) return null;
  const grams = Math.round(Number(value.trim()) * (unit === 'kg' ? 1000 : 1) * 1000) / 1000;
  return Number.isFinite(grams) && grams > 0 && grams <= 1000000 ? grams : null;
}

function weightSummary(logs, petId) {
  const records = logs.flatMap((log) => {
    if (log.petId !== petId || log.kind !== '体重' || typeof log.value !== 'string') return [];
    const match = /^\s*((?:\d+(?:\.\d{1,3})?|\.\d{1,3}))\s*(kg|g|千克|公斤|克)\s*$/i.exec(log.value);
    if (!match || !Number.isFinite(new Date(log.recordedAt).getTime())) return [];
    const grams = weightInGrams(match[1], /^(kg|千克|公斤)$/i.test(match[2]) ? 'kg' : 'g');
    return grams === null ? [] : [{ id: log.id, grams, displayValue: String(grams), recordedAt: log.recordedAt,
      date: formatDateTime(log.recordedAt).slice(5, 10), time: formatDateTime(log.recordedAt) }];
  }).sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime() || String(a.id).localeCompare(String(b.id))).slice(-7);
  const latestWeight = records.length ? records[records.length - 1] : null;
  const difference = records.length > 1 ? Math.round((latestWeight.grams - records[records.length - 2].grams) * 1000) / 1000 : null;
  const max = records.length ? Math.max(...records.map((record) => record.grams)) : 1;
  return { latestWeight, weightChange: difference === null ? '' : `${difference > 0 ? '+' : ''}${difference} g`,
    weightHistory: records.map((record) => ({ ...record, height: record.grams / max * 100 })) };
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
    selectedPetId: '',
    loading: true,
    loadError: '',
    loadErrorTitle: '',
    loadErrorDetail: '',
    mockMode: true,
    weightHistory: [],
    latestWeight: null,
    weightChange: '',
    weightLoading: false,
    weightSaving: false,
    weightError: '',
    weightDiagnostic: '',
    weightNotice: '',
    weightUnconfirmed: false,
    weightInput: '',
    weightUnit: 'g',
    weightEditorOpen: false,
    quickActions: [
      { title: '完善宠物档案', note: '记录物种与生活习性', path: '/pages/pet/index', tone: 'dark' },
      { title: '查看养护知识', note: '按物种快速查找', path: '/pages/knowledge/index', tone: 'light' },
    ],
    highlights: [
      { tag: '今日养护', title: '温度、湿度和躲避空间', note: '把知识变成每天能执行的小动作。' },
      { tag: '栖境观察', title: '让宠物的生活空间更像它自己', note: '从体型、习性和环境笔记开始了解它。' },
    ],
  },

  onShow() {
    if (this.data.weightSaving) return;
    this.setData({ mockMode: getApp().globalData.mockMode });
    track('home.view');
    return this.loadSummary();
  },

  async loadSummary() {
    if (this.data.weightSaving) return;
    const sequence = (this.summarySequence || 0) + 1; this.summarySequence = sequence;
    this.weightSequence = (this.weightSequence || 0) + 1;
    this.setData({ pet: null, pets: [], loading: true, loadError: '', loadErrorTitle: '', loadErrorDetail: '',
      weightHistory: [], latestWeight: null, weightChange: '', weightError: '', weightDiagnostic: '', weightLoading: false });
    try {
      const result = await listPets();
      if (sequence !== this.summarySequence) return;
      const pets = (result.pets || []).map(presentPet);
      const pet = pets.find((item) => item.id === this.data.selectedPetId) || pets[0] || null;
      if (this.weightDrafts) for (const id of this.weightDrafts.keys()) if (!pets.some((item) => item.id === id)) this.weightDrafts.delete(id);
      const switched = (pet ? pet.id : '') !== this.data.selectedPetId;
      this.setData({
        pet, pets, selectedPetId: pet ? pet.id : '', loading: false,
        ...(switched ? { weightInput: '', weightUnit: 'g', weightEditorOpen: false, weightNotice: '', weightUnconfirmed: false } : {}),
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
    if (this.data.loading || this.data.weightSaving) return;
    const pet = this.data.pets.find((item) => item.id === event.currentTarget.dataset.id);
    if (!pet || pet.id === this.data.selectedPetId) return;
    if (!this.weightDrafts) this.weightDrafts = new Map();
    this.weightDrafts.set(this.data.selectedPetId, {
      weightInput: this.data.weightInput, weightUnit: this.data.weightUnit, weightEditorOpen: this.data.weightEditorOpen,
      weightNotice: this.data.weightNotice, weightUnconfirmed: this.data.weightUnconfirmed,
    });
    this.setData({ pet, selectedPetId: pet.id, ...(this.weightDrafts.get(pet.id) || {
      weightInput: '', weightUnit: 'g', weightEditorOpen: false, weightNotice: '', weightUnconfirmed: false,
    }) });
    return this.loadWeights();
  },

  async loadWeights() {
    const petId = this.data.selectedPetId;
    if (!petId) return false;
    const sequence = (this.weightSequence || 0) + 1; this.weightSequence = sequence;
    this.setData({ weightLoading: true, weightError: '', weightDiagnostic: '', weightHistory: [], latestWeight: null, weightChange: '' });
    try {
      const result = await listCareLogs({ petId, limit: 100 });
      if (sequence !== this.weightSequence || petId !== this.data.selectedPetId) return false;
      this.setData({ ...weightSummary(result.logs || [], petId), weightLoading: false, weightUnconfirmed: false,
        ...(this.data.weightUnconfirmed ? { weightNotice: '记录已刷新，请核对后再保存。' } : {}) });
      return true;
    } catch (error) {
      if (sequence !== this.weightSequence || petId !== this.data.selectedPetId) return false;
      const diagnostic = describeError(error);
      this.setData({ weightLoading: false, weightError: diagnostic.loadErrorTitle, weightDiagnostic: diagnostic.loadErrorDetail });
      return false;
    }
  },

  toggleWeightEditor() {
    if (!this.data.weightSaving) this.setData({ weightEditorOpen: !this.data.weightEditorOpen });
  },
  onWeightInput(event) {
    if (!this.data.weightSaving) this.setData({ weightInput: event.detail.value });
  },
  onWeightUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    if (!this.data.weightSaving && (unit === 'g' || unit === 'kg')) this.setData({ weightUnit: unit });
  },

  async saveWeight() {
    if (this.data.loading || this.data.weightLoading || this.data.weightSaving || this.data.weightUnconfirmed || this.data.weightError || !this.data.pet) return;
    const grams = weightInGrams(this.data.weightInput, this.data.weightUnit);
    if (grams === null) { wx.showToast({ title: '请输入有效正数，最多三位小数', icon: 'none' }); return; }
    const petId = this.data.selectedPetId;
    this.setData({ weightSaving: true, weightNotice: '' });
    try {
      await createCareLog({ petId, kind: '体重', value: `${grams}g`, note: null, recordedAt: new Date().toISOString() });
      track('care.save');
      this.setData({ weightInput: '', weightEditorOpen: false, weightNotice: '体重已保存' });
      if (this.weightDrafts) this.weightDrafts.delete(petId);
      const refreshed = await this.loadWeights();
      if (!refreshed) this.setData({ weightNotice: '体重已保存，列表暂未刷新，请重试读取。' });
      wx.showToast({ title: '体重已保存', icon: 'success' });
    } catch (error) {
      const diagnostic = describeError(error);
      this.setData({ weightUnconfirmed: true, weightNotice: `保存结果未确认：${diagnostic.loadErrorTitle}。请先刷新记录，核对后再保存。` });
      wx.showToast({ title: '保存未确认，请先刷新记录', icon: 'none' });
    } finally { this.setData({ weightSaving: false }); }
  },

  onAvatarError(event) {
    const id = event.currentTarget.dataset.id;
    const pets = this.data.pets.map((pet) => pet.id === id ? { ...pet, avatarUrl: pet.avatarUrl === pet.speciesImage ? '' : pet.speciesImage } : pet);
    this.setData({ pets, pet: pets.find((pet) => pet.id === this.data.selectedPetId) || null });
  },

  openAction(event) {
    if (this.data.weightSaving) return;
    const url = event.currentTarget.dataset.path;
    if (url === '/pages/knowledge/index' || url === '/pages/pet/index') wx.switchTab({ url });
    else wx.navigateTo({ url });
  },

  openPet() {
    if (this.data.weightSaving) return;
    wx.switchTab({ url: '/pages/pet/index' });
  },

  openCare() {
    if (this.data.weightSaving) return;
    wx.navigateTo({ url: '/pages/care-log/index' });
  },
});
