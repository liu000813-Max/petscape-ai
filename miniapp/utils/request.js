const { mockPets, mockProjects, mockOrders } = require('./mock');

const SESSION_STORAGE_KEY = 'petscape_session_token';
let loginPromise = null;

function app() {
  return getApp();
}

function request(path, options = {}) {
  const currentApp = app();
  if (currentApp.globalData.mockMode) {
    return mockRequest(path, options);
  }

  const needsAuth = options.auth !== false && path !== '/api/miniapp/auth/login';
  const ready = needsAuth ? ensureSession() : Promise.resolve();
  return ready.then(() => requestOnce(path, options));
}

function requestOnce(path, options = {}) {
  const sessionToken = wx.getStorageSync(SESSION_STORAGE_KEY);

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app().globalData.apiBaseUrl}${path}`,
      method: options.method || 'GET',
      data: options.data,
      header: {
        'content-type': 'application/json',
        ...(sessionToken ? { 'X-PetScape-Session': sessionToken } : {}),
        ...(options.header || {}),
      },
      withCredentials: true,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }
        if (response.statusCode === 401) {
          wx.removeStorageSync(SESSION_STORAGE_KEY);
        }
        reject({ statusCode: response.statusCode, data: response.data });
      },
      fail: reject,
    });
  });
}

function login() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => {
        if (!code) {
          reject({ statusCode: 400, data: { error: 'missing_wx_login_code' } });
          return;
        }
        requestOnce('/api/miniapp/auth/login', {
          auth: false,
          method: 'POST',
          data: { code },
        })
          .then((result) => {
            if (!result.sessionToken) {
              reject({ statusCode: 502, data: { error: 'missing_session_token' } });
              return;
            }
            wx.setStorageSync(SESSION_STORAGE_KEY, result.sessionToken);
            resolve(result);
          })
          .catch(reject);
      },
      fail: reject,
    });
  }).finally(() => {
    loginPromise = null;
  });
  return loginPromise;
}

function ensureSession() {
  return wx.getStorageSync(SESSION_STORAGE_KEY) ? Promise.resolve() : login().then(() => undefined);
}

function mockRequest(path, options) {
  if (path === '/api/v1/pets' && (!options.method || options.method === 'GET')) {
    return Promise.resolve({ pets: mockPets });
  }
  if (path === '/api/v1/pets' && options.method === 'POST') {
    const pet = {
      id: `mock-pet-${Date.now()}`,
      name: options.data.name,
      speciesCode: options.data.speciesCode || 'other',
      customSpeciesName: options.data.customSpeciesName || null,
      breed: options.data.breed || null,
      sizeLevel: options.data.sizeLevel || 3,
      lifeStage: options.data.lifeStage || 'unknown',
      behaviorTraits: options.data.behaviorTraits || [],
      environmentNotes: options.data.environmentNotes || null,
      specialNeeds: options.data.specialNeeds || null,
      coverUrl: null,
    };
    mockPets.unshift(pet);
    return Promise.resolve(pet);
  }
  const petMatch = /^\/api\/v1\/pets\/([^/]+)$/.exec(path);
  if (petMatch && options.method === 'GET') {
    const pet = mockPets.find((item) => item.id === petMatch[1]);
    return pet ? Promise.resolve(pet) : Promise.reject({ statusCode: 404, data: { error: 'not_found' } });
  }
  if (petMatch && options.method === 'PATCH') {
    const pet = mockPets.find((item) => item.id === petMatch[1]);
    if (!pet) return Promise.reject({ statusCode: 404, data: { error: 'not_found' } });
    Object.assign(pet, options.data);
    return Promise.resolve(pet);
  }
  if (path === '/api/v1/projects' && (!options.method || options.method === 'GET')) {
    return Promise.resolve({ projects: mockProjects });
  }
  if (path === '/api/v1/commerce/orders' && (!options.method || options.method === 'GET')) {
    return Promise.resolve({ orders: mockOrders });
  }
  if (path === '/api/v1/projects' && options.method === 'POST') {
    const project = {
      id: `mock-project-${Date.now()}`,
      title: options.data && options.data.title ? options.data.title : '未命名宠境项目',
      status: 'editable',
      updatedAt: new Date().toISOString(),
    };
    mockProjects.unshift(project);
    return Promise.resolve(project);
  }
  return Promise.reject({ statusCode: 404, data: { error: 'mock_not_implemented' } });
}

function listPets() {
  return request('/api/v1/pets');
}

function getPet(id) {
  return request(`/api/v1/pets/${id}`);
}

function createPet(data) {
  return request('/api/v1/pets', { method: 'POST', data });
}

function updatePet(id, data) {
  return request(`/api/v1/pets/${id}`, { method: 'PATCH', data });
}

function listProjects() {
  return request('/api/v1/projects');
}

function createProject(title) {
  return request('/api/v1/projects', { method: 'POST', data: { title } });
}

function listOrders() {
  return request('/api/v1/commerce/orders');
}

module.exports = {
  request,
  login,
  ensureSession,
  listPets,
  getPet,
  createPet,
  updatePet,
  listProjects,
  createProject,
  listOrders,
};
