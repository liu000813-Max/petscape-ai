const { createCommunityPost, listMyCommunityPosts, uploadCommunityPhoto, getPetGrowthEntry } = require('../../utils/request');
const { chooseImageFiles, readPhoto } = require('../../utils/pet-photo');
const { track } = require('../../utils/analytics');
const { POST_TOPICS, topicLabel } = require('../../utils/community-topics');
const { routePetId } = require('../../utils/pet-route');

const LIMIT = 9;
const localId = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
const removeFile = path => { if (path) wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); };

function storePhoto({ path, mime }) {
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1];
  const destPath = wx.env.USER_DATA_PATH + '/community-draft-' + localId() + '.' + extension;
  return new Promise((resolve, reject) => wx.getFileSystemManager().copyFile({
    srcPath: path, destPath, success: () => resolve(destPath), fail: () => reject(new Error('本机图片保存失败，请检查存储空间。')),
  }));
}

Page({
  data: { topics: POST_TOPICS, topicLabels: POST_TOPICS.map(topicLabel), topicIndex: 0, title: '', body: '', photos: [],
    loading: true, ready: false, choosing: false, submitting: false, submitted: false, savedDraft: false, uncertain: false,
    notice: '', limit: LIMIT, sourcePending: false },

  onLoad(options = {}) {
    this.pickFirst = options.entry === 'photo';
    this.fromGrowth = options.source === 'growth';
    this.source = this.fromGrowth ? {
      petId: routePetId(options.petId), entryId: routePetId(options.entryId), assetId: routePetId(options.assetId),
    } : null;
    return this.loadDraft();
  },

  onUnload() { this.closed = true; },

  async loadDraft() {
    this.setData({ loading: true, notice: '' });
    try {
      const { draftScope } = await listMyCommunityPosts({ limit: 1 });
      if (this.closed) return;
      if (!draftScope) throw new Error('图文发帖服务尚未启用。');
      const mode = getApp().globalData.mockMode ? 'demo' : 'live';
      this.draftKey = 'petscape_community_draft:' + mode + ':' + draftScope;
      const draft = wx.getStorageSync(this.draftKey) || {};
      this.pending = draft.pending || null;
      const photos = Array.isArray(draft.photos) ? draft.photos.slice(0, LIMIT) : [];
      this.setData({ title: draft.title || '', body: draft.body || '',
        topicIndex: POST_TOPICS[draft.topicIndex] ? draft.topicIndex : 0, photos, uncertain: Boolean(this.pending) });
      let notice = '';
      const source = this.source;
      let appended = false;
      if (source && !this.pending && !photos.some(photo => photo.assetId === source.assetId)) {
        if (photos.length >= LIMIT) notice = '草稿已满。请先移除一张，再添加这张成长照片。';
        else if (Object.values(source).every(Boolean)) {
          photos.push({ ...source, key: localId() });
          appended = true;
        }
        else notice = '成长照片不可用。';
      }
      const growthEntries = new Map();
      const resolved = await Promise.all(photos.map(async photo => {
        if (!photo.entryId) return photo;
        const { petId, entryId, assetId } = photo;
        const key = JSON.stringify([petId, entryId]);
        if (!growthEntries.has(key)) growthEntries.set(key, getPetGrowthEntry(petId, entryId));
        try {
          const entry = await growthEntries.get(key);
          return { ...photo, path: entry.photos.find(item => item.assetId === assetId)?.downloadUrl || '' };
        } catch (_) { return { ...photo, path: '' }; }
      }));
      if (this.closed) return;
      const imported = source && resolved.some(photo => photo.assetId === source.assetId && photo.path);
      if (appended && !imported) {
        resolved.pop();
        notice = '成长照片暂时无法读取。';
      }
      this.setData({ photos: resolved, loading: false, ready: true,
        sourcePending: Boolean(source && !imported && Object.values(source).every(Boolean)),
        savedDraft: Boolean(draft.title || draft.body || draft.photos?.length),
        notice: notice || (this.pending ? '上次提交结果待确认，可重试原投稿。' : '') });
      if (imported && !this.pending) {
        this.source = null;
        this.saveDraft();
      }
      if (this.pickFirst) {
        this.pickFirst = false;
        await this.choosePhotos();
      }
    } catch (error) {
      if (!this.closed) this.setData({ loading: false, ready: false, notice: error.statusCode ? '草稿读取失败，请重试。' : error.message || '登录后可继续发帖。' });
    }
  },

  blocked() { return !this.data.ready || this.data.submitting || this.data.submitted || this.data.choosing || this.data.uncertain; },

  saveDraft() {
    const { title, body, topicIndex, photos } = this.data;
    try {
      if (title || body || photos.length || this.pending) {
        wx.setStorageSync(this.draftKey, { title, body, topicIndex,
          photos: photos.map(photo => photo.entryId ? { ...photo, path: undefined } : photo), pending: this.pending });
      } else wx.removeStorageSync(this.draftKey);
      this.setData({ savedDraft: Boolean(title || body || photos.length) });
      return true;
    } catch (_) {
      this.setData({ notice: '草稿未能保存到此设备。' });
      return false;
    }
  },

  change(fields) {
    if (this.blocked()) return;
    this.setData({ ...fields, notice: '' });
    this.saveDraft();
  },
  onTitleInput(event) { this.change({ title: event.detail.value }); },
  onBodyInput(event) { this.change({ body: event.detail.value }); },
  onTopicChange(event) {
    const topicIndex = Number(event.detail.value);
    if (POST_TOPICS[topicIndex]) this.change({ topicIndex });
  },

  async choosePhotos() {
    const remaining = LIMIT - this.data.photos.length;
    if (this.blocked() || remaining < 1) return;
    this.setData({ choosing: true, notice: '' });
    const added = [];
    try {
      for (const file of await chooseImageFiles(remaining)) {
        if (this.closed) break;
        const photo = await readPhoto(file.tempFilePath);
        added.push({ key: localId(), path: await storePhoto(photo) });
      }
    } catch (error) {
      if (!this.closed) this.setData({ notice: error.message });
    } finally {
      if (this.closed) added.forEach(photo => removeFile(photo.path));
      else {
        this.setData({ photos: this.data.photos.concat(added), choosing: false });
        if (added.length) this.saveDraft();
      }
    }
  },

  photoIndex(event) { return this.data.photos.findIndex(photo => photo.key === event.currentTarget.dataset.key); },
  changeOrder(event) {
    if (this.blocked()) return;
    const photos = this.data.photos.slice();
    const from = this.photoIndex(event);
    const to = event.currentTarget.dataset.action === 'cover' ? 0 : from + Number(event.currentTarget.dataset.step);
    if (from < 0 || !Number.isInteger(to) || to < 0 || to >= photos.length || from === to) return;
    photos.splice(to, 0, photos.splice(from, 1)[0]);
    this.change({ photos });
  },
  removePhoto(event) {
    if (this.blocked()) return;
    const index = this.photoIndex(event);
    if (index < 0) return;
    const photos = this.data.photos.slice();
    const [removed] = photos.splice(index, 1);
    this.setData({ photos, notice: '' });
    if (this.saveDraft() && !removed.entryId) removeFile(removed.path);
  },
  retrySource() {
    if (!this.blocked() && this.data.sourcePending && this.data.photos.length < LIMIT && this.saveDraft()) return this.loadDraft();
  },
  previewPhoto(event) {
    const current = this.data.photos[this.photoIndex(event)]?.path;
    if (current) wx.previewImage({ current, urls: this.data.photos.map(photo => photo.path).filter(Boolean) });
  },

  clearDraft() {
    try { wx.removeStorageSync(this.draftKey); }
    catch (_) { return false; }
    this.pending = null;
    this.data.photos.filter(photo => !photo.entryId).forEach(photo => removeFile(photo.path));
    this.setData({ title: '', body: '', photos: [], savedDraft: false, uncertain: false });
    return true;
  },
  discardDraft() {
    if (this.blocked() || !this.data.savedDraft || this.confirmingDiscard) return;
    this.confirmingDiscard = true;
    wx.showModal({ title: '删除这份草稿？', confirmText: '删除', confirmColor: '#8c244b',
      success: result => {
        if (result.confirm && !this.closed && !this.blocked() && !this.clearDraft()) this.setData({ notice: '草稿删除失败。' });
      },
      complete: () => { this.confirmingDiscard = false; },
    });
  },
  saveAndExit() {
    if (!this.blocked() && this.saveDraft()) wx.navigateBack();
  },

  async submit() {
    if (!this.data.ready || this.data.submitting || this.data.submitted || this.data.choosing || this.confirmingDiscard) return;
    const { title, body, topicIndex, photos } = this.data;
    if (!this.pending && (!title.trim() || (!body.trim() && !photos.length))) {
      this.setData({ notice: '请填写标题，并添加正文或照片。' });
      return;
    }
    if (!this.pending && photos.some(photo => !photo.path && (photo.entryId || !photo.assetId))) {
      this.setData({ notice: '有照片无法读取，请移除后重新添加。' });
      return;
    }
    this.setData({ submitting: true, notice: '' });
    let uploadIndex = 0;
    try {
      if (!this.pending) {
        for (let index = 0; index < photos.length; index++) {
          if (photos[index].assetId) continue;
          uploadIndex = index + 1;
          this.setData({ notice: `正在上传 ${uploadIndex}/${photos.length}` });
          const result = await uploadCommunityPhoto(await readPhoto(photos[index].path));
          if (this.closed) return;
          if (!result?.assetId) throw new Error('图片未确认上传。');
          photos[index].assetId = result.assetId;
          this.saveDraft();
        }
        this.pending = { title: title.trim(), body: body.trim(), topic: POST_TOPICS[topicIndex],
          photoAssetIds: photos.map(photo => photo.assetId), submissionKey: 'community_' + localId() };
        if (!this.saveDraft()) {
          this.pending = null;
          return;
        }
      }
      const receipt = await createCommunityPost(this.pending);
      if (this.closed) return;
      if (!receipt?.id || receipt.status !== 'pending') throw new Error('submission_not_confirmed');
      const cleared = this.clearDraft();
      this.setData({ submitted: true, uncertain: false, notice: cleared ? '已提交审核。' : '已提交审核，本机草稿清理失败。' });
    } catch (error) {
      if (this.closed) return;
      const uncertain = Boolean(this.pending && (!error.statusCode || error.statusCode >= 500 || error.statusCode === 409));
      if (!uncertain) {
        this.pending = null;
        this.saveDraft();
      }
      this.setData({ uncertain, notice: uncertain ? '提交结果待确认。重试会核对原投稿。'
        : uploadIndex ? `第 ${uploadIndex} 张照片上传失败，内容已保留。`
        : error.statusCode === 404 ? '照片已不可用，请重新选择。' : '提交失败，内容已保留。' });
    } finally {
      if (!this.closed) this.setData({ submitting: false });
    }
    if (this.closed || !this.data.submitted) return;
    track('community.submit');
    this.openSubmissions();
  },

  openSubmissions() {
    const fail = () => wx.showToast({ title: '已提交审核，请打开我的投稿', icon: 'none' });
    getApp().communitySubmissionsEntry = true;
    if (this.fromGrowth) {
      wx.switchTab({ url: '/pages/community/index', fail });
    } else {
      try { this.getOpenerEventChannel?.()?.emit?.('communityPostSubmitted'); } catch (_) {}
      wx.navigateBack({ fail });
    }
  },
});
