import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
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
 * @returns {object}
 */
export function useCrudList(api, options = {}) {
  const {
    nameField = 'name',
    nameLabel = '名称',
    defaultForm = { id: null, name: '', code: '', description: '' },
  } = options;

  const list = ref([]);
  const loading = ref(false);
  const dialogVisible = ref(false);
  const saving = ref(false);
  const form = ref({ ...defaultForm });

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
    } finally {
      saving.value = false;
    }
  }

  async function handleDelete(id) {
    try {
      await ElMessageBox.confirm('确定要删除此条目吗？此操作不可撤销。', '确认删除', {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      });
    } catch (action) {
      // 用户取消删除
      return;
    }
    try {
      await api.remove(id);
      ElMessage.success('删除成功');
      await silentReload();
    } catch (e) {
      if (import.meta.env.DEV) {
        console.error(`删除失败:`, e);
      }
      ElMessage.error('删除失败，请重试');
    }
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
  };
}
