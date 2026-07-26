import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  runOptimizeScheduleWithProgress,
  applyOptimizeResult as applyOptimizeResultApi,
} from '../../../api/teachingArrange';

/**
 * 排课优化逻辑 composable
 * 封装排课优化的状态管理和进度控制
 *
 * 进度反馈说明：
 * 排课优化走 SSE 推送进度，但弹窗体系（ArrangeProgressDialog）字段为排课设计，
 * 优化阶段不产生 processed/total 等批量进度数据。为避免误导，优化期间仅通过
 * 按钮文字展示 progressMessage，不弹出统一进度弹窗。
 */
export function useOptimize({ selectedSemester, loadData, confirmHistoricalEdit }) {
  const optimizing = ref(false);
  const optimizeConfirmVisible = ref(false);
  const optimizeResultVisible = ref(false);
  const optimizeResult = ref(null);

  // 进度消息（用于按钮文字展示，统一进度弹窗不接入）
  const progressMessage = ref('');

  function handleOptimize() {
    optimizeConfirmVisible.value = true;
  }

  async function doOptimize() {
    if (!(await confirmHistoricalEdit())) return;

    optimizing.value = true;
    progressMessage.value = '';

    try {
      const result = await runOptimizeScheduleWithProgress(
        {
          semester: selectedSemester.value,
          mode: 'standard',
        },
        (progress) => {
          progressMessage.value = progress.message || '';
        }
      );

      if (result.success && result.data) {
        optimizeResult.value = result.data;
        optimizeResultVisible.value = true;
      } else {
        ElMessage.warning(result.message || '优化分析完成但无可用结果');
      }
    } catch (e) {
      ElMessage.error('排课优化失败：' + (e.message || '未知错误'));
      if (import.meta.env.DEV) {
        console.error('排课优化失败:', e);
      }
    } finally {
      optimizing.value = false;
      progressMessage.value = '';
    }
  }

  async function applyOptimizeResult() {
    if (!optimizeResult.value || !optimizeResult.value.changes) {
      ElMessage.warning('没有可应用的变更');
      return;
    }

    if (!(await confirmHistoricalEdit())) return;

    optimizing.value = true;

    try {
      const response = await applyOptimizeResultApi({
        semester: selectedSemester.value,
        changes: optimizeResult.value.changes,
      });

      if (response.success) {
        ElMessage.success(`优化已应用：变更${optimizeResult.value.changes.length}个班级`);
        optimizeResultVisible.value = false;
        optimizeResult.value = null;
        await loadData();
      } else {
        ElMessage.error(response.message || '应用优化结果失败');
      }
    } catch (e) {
      ElMessage.error('应用优化结果失败：' + (e.message || '未知错误'));
      if (import.meta.env.DEV) {
        console.error('应用优化结果失败:', e);
      }
    } finally {
      optimizing.value = false;
    }
  }

  function closeOptimizeResult() {
    optimizeResultVisible.value = false;
    optimizeResult.value = null;
  }

  return {
    optimizing,
    optimizeConfirmVisible,
    optimizeResultVisible,
    optimizeResult,
    progressMessage,
    handleOptimize,
    doOptimize,
    applyOptimizeResult,
    closeOptimizeResult,
  };
}
