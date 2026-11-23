const { mockPets, mockProjects, mockOrders, mockArticles, mockPosts, mockCareLogs, mockProviders, mockComments, mockReminders } = require('./mock');
const { normalizeError, safeRequestId } = require('./errors');

const SESSION_STORAGE_KEY = 'petscape_session_token';
let loginPromise = null;
let mockOwnerProfile = { nickname: '', avatarAssetId: null, avatarUrl: null };

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
  return ready.then(async () => {
    const sentToken = wx.getStorageSync(SESSION_STORAGE_KEY);
    try {
      return await requestOnce(path, options, sentToken);
    } catch (error) {
      // All current protected routes return this guard response before mutation.
      // Never replay transport failures, arbitrary 401s or an already retried request.
      if (!needsAuth || error.statusCode !== 401 || !error.data || error.data.error !== 'unauthorized') throw error;
      const currentToken = wx.getStorageSync(SESSION_STORAGE_KEY);
      if (!currentToken || currentToken === sentToken) await login();
      return requestOnce(path, options);
    }
  });
}

function requestOnce(path, options = {}, sessionToken = wx.getStorageSync(SESSION_STORAGE_KEY)) {
  const stage = path === '/api/miniapp/auth/login' ? 'session-exchange' : 'api';

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app().globalData.apiBaseUrl}${path}`,
      method: options.method || 'GET',
      timeout: options.timeout || 15000,
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
        if (response.statusCode === 401 && options.auth !== false && sessionToken
            && sessionToken === wx.getStorageSync(SESSION_STORAGE_KEY)) {
          wx.removeStorageSync(SESSION_STORAGE_KEY);
        }
        const requestId = response.header && (response.header['x-request-id'] || response.header['X-Request-Id']);
        reportRequestError(path, response.statusCode, 'http', requestId);
        reject(normalizeError({ statusCode: response.statusCode, data: response.data, requestId }, stage));
      },
      fail(error) {
        const failure = normalizeError(error, stage);
        // Keep the existing server analytics enum; detailed categories stay local.
        reportRequestError(path, 0, 'network');
        reject(failure);
      },
    });
  });
}

function reportRequestError(path, statusCode, code, requestId) {
  if (path === '/api/v1/analytics/events') return;
  requestId = safeRequestId(requestId);
  requestOnce('/api/v1/analytics/events', { method: 'POST', auth: false, data: { eventName: 'client.request_error', path: '/miniapp', properties: { statusCode, code, ...(requestId ? { requestId } : {}) } } }).catch(() => undefined);
}

function login() {
  if (loginPromise) return loginPromise;
  loginPromise = new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success: ({ code }) => {
        if (!code) {
          reject({ statusCode: 400, code: 'WX_LOGIN_CODE_MISSING', stage: 'wx-login', data: { error: 'missing_wx_login_code' } });
          return;
        }
        requestOnce('/api/miniapp/auth/login', {
          auth: false,
          method: 'POST',
          data: { code },
        })
          .then((result) => {
            if (!result || typeof result.sessionToken !== 'string' || !result.sessionToken.trim()) {
              reject({ statusCode: 502, code: 'SESSION_INVALID', stage: 'session-exchange', data: { error: 'missing_session_token' } });
              return;
            }
            wx.setStorageSync(SESSION_STORAGE_KEY, result.sessionToken);
            resolve(result);
          })
          .catch(reject);
      },
      fail: (error) => reject(normalizeError(error, 'wx-login')),
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
  if (path === '/api/v1/profile' && (!options.method || options.method === 'GET')) return Promise.resolve({ ...mockOwnerProfile });
  if (path === '/api/v1/profile' && options.method === 'PATCH') {
    mockOwnerProfile = { ...mockOwnerProfile, ...options.data }; return Promise.resolve({ ...mockOwnerProfile });
  }
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
      sizeLevel: options.data.sizeLevel ?? null,
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
    const pet = mockPets.find((item) => item.id === decodeURIComponent(petMatch[1]));
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
  if (path === '/api/v1/content/articles' && (!options.method || options.method === 'GET')) {
    const category = options.data && options.data.category;
    return Promise.resolve({ articles: category ? mockArticles.filter((item) => item.category === category) : mockArticles });
  }
  const articleMatch = /^\/api\/v1\/content\/articles\/([^/]+)$/.exec(path);
  if (articleMatch) {
    const article = mockArticles.find((item) => item.id === articleMatch[1]);
    return article ? Promise.resolve(article) : Promise.reject({ statusCode: 404 });
  }
  if (path === '/api/v1/community/posts' && (!options.method || options.method === 'GET')) {
    const topic = options.data && options.data.topic;
    return Promise.resolve({ posts: topic ? mockPosts.filter((item) => item.topic === topic) : mockPosts });
  }
  if (path === '/api/v1/community/posts' && options.method === 'POST') {
    const post = { id: `mock-post-${Date.now()}`, ...options.data, author: '我', authorName: '我', time: '刚刚', likeCount: 0, likes: 0, commentCount: 0, comments: 0 };
    return Promise.resolve({ id: post.id, status: 'pending', createdAt: new Date().toISOString() });
  }
  const postDetailMatch = /^\/api\/v1\/community\/posts\/([^/]+)$/.exec(path);
  if (postDetailMatch) {
    const post = mockPosts.find((item) => item.id === postDetailMatch[1]);
    return post ? Promise.resolve(post) : Promise.reject({ statusCode: 404 });
  }
  const likeMatch = /^\/api\/v1\/community\/posts\/([^/]+)\/like$/.exec(path);
  if (likeMatch && options.method === 'POST') {
    const post = mockPosts.find((item) => item.id === likeMatch[1]);
    if (!post) return Promise.reject({ statusCode: 404, data: { error: 'not_found' } });
    const liked = Boolean(options.data.liked);
    post.likeCount += liked === Boolean(post._liked) ? 0 : liked ? 1 : -1;
    post._liked = liked;
    post.liked = liked;
    post.likes = post.likeCount;
    return Promise.resolve({ postId: post.id, liked: post._liked, likeCount: post.likeCount });
  }
  const commentMatch = /^\/api\/v1\/community\/posts\/([^/]+)\/comments$/.exec(path);
  if (commentMatch && (!options.method || options.method === 'GET')) return Promise.resolve({ comments: mockComments.filter((item) => item.postId === commentMatch[1] && item.status === 'published') });
  if (commentMatch && options.method === 'POST') {
    const comment = { id: `mock-comment-${Date.now()}`, postId: commentMatch[1], body: options.data.body, status: 'pending', createdAt: new Date().toISOString() };
    mockComments.push(comment); return Promise.resolve(comment);
  }
  if (path === '/api/v1/care-logs' && (!options.method || options.method === 'GET')) {
    const petId = options.data && options.data.petId;
    return Promise.resolve({ logs: petId ? mockCareLogs.filter((item) => item.petId === petId) : mockCareLogs });
  }
  if (path === '/api/v1/care-logs' && options.method === 'POST') {
    const log = { id: `mock-log-${Date.now()}`, ...options.data, createdAt: new Date().toISOString() };
    mockCareLogs.unshift(log);
    return Promise.resolve(log);
  }
  if (path === '/api/v1/service-providers' && (!options.method || options.method === 'GET')) {
    const query = options.data || {};
    return Promise.resolve({ providers: mockProviders.filter((item) => (!query.city || item.city === query.city) && (!query.serviceType || item.serviceType === query.serviceType)) });
  }
  if (path === '/api/v1/care-reminders' && (!options.method || options.method === 'GET')) return Promise.resolve({ reminders: mockReminders.filter((item) => !options.data.petId || item.petId === options.data.petId) });
  if (path === '/api/v1/care-reminders' && options.method === 'POST') {
    const reminder = { id: `mock-reminder-${Date.now()}`, ...options.data, completedAt: null };
    mockReminders.push(reminder); return Promise.resolve(reminder);
  }
  const reminderMatch = /^\/api\/v1\/care-reminders\/([^/]+)$/.exec(path);
  if (reminderMatch && options.method === 'PATCH') {
    const reminder = mockReminders.find((item) => item.id === reminderMatch[1]);
    if (!reminder) return Promise.reject({ statusCode: 404 });
    reminder.completedAt = reminder.completedAt || new Date().toISOString(); return Promise.resolve(reminder);
  }
  if (path === '/api/v1/analytics/events' && options.method === 'POST') return Promise.resolve({ accepted: true });
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
  return request(`/api/v1/pets/${encodeURIComponent(id)}`, { method: 'GET' });
}

function createPet(data) {
  return request('/api/v1/pets', { method: 'POST', data });
}

function updatePet(id, data) {
  return request(`/api/v1/pets/${id}`, { method: 'PATCH', data });
}

function uploadPetPhoto(id, photo) {
  if (app().globalData.mockMode) return Promise.reject({ code: 'PHOTO_REQUIRES_CONNECTION' });
  return request(`/api/v1/pets/${encodeURIComponent(id)}/cover-upload`, {
    method: 'POST', data: photo.bytes, header: { 'content-type': photo.mime }, timeout: 60000,
  });
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

function listArticles(query = {}) { return request('/api/v1/content/articles', { data: query, auth: false }); }
function listCommunityPosts(query = {}) { return request('/api/v1/community/posts', { data: query, auth: false }); }
function createCommunityPost(data) { return request('/api/v1/community/posts', { method: 'POST', data }); }
function listCommunityComments(id) { return request(`/api/v1/community/posts/${id}/comments`, { auth: false }); }
function createCommunityComment(id, data) { return request(`/api/v1/community/posts/${id}/comments`, { method: 'POST', data }); }
function toggleCommunityPostLike(id, liked) { return request(`/api/v1/community/posts/${id}/like`, { method: 'POST', data: { liked } }); }
function listCareLogs(query = {}) { return request('/api/v1/care-logs', { data: query }); }
function createCareLog(data) { return request('/api/v1/care-logs', { method: 'POST', data }); }
function listServiceProviders(query = {}) { return request('/api/v1/service-providers', { data: query, auth: false }); }
function trackEvent(data) { return request('/api/v1/analytics/events', { method: 'POST', data, auth: false }); }
function getArticle(id) { return request(`/api/v1/content/articles/${id}`, { auth: false }); }
function getCommunityPost(id) { return request(`/api/v1/community/posts/${id}`, { auth: false }); }
function listCareReminders(query = {}) { return request('/api/v1/care-reminders', { data: query }); }
function createCareReminder(data) { return request('/api/v1/care-reminders', { method: 'POST', data }); }
function completeCareReminder(id) { return request(`/api/v1/care-reminders/${id}`, { method: 'PATCH', data: { completed: true } }); }

module.exports = {
  getProfile: () => request('/api/v1/profile'),
  updateProfile: (data) => request('/api/v1/profile', { method: 'PATCH', data }),
  uploadOwnerAvatar: (photo) => app().globalData.mockMode ? Promise.reject({ code: 'PHOTO_REQUIRES_CONNECTION' })
    : request('/api/v1/profile/avatar-upload', { method: 'POST', data: photo.bytes, header: { 'content-type': photo.mime }, timeout: 60000 }),
  request,
  login,
  ensureSession,
  listPets,
  getPet,
  createPet,
  updatePet,
  uploadPetPhoto,
  listProjects,
  createProject,
  listOrders,
  listArticles,
  listCommunityPosts,
  createCommunityPost,
  listCommunityComments,
  createCommunityComment,
  toggleCommunityPostLike,
  listCareLogs,
  createCareLog,
  listServiceProviders,
  trackEvent,
  getArticle,
  getCommunityPost,
  listCareReminders,
  createCareReminder,
  completeCareReminder,
};
