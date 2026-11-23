const TABS = [
  { pagePath: 'pages/home/index', text: '首页', icon: 'home' },
  { pagePath: 'pages/knowledge/index', text: '知识', icon: 'book' },
  { pagePath: 'pages/pet/index', text: '宠物', icon: 'paw', central: true },
  { pagePath: 'pages/community/index', text: '社区', icon: 'community' },
  { pagePath: 'pages/me/index', text: '我的', icon: 'person' },
];

function currentTab() {
  const pages = getCurrentPages();
  const route = pages.length ? pages[pages.length - 1].route : '';
  return TABS.some((tab) => tab.pagePath === route) ? route : '';
}

function syncTabBar(page, hidden = false) {
  const bar = typeof page.getTabBar === 'function' && page.getTabBar();
  if (bar && typeof bar.setData === 'function') bar.setData({ selected: page.route || currentTab(), hidden });
}

module.exports = { TABS, currentTab, syncTabBar };
