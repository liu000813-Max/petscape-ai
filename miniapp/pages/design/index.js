const { listProjects, createProject } = require('../../utils/request');
const { canUseEmbeddedWorkbench } = require('../../utils/capabilities');

Page({
  data: { projects: [], loading: true, creating: false, embeddedWorkbench: false },

  onShow() {
    this.setData({ embeddedWorkbench: canUseEmbeddedWorkbench() });
    return this.loadProjects();
  },

  async loadProjects() {
    this.setData({ loading: true });
    try {
      const result = await listProjects();
      this.setData({ projects: result.projects || [], loading: false });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.statusCode === 401 ? '登录后保存项目' : '读取项目失败', icon: 'none' });
    }
  },

  createDesign() {
    if (this.data.creating) return;
    wx.showModal({
      title: '记录栖境想法',
      editable: true,
      placeholderText: '例如：小岩的星云栖境',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ creating: true });
        try {
          const project = await createProject(result.content || '未命名宠境项目');
          this.setData({ projects: [project, ...this.data.projects], creating: false });
          wx.showToast({ title: '项目已创建', icon: 'success' });
        } catch (error) {
          this.setData({ creating: false });
          wx.showToast({ title: '创建失败', icon: 'none' });
        }
      },
    });
  },

  openProject(event) {
    const id = event.currentTarget.dataset.id;
    const project = this.data.projects.find((item) => item.id === id);
    wx.navigateTo({ url: `/pages/viewer/index?projectId=${encodeURIComponent(id)}&title=${encodeURIComponent(project ? project.title || '' : '')}` });
  },
});
