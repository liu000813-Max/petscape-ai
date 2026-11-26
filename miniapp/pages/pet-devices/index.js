const { getPet } = require('../../utils/request');
const { routePetId } = require('../../utils/pet-route');

Page({
  data: { petName: '', loading: true, error: '' },

  onLoad(options) {
    this.petId = routePetId(options?.petId);
    return this.loadPet();
  },

  onUnload() { this.closed = true; },

  async loadPet() {
    this.setData({ loading: true, error: '' });
    try {
      if (!this.petId) throw { statusCode: 404 };
      const pet = await getPet(this.petId);
      if (!pet || pet.id !== this.petId) throw { statusCode: 404 };
      if (!this.closed) this.setData({ loading: false, petName: pet.name });
    } catch (error) {
      if (!this.closed) this.setData({ loading: false, error: error?.statusCode === 404 ? '宠物档案不可用。' : '宠物档案读取失败。' });
    }
  },
});
