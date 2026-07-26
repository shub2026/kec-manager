import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  runOptimizeScheduleWithProgress,
  applyOptimizeResult as applyOptimizeResultApi,
} from '../../../api/teachingArrange';

/**
 * 排课优化逻辑 composable
 * 封装排课优化的状态管理和进度控制
 */
export function useOptimize({ selectedSemester, loadData, confirmHistoricalEdit }) {
  const optimizing = ref(false);
  const optimizeConfirmVisible = ref(false);
  const optimizeResultVisible = ref(false);
  const optimizeResult = ref(null);

  // 进度状态
  const progressVisible = ref(false);
  const progressMessage = ref('');
  const progressPercent = ref(0);
  const progressPhase = ref('');
  const progressFinished = ref(false);

  function resetProgress() {
    progressMessage.value = '';
    progressPercent.value = 0;
    progressPhase.value = '';
    progressFinished.value = false;
  }

  function handleOptimize() {
    optimizeConfirmVisible.value = true;
  }

  async function doOptimize() {
    if (!(await confirmHistoricalEdit())) return;

    optimizing.value = true;
    resetProgress();
    progressVisible.value = true;

    try {
      const result = await runOptimizeScheduleWithProgress(
        {
          semester: selectedSemester.value,
          mode: 'standard',
        },
        (progress) => {
          progressPhase.value = progress.phase || '';
          progressMessage.value = progress.message || '';
          progressPercent.value = progress.percent || 0;
        }
      );

      progressFinished.value = true;

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
      progressVisible.value = false;
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
    progressVisible,
    progressMessage,
    progressPercent,
    progressPhase,
    progressFinished,
    handleOptimize,
    doOptimize,
    applyOptimizeResult,
    closeOptimizeResult,
  };
}
