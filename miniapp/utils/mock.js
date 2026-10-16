const mockPets = [
  {
    id: 'mock-pet-1',
    name: '米粒',
    speciesCode: 'rat',
    breed: '花枝鼠',
    sizeLevel: 2,
    lifeStage: 'adult',
    behaviorTraits: ['好奇', '爱探索', '喜欢互动'],
    environmentNotes: '喜欢有活动空间、可替换材质和藏身处的环境。',
    specialNeeds: null,
    coverUrl: null,
  },
];

const mockProjects = [
  {
    id: 'mock-project-1',
    title: '米粒的探索栖境',
    status: 'editable',
    updatedAt: '2026-10-15T08:00:00.000Z',
  },
];

const mockOrders = [
  {
    id: 'mock-order-1',
    status: 'design_confirmed',
    amountCent: 39900,
    currency: 'CNY',
    productCode: 'PETG-HABITAT-MVP',
    createdAt: '2026-10-12T08:00:00.000Z',
  },
];

module.exports = { mockPets, mockProjects, mockOrders };
