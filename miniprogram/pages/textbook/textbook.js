// pages/textbook/textbook.js
// 教材查询：搜索 + 分页列表，点击进入教材详情。
const api = require('../../utils/api.js');
const { guard } = require('../../utils/auth.js');

Page({
  data: {
    list: [],
    keyword: '',
    page: 1,
    pageSize: 20,
    total: 0,
    loading: false,
    loadingMore: false,
    finished: false,
    error: '',
    refreshing: false,
  },

  onShow() {
    if (!guard()) return;
    if (this._fromDetail) {
      this._fromDetail = false;
      return; // 从详情返回，保留搜索词与列表
    }
    if (!this.data.list.length) this.reload();
  },

  // 切走 tab 时重置搜索；从详情返回（navigateTo）不重置
  async reload() {
    this.setData({ page: 1, list: [], finished: false, error: '' });
    await this.fetch(true);
  },

  async fetch(reset) {
    if (this.data.loading || this.data.loadingMore) return;
    this.setData(reset ? { loading: true } : { loadingMore: true });
    try {
      const resp = await api.listTextbooks({
        page: this.data.page,
        pageSize: this.data.pageSize,
        title: this.data.keyword,
      });

      const items = (resp.items || []).map((t) => ({
        id: t.id,
        title: t.title,
        isbn: t.isbn || '—',
        publisher: t.publisher || '—',
        category: t.category || '—',
      }));

      const merged = reset ? items : this.data.list.concat(items);
      this.setData({
        list: merged,
        total: resp.total || 0,
        finished: merged.length >= (resp.total || 0),
        loading: false,
        loadingMore: false,
      });
    } catch (e) {
      this.setData({ error: (e && e.message) || '加载失败', loading: false, loadingMore: false });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.reload();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.reload();
  },

  onReachBottom() {
    if (this.data.finished || this.data.loading || this.data.loadingMore) return;
    this.setData({ page: this.data.page + 1 });
    this.fetch(false);
  },

  onPullDownRefresh() {
    // 后台静默刷新：保留当前列表，避免整页闪空（与首页/教学安排页范式一致）
    if (this.data.loading || this.data.loadingMore) {
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ refreshing: true, error: '', page: 1 });
    this.fetch(true)
      .then(() => {
        this.setData({ refreshing: false });
        wx.stopPullDownRefresh();
      })
      .catch((e) => {
        this.setData({ refreshing: false });
        wx.showToast({ title: (e && e.message) || '刷新失败', icon: 'none' });
        wx.stopPullDownRefresh();
      });
  },

  goDetail(e) {
    this._fromDetail = true;
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/textbook-detail/textbook-detail?id=${id}` });
  },
});
