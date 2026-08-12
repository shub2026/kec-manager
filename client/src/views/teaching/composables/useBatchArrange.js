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
  // 当前批量排课请求的中止控制器（进度弹窗"取消排课"用）
  let arrangeAbortController = null;

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
    arrangeAbortController = new AbortController();

    try {
      // hourSettings 仅作兜底：后端批量排课按课程解析 DB 中保存的课时配置
      // （课程级 > 此传参 > 全局 > 默认），避免当前卡片状态跨课程误用
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
        },
        { signal: arrangeAbortController.signal }
      );
      const data = result.data || {};
      progressFinished.value = true;
      progressMessage.value = result.message;

      batchResult.value = data;

      await loadData();
    } catch (e) {
      progressVisible.value = false;
      // 用户主动取消：前端已断流，后端任务可能继续执行，仅提示不报错
      if (e.cancelled || arrangeAbortController?.signal.aborted) {
        ElMessage.info('已取消排课，服务端已启动的任务可能继续执行');
      } else {
        ElMessage.error('批量排课失败');
        if (import.meta.env.DEV) {
          console.error('批量排课失败:', e);
        }
      }
    } finally {
      batchArranging.value = false;
      arrangeAbortController = null;
    }
  }

  // 中止进行中的批量排课请求（进度弹窗二次确认后调用）
  function cancelArrange() {
    arrangeAbortController?.abort();
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
    cancelArrange,
    resetProgress,
  };
}
