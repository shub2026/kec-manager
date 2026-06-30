import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { useSortable } from './useSortable';

/**
 * 通用 CRUD 列表 composable
 * @param {object} api - API 函数集合
 * @param {Function} api.list - 获取列表 (返回 res)
 * @param {Function} api.create - 创建条目
 * @param {Function} api.update - 更新条目
 * @param {Function} api.remove - 删除条目
 * @param {object} options
 * @param {string} options.nameField - 名称字段名（默认 'name'）
 * @param {string} options.nameLabel - 名称标签（用于验证提示，如 '学院名称'）
 * @param {object} options.defaultForm - 默认表单值
 * @param {Function} [options.getDeleteWarning] - 计算"删除前置警告文案"的函数：(row) => string | ''
 *        返回非空字符串时，删除确认弹窗会额外显示一段红色提示
 * @returns {object}
 */
export function useCrudList(api, options = {}) {
  const {
    nameField = 'name',
    nameLabel = '名称',
    defaultForm = { id: null, name: '', code: '', description: '' },
    getDeleteWarning = null,
  } = options;

  const list = ref([]);
  const loading = ref(false);
  const dialogVisible = ref(false);
  const saving = ref(false);
  const form = ref({ ...defaultForm });

  // 删除确认弹窗状态
  const deleteConfirmVisible = ref(false);
  const deletingId = ref(null);
  const deletingRow = ref(null);
  const deleting = ref(false);

  // 弹窗前置警告文案（基于当前 deletingRow 计算）
  const deleteWarning = computed(() => {
    if (!deletingRow.value || typeof getDeleteWarning !== 'function') return '';
    return getDeleteWarning(deletingRow.value) || '';
  });

  const { handleMoveUp, handleMoveDown } = useSortable(list, api.update, silentReload);

  async function load() {
    loading.value = true;
    try {
      const res = await api.list();
      list.value = res.data || [];
    } finally {
      loading.value = false;
    }
  }

  async function silentReload() {
    try {
      const res = await api.list();
      list.value = res.data || [];
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error('刷新数据失败:', e);
      }
    }
  }

  function openDialog(row) {
    form.value = row ? { ...row } : { ...defaultForm };
    dialogVisible.value = true;
  }

  async function handleSave() {
    if (!form.value[nameField]) return ElMessage.warning(`请输入${nameLabel}`);
    saving.value = true;
    try {
      if (form.value.id) {
        await api.update(form.value.id, form.value);
      } else {
        await api.create(form.value);
      }
      ElMessage.success('保存成功');
      dialogVisible.value = false;
      await silentReload();
    } catch (e) {
      if (import.meta.env.DEV) console.error('保存失败:', e);
      ElMessage.error(e?.response?.data?.message || '保存失败，请重试');
    } finally {
      saving.value = false;
    }
  }

  async function handleDelete(id) {
    deletingId.value = id;
    // 同步查找对应行数据，供弹窗显示关联警告
    deletingRow.value = list.value.find((item) => item.id === id) || null;
    deleteConfirmVisible.value = true;
  }

  async function confirmDelete() {
    deleting.value = true;
    try {
      await api.remove(deletingId.value);
      ElMessage.success('删除成功');
      await silentReload();
      deleteConfirmVisible.value = false;
    } catch {
      deleteConfirmVisible.value = false;
      // request.js 拦截器已显示后端返回的错误消息，此处不再重复弹窗
    } finally {
      deletingId.value = null;
      deletingRow.value = null;
      deleting.value = false;
    }
  }

  function cancelDelete() {
    deleteConfirmVisible.value = false;
    deletingId.value = null;
    deletingRow.value = null;
  }

  onMounted(() => {
    load();
  });

  return {
    list,
    loading,
    dialogVisible,
    saving,
    form,
    handleMoveUp,
    handleMoveDown,
    openDialog,
    handleSave,
    handleDelete,
    load,
    silentReload,
    // 删除确认弹窗相关
    deleteConfirmVisible,
    deleting,
    deletingRow,
    deleteWarning,
    confirmDelete,
    cancelDelete,
  };
}
