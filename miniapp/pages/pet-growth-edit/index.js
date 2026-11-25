const { getPet, createPetGrowthEntry, uploadPetGrowthPhoto } = require('../../utils/request');
const { chooseImageFiles, readPhoto } = require('../../utils/pet-photo');
const { formatDateTime } = require('../../utils/format');
const { routePetId } = require('../../utils/pet-route');
const { describeError } = require('../../utils/errors');

const PHOTO_LIMIT = 6;

Page({
  data: {
    pet: null, loading: true, loadError: '', today: '', day: '', note: '', photos: [],
    choosing: false, saving: false, uncertain: false, saved: false, notice: '',
  },

  onLoad(options) {
    this.petId = routePetId(options?.petId);
    this.draftPhotos = [];
    this.opener = this.getOpenerEventChannel?.();
    this.receivePhotos = files => this.addPhotos(files);
    this.opener?.on('growthPhotosChosen', this.receivePhotos);
    const today = formatDateTime(new Date()).slice(0, 10);
    this.setData({ today, day: today });
    return this.loadPet();
  },

  onUnload() {
    this.closed = true;
    this.opener?.off('growthPhotosChosen', this.receivePhotos);
  },

  async loadPet() {
    this.setData({ loading: true, loadError: '' });
    try {
      const pet = this.petId && await getPet(this.petId);
      if (!pet || pet.id !== this.petId) throw { statusCode: 404 };
      if (!this.closed) this.setData({ pet: { id: pet.id, name: pet.name }, loading: false });
    } catch (error) {
      if (!this.closed) this.setData({ loading: false,
        loadError: error.statusCode === 404 ? '宠物档案不可用，请返回后重新选择。' : describeError(error).loadError });
    }
  },

  blocked() {
    return !this.data.pet || this.data.choosing || this.data.saving || this.data.uncertain || this.data.saved;
  },

  onNote(event) {
    if (!this.blocked()) this.setData({ note: event.detail.value, notice: '' });
  },

  onDay(event) {
    if (!this.blocked()) this.setData({ day: event.detail.value, notice: '' });
  },

  syncPhotos() {
    this.setData({ photos: this.draftPhotos.map(({ path }) => ({ path })) });
  },

  addPhotos(files) {
    if (this.closed || !files.length) return;
    const paths = new Set(this.draftPhotos.map(photo => photo.path));
    for (const { tempFilePath } of files) {
      if (!tempFilePath || paths.has(tempFilePath) || this.draftPhotos.length >= PHOTO_LIMIT) continue;
      paths.add(tempFilePath);
      this.draftPhotos.push({ path: tempFilePath, assetId: null });
    }
    this.syncPhotos();
    this.setData({ notice: '' });
  },

  async choosePhotos() {
    const remaining = PHOTO_LIMIT - this.draftPhotos.length;
    if (this.blocked() || remaining <= 0) return;
    this.setData({ choosing: true });
    try {
      this.addPhotos(await chooseImageFiles(remaining));
    } catch (error) {
      if (!this.closed) this.setData({ notice: error.message });
    } finally {
      if (!this.closed) this.setData({ choosing: false });
    }
  },

  removePhoto(event) {
    if (this.blocked()) return;
    const index = this.draftPhotos.findIndex(photo => photo.path === event.currentTarget.dataset.path);
    if (index < 0) return;
    this.draftPhotos.splice(index, 1);
    this.syncPhotos();
    this.setData({ notice: '' });
  },

  previewPhoto(event) {
    const current = event.currentTarget.dataset.path;
    if (this.draftPhotos.some(photo => photo.path === current)) {
      wx.previewImage({ current, urls: this.draftPhotos.map(photo => photo.path) });
    }
  },

  markSaved() {
    if (this.closed) return;
    this.pendingEntry = null;
    this.setData({ saved: true, uncertain: false, notice: '成长记录已保存' });
    wx.navigateBack();
  },

  async retrySave() {
    const pending = this.pendingEntry;
    if (this.closed || !pending || !this.data.uncertain || this.data.saving) return;
    this.setData({ saving: true });
    try {
      await this.submitEntry(pending);
    } finally {
      if (!this.closed) this.setData({ saving: false });
    }
  },

  async submitEntry(payload) {
    this.pendingEntry = payload;
    this.setData({ notice: '正在保存成长记录' });
    try {
      const entry = await createPetGrowthEntry(this.petId, payload);
      if (!entry?.id || entry.petId !== this.petId) throw new Error('growth_not_confirmed');
      this.markSaved();
    } catch (error) {
      if (this.closed) return;
      const uncertain = error.code !== 'GROWTH_REQUIRES_CONNECTION' && (!error.statusCode || error.statusCode >= 500);
      this.setData({ uncertain, notice: uncertain ? '暂未确认保存结果，请重试保存。'
        : error.code === 'GROWTH_REQUIRES_CONNECTION' ? '请使用联网版本保存。'
          : error.statusCode === 404 ? '成长记录服务暂不可用，或宠物档案已归档。'
          : error.statusCode === 409 ? '记录或照片已被保存，请返回详情核对。' : '保存失败，请检查记录后重试。' });
    }
  },

  async save(event) {
    if (this.blocked()) return;
    const note = (event?.detail?.value?.note ?? this.data.note).trim();
    if (note.length > 2000 || (!note && !this.draftPhotos.length)) {
      this.setData({ notice: note.length > 2000 ? '文字最多 2000 字。' : '请写一点文字或添加照片。' });
      return;
    }
    const now = new Date();
    const currentDay = formatDateTime(now).slice(0, 10);
    const recordedAt = this.data.day === currentDay ? now : new Date(this.data.day + 'T12:00:00');
    if (formatDateTime(recordedAt).slice(0, 10) !== this.data.day || this.data.day > currentDay) {
      this.setData({ notice: '请选择有效的记录日期。' });
      return;
    }
    this.setData({ saving: true, note, notice: '' });
    try {
      for (const [index, draft] of this.draftPhotos.entries()) {
        if (draft.assetId) continue;
        const photo = await readPhoto(draft.path);
        if (this.closed) return;
        this.setData({ notice: `正在上传第 ${index + 1} 张照片` });
        const uploaded = await uploadPetGrowthPhoto(this.petId, photo);
        if (this.closed) return;
        if (!uploaded?.assetId) throw new Error('照片上传未确认，请重试。');
        draft.assetId = uploaded.assetId;
      }
      const saveKey = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await this.submitEntry({ saveKey, note: note || null, recordedAt: recordedAt.toISOString(),
        photoAssetIds: this.draftPhotos.map(photo => photo.assetId) });
    } catch (error) {
      if (this.closed) return;
      this.setData({ notice: error instanceof Error ? error.message : '照片上传失败，请重试。已上传的照片会保留。' });
    } finally {
      if (!this.closed) this.setData({ saving: false });
    }
  },
});
