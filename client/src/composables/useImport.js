import { ref, computed } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import request from '../utils/request';
import { getCookie } from '../utils/cookies';

/**
 * 通用导入 Composable
 * 封装 Excel 导入的完整流程：文件校验 → 确认弹窗 → 上传 → 结果反馈
 * @param {string} endpoint - 导入 API 路径（如 '/import/teachers'）
 * @param {string} confirmMessage - 确认弹窗提示文字
 * @param {Function} onSuccess - 导入成功后的回调（通常是 load() 或 silentReload()）
 * @returns {object} { pendingFile, uploadHeaders, beforeImport, onImportSuccess, onImportError }
 */
export function useImport(endpoint, confirmMessage, onSuccess) {
  const pendingFile = ref(null);

  const uploadHeaders = computed(() => {
    const token = getCookie('token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  });

  async function beforeImport(file) {
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (!isExcel) {
      ElMessage.error('请上传Excel文件');
      return false;
    }
    pendingFile.value = file;
    try {
      await ElMessageBox.confirm(
        confirmMessage,
        '导入确认',
        { confirmButtonText: '确定导入', cancelButtonText: '取消', type: 'warning' }
      );
      confirmImport();
    } catch {
      pendingFile.value = null;
    }
    return false;
  }

  async function confirmImport() {
    try {
      const formData = new FormData();
      formData.append('file', pendingFile.value);
      const response = await request.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onImportSuccess(response);
    } catch (err) {
      onImportError(err);
    } finally {
      pendingFile.value = null;
    }
  }

  function onImportSuccess(res) {
    const data = res.data || {};
    const message = res.message || '导入完成';
    let detailMsg = message;
    if (data.errors && data.errors.length > 0) {
      detailMsg += '\n\n❌ 失败详情：';
      data.errors.forEach((error, index) => {
        detailMsg += `\n${index + 1}. ${error}`;
      });
    }
    if (data.failed && data.failed > 0) {
      ElMessage({ message: detailMsg, type: 'warning', duration: 10000, showClose: true });
    } else if (data.imported > 0 || data.overwritten > 0) {
      ElMessage({ message: detailMsg, type: 'success', duration: 8000, showClose: true });
    } else {
      ElMessage({ message: detailMsg, type: 'info', duration: 6000, showClose: true });
    }
    if (typeof onSuccess === 'function') onSuccess();
  }

  function onImportError(err) {
    if (import.meta.env.DEV) {
      console.error('导入错误:', err);
    }
    ElMessage.error('导入失败，请检查文件格式或联系管理员');
  }

  return {
    pendingFile,
    uploadHeaders,
    beforeImport,
    onImportSuccess,
    onImportError,
  };
}
