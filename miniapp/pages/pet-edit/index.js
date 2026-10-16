const { getPet, createPet, updatePet } = require('../../utils/request');
const { SPECIES_OPTIONS: speciesOptions } = require('../../utils/species');

const lifeStageOptions = [
  { value: 'juvenile', label: '幼年' },
  { value: 'adult', label: '成年' },
  { value: 'senior', label: '老年' },
  { value: 'unknown', label: '待确认' },
];

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
      sizeLevel: 3,
      environmentNotes: '',
      specialNeeds: '',
    },
    speciesOptions,
    lifeStageOptions,
    speciesIndex: 0,
    lifeStageIndex: 3,
  },

  onLoad(query) {
    if (!query.id) return;
    this.setData({ id: query.id, isEdit: true, loading: true });
    wx.setNavigationBarTitle({ title: '编辑档案' });
    return getPet(query.id)
      .then((pet) => {
        const speciesCode = pet.speciesCode || 'other';
        const lifeStage = pet.lifeStage || 'unknown';
        const speciesIndex = Math.max(0, speciesOptions.findIndex((item) => item.value === speciesCode));
        const lifeStageIndex = Math.max(0, lifeStageOptions.findIndex((item) => item.value === lifeStage));
        this.setData({
          loading: false,
          speciesIndex,
          lifeStageIndex,
          form: {
            name: pet.name || '',
            speciesCode,
            customSpeciesName: pet.customSpeciesName || '',
            breed: pet.breed || '',
            lifeStage,
            sizeLevel: Number(pet.sizeLevel || 3),
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
  },

  onSpeciesChange(event) {
    const index = Number(event.detail.value);
    if (!speciesOptions[index]) return;
    this.setData({ speciesIndex: index, 'form.speciesCode': speciesOptions[index].value,
      ...(speciesOptions[index].value !== 'other' ? { 'form.customSpeciesName': '' } : {}),
    });
  },

  onLifeStageChange(event) {
    const index = Number(event.detail.value);
    this.setData({ lifeStageIndex: index, 'form.lifeStage': lifeStageOptions[index].value });
  },

  onSizeChange(event) {
    this.setData({ 'form.sizeLevel': Number(event.detail.value) });
  },

  async submit() {
    if (this.data.saving || this.data.loading) return;
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
      sizeLevel: Number(form.sizeLevel),
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
