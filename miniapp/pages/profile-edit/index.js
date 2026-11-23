const { getProfile, updateProfile, uploadOwnerAvatar } = require('../../utils/request');
const { choosePetPhoto, cropPetPhoto, readPhoto } = require('../../utils/pet-photo');
const { describeError } = require('../../utils/errors');

Page({
  data: { nickname: '', avatarPreview: '', photoSelected: false, choosing: false, loading: true, saving: false,
    loadFailed: false, loadError: '', loadErrorTitle: '', loadErrorDetail: '', notice: '', uncertain: false, saved: false },
  onLoad() {
    this.setData({ wechatAvatarSupported: typeof wx.canIUse === 'function' && wx.canIUse('button.open-type.chooseAvatar') });
    return this.loadProfile();
  },
  async onWechatAvatar(event) {
    if (this.blocked() || !event.detail.avatarUrl) return;
    this.setData({ choosing: true });
    try { const photo = await readPhoto(event.detail.avatarUrl); this.applyPhoto({ ...photo, sourcePath: photo.path }); }
    catch (error) { this.setData({ notice: error.message }); }
    finally { this.setData({ choosing: false }); }
  },
  onWechatAvatarError() { if (!this.blocked()) this.setData({ notice: '微信头像未选取，可重试或从相册选择。' }); },
  async loadProfile() {
    if (this.data.saving || this.data.choosing) return;
    const sequence = (this.readSequence || 0) + 1; this.readSequence = sequence;
    this.setData({ loading: true, loadFailed: false, loadError: '', loadErrorDetail: '' });
    try {
      const profile = await getProfile();
      if (sequence !== this.readSequence) return;
      this.original = profile;
      this.photoDraft = null; this.uploadedPhotoId = null; this.pendingPayload = null;
      this.setData({ nickname: profile.nickname || '', avatarPreview: profile.avatarUrl || '', photoSelected: false, loading: false, uncertain: false, saved: false, notice: '' });
    } catch (error) { if (sequence === this.readSequence) this.setData({ loading: false, loadFailed: true, ...describeError(error) }); }
  },
  blocked() { return this.data.loading || this.data.loadFailed || this.data.saving || this.data.choosing || this.data.uncertain; },
  onNickname(event) { if (!this.blocked()) this.setData({ nickname: event.detail.value, saved: false, notice: '' }); },
  async chooseAvatar() {
    if (this.blocked()) return;
    this.setData({ choosing: true });
    try { const photo = await choosePetPhoto(); if (photo) this.applyPhoto(photo); }
    catch (error) { this.setData({ notice: error.message }); }
    finally { this.setData({ choosing: false }); }
  },
  async recropAvatar() {
    if (this.blocked() || !this.photoDraft) return;
    this.setData({ choosing: true });
    try { const photo = await cropPetPhoto(this.photoDraft); if (photo) this.applyPhoto(photo); }
    catch (error) { this.setData({ notice: error.message }); }
    finally { this.setData({ choosing: false }); }
  },
  applyPhoto(photo) {
    this.photoDraft = photo; this.uploadedPhotoId = null;
    this.setData({ avatarPreview: photo.path, photoSelected: true, notice: '已裁切，保存资料后生效', saved: false });
  },
  cancelAvatar() {
    if (this.blocked()) return;
    this.photoDraft = null; this.uploadedPhotoId = null;
    this.setData({ avatarPreview: this.original?.avatarUrl || '', photoSelected: false, notice: '', saved: false });
  },
  onAvatarError() { if (!this.data.photoSelected) this.setData({ avatarPreview: '' }); },
  matches(profile, payload) { return profile.nickname === payload.nickname && profile.avatarAssetId === payload.avatarAssetId; },
  markSaved(profile) {
    this.original = profile; this.photoDraft = null; this.uploadedPhotoId = null; this.pendingPayload = null;
    this.setData({ nickname: profile.nickname, avatarPreview: profile.avatarUrl || '', photoSelected: false, uncertain: false, saved: true, notice: '个人资料已保存' });
    wx.showToast({ title: '资料已保存', icon: 'success' });
  },
  async checkSave() {
    if (!this.data.uncertain || this.data.saving || !this.pendingPayload) return;
    this.setData({ saving: true });
    try {
      const current = await getProfile();
      if (this.matches(current, this.pendingPayload)) this.markSaved(current);
      else this.setData({ uncertain: false, notice: '已核对，服务器资料与本次修改不一致。草稿已保留，可确认后重新保存。' });
    } catch (error) { this.setData({ notice: '暂时无法核对保存结果，请稍后再试。', ...describeError(error) }); }
    finally { this.setData({ saving: false }); }
  },
  async saveProfile(event) {
    if (this.blocked() || this.data.saved) return;
    if (typeof event?.detail?.value?.nickname === 'string') this.setData({ nickname: event.detail.value.nickname });
    const nickname = this.data.nickname.trim();
    if (!nickname || nickname.length > 30) { wx.showToast({ title: '请填写 1–30 字的昵称', icon: 'none' }); return; }
    this.setData({ saving: true, notice: '' });
    let writing = false;
    try {
      if (this.photoDraft && !this.uploadedPhotoId) {
        const result = await uploadOwnerAvatar(this.photoDraft);
        if (!result?.assetId) throw new Error('invalid_upload');
        this.uploadedPhotoId = result.assetId;
      }
      const payload = { nickname, avatarAssetId: this.uploadedPhotoId || this.original.avatarAssetId || null };
      this.pendingPayload = payload; writing = true;
      const result = await updateProfile(payload);
      if (!this.matches(result, payload)) throw new Error('profile_not_confirmed');
      this.markSaved(result);
    } catch (error) {
      if (writing) {
        this.setData({ uncertain: true, notice: '保存结果待核对，请先检查保存状态。草稿与已上传的头像已保留。' });
        try { const current = await getProfile(); if (this.matches(current, this.pendingPayload)) this.markSaved(current); } catch (_) { /* Explicit reconciliation remains available. */ }
      } else this.setData({ notice: error.code === 'PHOTO_REQUIRES_CONNECTION' ? '演示模式不能上传头像，请连接正式接口。' : '头像尚未上传成功，请重试。原资料不会被替换。' });
    } finally { this.setData({ saving: false }); }
  },
});
