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
  },

  onShow() {
    if (!guard()) return;
    if (!this.data.list.length) this.reload();
  },

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
        usageCount: t.usageCount || 0,
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
    this.reload().then(() => wx.stopPullDownRefresh());
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/textbook-detail/textbook-detail?id=${id}` });
  },
});
