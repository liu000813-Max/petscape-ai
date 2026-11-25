const { getPet, createPet, updatePet, uploadPetPhoto } = require('../../utils/request');
const { choosePetPhoto, cropPetPhoto } = require('../../utils/pet-photo');
const { SPECIES_OPTIONS, getSpeciesMeta } = require('../../utils/species');

const { LIFE_STAGE_OPTIONS: lifeStageOptions, getLifeStageOptions, getLifeStageReference } = require('../../utils/life-stages');
const speciesOptions = [...SPECIES_OPTIONS, { value: '', label: '请选择物种' }];

Page({
  data: {
    id: '',
    isEdit: false,
    loading: false,
    saving: false,
    choosingPhoto: false,
    loadFailed: false,
    photoPreview: '',
    speciesImage: '',
    showDetails: false,
    photoNotice: '',
    photoSelected: false,
    form: {
      name: '',
      speciesCode: '',
      customSpeciesName: '',
      breed: '',
      lifeStage: 'unknown',
      environmentNotes: '',
      specialNeeds: '',
    },
    speciesOptions,
    lifeStageOptions: getLifeStageOptions(getLifeStageReference('')),
    speciesIndex: SPECIES_OPTIONS.length,
    lifeStageIndex: 4,
    lifeStageReference: getLifeStageReference(''),
    lifeStageWarning: '',
  },

  onLoad(query) {
    if (!query.id) return;
    this.setData({ id: query.id, isEdit: true, showDetails: true, loading: true });
    wx.setNavigationBarTitle({ title: '编辑档案' });
    return getPet(query.id)
      .then((pet) => {
        const speciesCode = pet.speciesCode || 'other';
        const recognized = !pet.lifeStage || lifeStageOptions.some((option) => option.value === pet.lifeStage);
        const lifeStage = recognized ? pet.lifeStage || 'unknown' : 'unknown';
        const speciesIndex = speciesOptions.findIndex((item) => item.value === speciesCode);
        const lifeStageIndex = Math.max(0, lifeStageOptions.findIndex((item) => item.value === lifeStage));
        this.setData({
          loading: false,
          photoPreview: pet.coverUrl || '',
          speciesImage: getSpeciesMeta(speciesCode).image,
          speciesIndex: speciesIndex < 0 ? SPECIES_OPTIONS.length : speciesIndex,
          lifeStageIndex,
          lifeStageReference: getLifeStageReference(speciesCode, pet.breed, pet.customSpeciesName),
          lifeStageOptions: getLifeStageOptions(getLifeStageReference(speciesCode, pet.breed, pet.customSpeciesName)),
          lifeStageWarning: recognized ? '' : '原档案阶段无法识别，请重新确认后保存。',
          form: {
            name: pet.name || '',
            speciesCode,
            customSpeciesName: pet.customSpeciesName || '',
            breed: pet.breed || '',
            lifeStage,
            environmentNotes: pet.environmentNotes || '',
            specialNeeds: pet.specialNeeds || '',
          },
        });
      })
      .catch(() => {
        this.setData({ loading: false, loadFailed: true });
        wx.showToast({ title: '档案读取失败', icon: 'none' });
      });
  },

  onInput(event) {
    if (this.data.saving) return;
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === 'breed' || field === 'customSpeciesName') this.refreshLifeStageReference();
  },

  onSpeciesChange(event) {
    if (this.data.saving) return;
    const index = Number(event.detail.value);
    if (!speciesOptions[index]) return;
    this.setData({ speciesIndex: index, 'form.speciesCode': speciesOptions[index].value,
      ...(speciesOptions[index].value !== 'other' ? { 'form.customSpeciesName': '' } : {}),
    });
    this.refreshLifeStageReference();
  },

  toggleDetails() {
    if (!this.data.saving && !this.data.choosingPhoto) this.setData({ showDetails: !this.data.showDetails });
  },

  refreshLifeStageReference() {
    const { speciesCode, breed, customSpeciesName } = this.data.form;
    const reference = getLifeStageReference(speciesCode, breed, customSpeciesName);
    this.setData({ lifeStageReference: reference, lifeStageOptions: getLifeStageOptions(reference), speciesImage: getSpeciesMeta(speciesCode).image });
  },

  onLifeStageChange(event) {
    if (this.data.saving) return;
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !lifeStageOptions[index]) return;
    this.setData({ lifeStageIndex: index, 'form.lifeStage': lifeStageOptions[index].value, lifeStageWarning: '' });
  },

  async choosePhoto() {
    if (this.data.saving || this.data.choosingPhoto || this.data.loadFailed) return;
    this.setData({ choosingPhoto: true });
    try {
      const photo = await choosePetPhoto();
      if (!photo) return;
      if (!this.data.photoSelected) this.previousPhoto = this.data.photoPreview;
      this.photoDraft = photo;
      this.uploadedPhotoId = null;
      this.setData({ photoSelected: true, photoPreview: photo.path, photoNotice: '已裁切，保存档案后生效' });
    } catch (error) { this.setData({ photoNotice: error.message }); }
    finally { this.setData({ choosingPhoto: false }); }
  },

  async recropPhoto() {
    if (this.data.saving || this.data.choosingPhoto || !this.photoDraft) return;
    this.setData({ choosingPhoto: true });
    try {
      const photo = await cropPetPhoto(this.photoDraft);
      if (!photo) return;
      this.photoDraft = photo;
      this.uploadedPhotoId = null;
      this.setData({ photoPreview: photo.path, photoNotice: '已裁切，保存档案后生效' });
    } catch (error) { this.setData({ photoNotice: error.message }); }
    finally { this.setData({ choosingPhoto: false }); }
  },

  cancelPhoto() {
    if (this.data.saving || this.data.choosingPhoto) return;
    this.photoDraft = null; this.uploadedPhotoId = null;
    this.setData({ photoPreview: this.previousPhoto || '', photoSelected: false, photoNotice: '' });
  },

  onPhotoError() { if (!this.data.photoSelected) this.setData({ photoPreview: '' }); },

  showStageSource() {
    const reference = this.data.lifeStageReference;
    wx.showModal({ title: reference.speciesName + ' · 年龄参考',
      content: reference.note + '\n\n' + (reference.sourceLabel ? '来源：' + reference.sourceLabel + '\n' + reference.sourceUrl : '暂无可确认的连续四阶段年月标准。') + '\n\n仅作饲养记录参考，不自动判断阶段。', showCancel: false });
  },

  async submit() {
    if (this.data.saving || this.data.loading || this.data.choosingPhoto || this.data.loadFailed) return;
    if (this.data.lifeStageWarning) {
      wx.showToast({ title: '请先重新确认生命阶段', icon: 'none' });
      return;
    }
    const form = this.data.form;
    if (!form.name.trim()) {
      wx.showToast({ title: '先填写宠物名字', icon: 'none' });
      return;
    }
    if (!SPECIES_OPTIONS.some(option => option.value === form.speciesCode)) {
      wx.showToast({ title: '请选择宠物物种', icon: 'none' });
      return;
    }
    if (form.speciesCode === 'other' && !form.customSpeciesName.trim()) {
      wx.showToast({ title: '请填写具体物种名称', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    const payload = {
      name: form.name.trim(),
      speciesCode: form.speciesCode,
      customSpeciesName: form.speciesCode === 'other' ? form.customSpeciesName.trim() : null,
      breed: form.breed.trim() || null,
      lifeStage: form.lifeStage,
      environmentNotes: form.environmentNotes.trim() || null,
      specialNeeds: form.specialNeeds.trim() || null,
    };
    let profileSaved = false;
    try {
      if (this.data.isEdit) {
        await updatePet(this.data.id, payload);
      } else {
        const pet = await createPet(payload);
        this.setData({ id: pet.id, isEdit: true });
      }
      profileSaved = true;
      if (this.photoDraft) {
        this.setData({ photoNotice: '正在上传头像…' });
        let alreadyApplied = false;
        if (this.uploadedPhotoId) {
          const current = await getPet(this.data.id);
          alreadyApplied = current.coverAssetId === this.uploadedPhotoId;
        }
        if (!this.uploadedPhotoId) {
          const uploaded = await uploadPetPhoto(this.data.id, this.photoDraft);
          if (!uploaded || !uploaded.assetId) throw new Error('invalid_upload');
          this.uploadedPhotoId = uploaded.assetId;
        }
        try {
          if (!alreadyApplied) await updatePet(this.data.id, { coverAssetId: this.uploadedPhotoId });
        } catch (error) {
          // A lost PATCH response can follow a successful write. Reconcile before another save.
          const current = await getPet(this.data.id).catch(() => null);
          if (!current || current.coverAssetId !== this.uploadedPhotoId) throw error;
        }
        this.photoDraft = null; this.uploadedPhotoId = null;
        this.setData({ photoSelected: false, photoNotice: '头像已保存' });
      }
      wx.showToast({ title: this.data.isEdit ? '档案已更新' : '档案已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ saving: false });
      if (profileSaved && this.photoDraft) {
        this.setData({ photoNotice: error.code === 'PHOTO_REQUIRES_CONNECTION' ? '档案已保存；演示模式不能上传头像，请连接正式接口。' : '档案已保存，头像尚未确认保存。请重试，原头像不会被删除。' });
        wx.showToast({ title: '请重试保存头像', icon: 'none' });
        return;
      }
      const message = error && error.statusCode === 401 ? '登录状态已失效' : '保存失败，请稍后再试';
      wx.showToast({ title: message, icon: 'none' });
    }
  },
});
