import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { runBatchAutoArrangeWithProgress } from '../../../api/teachingArrange';

/**
 * 批量排课逻辑 composable
 * 从 TeachingArrange.vue 抽取，封装批量自动排课的状态管理和进度控制
 */
export function useBatchArrange({
  selectedSemester,
  hourSettingsRef,
  loadData,
  confirmHistoricalEdit,
}) {
  const batchArranging = ref(false);
  const batchConfirmVisible = ref(false);
  const batchConfirmData = ref({ title: '', mode: '', message: '', confirmText: '确定批量排课' });
  const batchResultVisible = ref(false);
  const batchResult = ref({});

  // 进度状态
  const progressVisible = ref(false);
  const progressType = ref('batch');
  const progressModeLabel = ref('');
  const progressFinished = ref(false);
  const progressProcessed = ref(0);
  const progressTotal = ref(0);
  const progressCurrentCourseName = ref('');
  const progressCumulativeAssigned = ref(0);
  const progressCumulativeUnassigned = ref(0);
  const progressMessage = ref('');

  let pendingBatchMode = null;

  function resetProgress() {
    progressFinished.value = false;
    progressProcessed.value = 0;
    progressTotal.value = 0;
    progressCurrentCourseName.value = '';
    progressCumulativeAssigned.value = 0;
    progressCumulativeUnassigned.value = 0;
    progressMessage.value = '';
  }

  function handleBatchAutoArrange(mode) {
    const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
    batchConfirmData.value = {
      title: `批量排课 - ${modeLabel}`,
      mode: modeLabel,
      message: '这会覆盖所有课程的自动安排（手动安排和已锁定的安排不受影响）。确定继续？',
      confirmText: '确定批量排课',
    };
    pendingBatchMode = mode;
    batchConfirmVisible.value = true;
  }

  async function doBatchAutoArrange() {
    const mode = pendingBatchMode;
    batchConfirmVisible.value = false;

    if (!(await confirmHistoricalEdit())) return;

    batchArranging.value = true;
    resetProgress();
    progressType.value = 'batch';
    progressModeLabel.value = batchConfirmData.value.mode;
    progressVisible.value = true;

    try {
      const result = await runBatchAutoArrangeWithProgress(
        {
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
        },
        (progress) => {
          if (progress.processed != null) {
            progressProcessed.value = progress.processed;
            progressTotal.value = progress.total;
            progressCurrentCourseName.value = progress.currentCourseName || '';
            progressCumulativeAssigned.value = progress.cumulativeAssigned || 0;
            progressCumulativeUnassigned.value = progress.cumulativeUnassigned || 0;
          }
        }
      );
      const data = result.data || {};
      progressFinished.value = true;
      progressMessage.value = result.message;

      batchResult.value = data;
      await loadData();
    } catch (e) {
      progressVisible.value = false;
      ElMessage.error('批量排课失败');
      if (import.meta.env.DEV) {
        console.error('批量排课失败:', e);
      }
    } finally {
      batchArranging.value = false;
    }
  }

  return {
    batchArranging,
    batchConfirmVisible,
    batchConfirmData,
    batchResultVisible,
    batchResult,
    progressVisible,
    progressType,
    progressModeLabel,
    progressFinished,
    progressProcessed,
    progressTotal,
    progressCurrentCourseName,
    progressCumulativeAssigned,
    progressCumulativeUnassigned,
    progressMessage,
    handleBatchAutoArrange,
    doBatchAutoArrange,
    resetProgress,
  };
}
