const { getPet, createPet, updatePet } = require('../../utils/request');
const { SPECIES_OPTIONS: speciesOptions } = require('../../utils/species');

const { LIFE_STAGE_OPTIONS: lifeStageOptions, getLifeStageReference } = require('../../utils/life-stages');

Page({
  data: {
    id: '',
    isEdit: false,
    loading: false,
    saving: false,
    form: {
      name: '',
      speciesCode: 'rat',
      customSpeciesName: '',
      breed: '',
      lifeStage: 'unknown',
      environmentNotes: '',
      specialNeeds: '',
    },
    speciesOptions,
    lifeStageOptions,
    speciesIndex: 0,
    lifeStageIndex: 4,
    lifeStageReference: getLifeStageReference('rat'),
    lifeStageWarning: '',
  },

  onLoad(query) {
    if (!query.id) return;
    this.setData({ id: query.id, isEdit: true, loading: true });
    wx.setNavigationBarTitle({ title: '编辑档案' });
    return getPet(query.id)
      .then((pet) => {
        const speciesCode = pet.speciesCode || 'other';
        const recognized = !pet.lifeStage || lifeStageOptions.some((option) => option.value === pet.lifeStage);
        const lifeStage = recognized ? pet.lifeStage || 'unknown' : 'unknown';
        const speciesIndex = Math.max(0, speciesOptions.findIndex((item) => item.value === speciesCode));
        const lifeStageIndex = Math.max(0, lifeStageOptions.findIndex((item) => item.value === lifeStage));
        this.setData({
          loading: false,
          speciesIndex,
          lifeStageIndex,
          lifeStageReference: getLifeStageReference(speciesCode, pet.breed, pet.customSpeciesName),
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
        this.setData({ loading: false });
        wx.showToast({ title: '档案读取失败', icon: 'none' });
      });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
    if (field === 'breed' || field === 'customSpeciesName') this.refreshLifeStageReference();
  },

  onSpeciesChange(event) {
    const index = Number(event.detail.value);
    if (!speciesOptions[index]) return;
    this.setData({ speciesIndex: index, 'form.speciesCode': speciesOptions[index].value,
      ...(speciesOptions[index].value !== 'other' ? { 'form.customSpeciesName': '' } : {}),
    });
    this.refreshLifeStageReference();
  },

  refreshLifeStageReference() {
    const { speciesCode, breed, customSpeciesName } = this.data.form;
    this.setData({ lifeStageReference: getLifeStageReference(speciesCode, breed, customSpeciesName) });
  },

  onLifeStageChange(event) {
    const index = Number(event.detail.value);
    if (!Number.isInteger(index) || !lifeStageOptions[index]) return;
    this.setData({ lifeStageIndex: index, 'form.lifeStage': lifeStageOptions[index].value, lifeStageWarning: '' });
  },

  async submit() {
    if (this.data.saving || this.data.loading) return;
    if (this.data.lifeStageWarning) {
      wx.showToast({ title: '请先重新确认生命阶段', icon: 'none' });
      return;
    }
    const form = this.data.form;
    if (!form.name.trim()) {
      wx.showToast({ title: '先填写宠物名字', icon: 'none' });
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
    try {
      if (this.data.isEdit) {
        await updatePet(this.data.id, payload);
      } else {
        await createPet(payload);
      }
      wx.showToast({ title: this.data.isEdit ? '档案已更新' : '档案已创建', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ saving: false });
      const message = error && error.statusCode === 401 ? '登录状态已失效' : '保存失败，请稍后再试';
      wx.showToast({ title: message, icon: 'none' });
    }
  },
});
