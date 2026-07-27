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
  previewMode,
  loadData,
  confirmHistoricalEdit,
}) {
  const batchArranging = ref(false);
  const batchConfirmVisible = ref(false);
  const batchConfirmData = ref({ title: '', mode: '', message: '', confirmText: '确定批量排课' });
  const batchResultVisible = ref(false);
  const batchResult = ref({});
  const batchArrangeResultMode = ref('');

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
    const isPreview = previewMode.value;
    batchConfirmData.value = {
      title: isPreview ? `预览批量排课 - ${modeLabel}` : `批量排课 - ${modeLabel}`,
      mode: modeLabel,
      message: isPreview
        ? '将以预览模式运行所有课程的批量排课，结果不会写入数据库。预览满意后可在结果弹窗中点击"执行排课"按钮应用结果。'
        : '这会覆盖所有课程的自动安排（手动安排和已锁定的安排不受影响）。确定继续？',
      confirmText: isPreview ? '开始预览' : '确定批量排课',
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
    batchArrangeResultMode.value = batchConfirmData.value.mode;
    progressVisible.value = true;

    try {
      const result = await runBatchAutoArrangeWithProgress(
        {
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
          preview: previewMode.value,
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

      if (!previewMode.value) {
        await loadData();
      }
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

  async function handleBatchExecutePreview() {
    if (!(await confirmHistoricalEdit())) return;
    const wasPreview = previewMode.value;
    previewMode.value = false;

    const mode = batchArrangeResultMode.value === '全量模式' ? 'full' : 'standard';

    batchArranging.value = true;
    resetProgress();
    progressType.value = 'batch';
    progressModeLabel.value = batchArrangeResultMode.value;
    progressVisible.value = true;

    try {
      await runBatchAutoArrangeWithProgress(
        {
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
          preview: false,
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

      await loadData();
      progressFinished.value = true;
      progressMessage.value = '批量排课已执行，可关闭此弹窗';
      batchResultVisible.value = false;
      batchResult.value = {};
    } catch (e) {
      progressVisible.value = false;
      ElMessage.error('执行批量排课失败');
      if (import.meta.env.DEV) {
        console.error('执行批量排课失败:', e);
      }
    } finally {
      batchArranging.value = false;
      previewMode.value = wasPreview;
    }
  }

  return {
    batchArranging,
    batchConfirmVisible,
    batchConfirmData,
    batchResultVisible,
    batchResult,
    batchArrangeResultMode,
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
    handleBatchExecutePreview,
    resetProgress,
  };
}
