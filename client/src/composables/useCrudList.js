import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElNotification } from 'element-plus';
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
 * @param {import('vue').Ref} [options.formRef] - el-form 的 ref，用于提交前 validate
 * @param {Function} [options.transformForm] - 提交前转换表单数据的函数（如 snake_case 转换）
 * @param {import('vue').Ref|Function} [options.listParams] - 加载列表时的参数 ref/computed/函数
 * @returns {object}
 */
export function useCrudList(api, options = {}) {
  const {
    defaultForm = { id: null, name: '', code: '', description: '' },
    getDeleteWarning = null,
    formRef = null,
    transformForm = null,
    listParams = null,
  } = options;

  const list = ref([]);
  const loading = ref(false);
  // P0 修复：列表加载错误状态。load() 开始时清空、失败时写入消息，
  // 供列表页渲染 ListErrorState 占位（替代原先静默失败→误显空状态的缺陷）
  const error = ref(null);
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
    error.value = null;
    try {
      const params = typeof listParams === 'function' ? listParams() : listParams?.value || {};
      const res = await api.list(params);
      // 防御：res.data 为 undefined 且 res 非数组时若直接赋值，v-for 会遍历对象
      list.value = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    } catch (e) {
      // P0 修复：记录错误消息，供列表区渲染 ListErrorState（区分「无数据」与「加载失败」）
      error.value = e?.response?.data?.message || '数据加载失败，请稍后重试';
      if (import.meta.env.DEV) console.error('加载失败:', e);
    } finally {
      loading.value = false;
    }
  }

  async function silentReload() {
    try {
      const params = typeof listParams === 'function' ? listParams() : listParams?.value || {};
      const res = await api.list(params);
      list.value = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    } catch (e) {
      // FE-P1-3修复：silentReload 用于保存/排序/删除后静默刷新，失败时不能完全静默
      // 否则用户已看到"保存成功"提示，但列表实际未更新，造成数据与提示不一致
      if (import.meta.env.DEV) {
        console.error('刷新数据失败:', e);
      }
      ElMessage.warning('数据已保存，列表刷新失败，请手动刷新页面');
    }
  }

  function openDialog(row) {
    form.value = row ? { ...row } : { ...defaultForm };
    dialogVisible.value = true;
  }

  async function handleSave() {
    // 如果有 formRef，先 validate
    if (formRef?.value) {
      // H-1 修复：捕获 validate() 失败，避免 unhandled rejection
      try {
        await formRef.value.validate();
      } catch {
        return;
      }
    }
    saving.value = true;
    try {
      const submitData = transformForm ? transformForm(form.value) : form.value;
      if (form.value.id) {
        await api.update(form.value.id, submitData);
        ElMessage.success('更新成功');
      } else {
        await api.create(submitData);
        ElMessage.success('创建成功');
      }
      dialogVisible.value = false;
      await silentReload();
    } catch (e) {
      // 拦截器已显示错误，不重复弹窗
      if (import.meta.env.DEV) console.error('保存失败:', e);
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
    const targetName = deletingRow.value?.name || '该记录';
    try {
      // silent:true 抑制拦截器 ElMessage，由本函数统一用 ElNotification 展示原因与结果
      await api.remove(deletingId.value, { silent: true });
      ElNotification({
        title: '删除成功',
        message: `已删除：${targetName}`,
        type: 'success',
        duration: 4000,
      });
      await silentReload();
      deleteConfirmVisible.value = false;
    } catch (e) {
      const reason = e?.response?.data?.message || e?.message || '未知错误';
      ElNotification({
        title: '删除失败',
        message: `${targetName}：${reason}`,
        type: 'error',
        duration: 6000,
      });
      deleteConfirmVisible.value = false;
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
    error,
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
