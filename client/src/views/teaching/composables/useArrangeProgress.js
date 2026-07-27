import { computed } from 'vue';

/**
 * 统一排课进度弹窗状态
 *
 * 将 useAutoArrange（单课程）与 useBatchArrange（批量）两组进度状态
 * 合并为一组供 ArrangeProgressDialog 使用的代理 computed，
 * 并提供进度弹窗关闭后自动弹出对应结果弹窗的处理函数。
 *
 * @param {Object} options
 * @param {Object} options.auto - useAutoArrange 返回的进度相关 refs
 * @param {Object} options.batch - useBatchArrange 返回的进度相关 refs
 * @param {Ref} options.arrangeResultVisible - 单课程排课结果弹窗可见性
 * @param {Ref} options.batchResultVisible - 批量排课结果弹窗可见性
 */
export function useArrangeProgress({ auto, batch, arrangeResultVisible, batchResultVisible }) {
  // 统一的进度弹窗状态（委托给当前活动的 composable）
  const progressVisible = computed({
    get: () => auto.progressVisible.value || batch.progressVisible.value,
    set: (val) => {
      if (auto.progressVisible.value) auto.progressVisible.value = val;
      if (batch.progressVisible.value) batch.progressVisible.value = val;
    },
  });

  const progressType = computed(() => auto.progressType.value || batch.progressType.value);
  const progressModeLabel = computed(
    () => auto.progressModeLabel.value || batch.progressModeLabel.value
  );
  const progressFinished = computed(
    () => auto.progressFinished.value || batch.progressFinished.value
  );
  const progressCurrentPhase = computed(() => auto.progressCurrentPhase.value);
  const progressProcessed = computed(() => batch.progressProcessed.value);
  const progressTotal = computed(() => batch.progressTotal.value);
  const progressCurrentCourseName = computed(() => batch.progressCurrentCourseName.value);
  const progressCumulativeAssigned = computed(() => batch.progressCumulativeAssigned.value);
  const progressCumulativeUnassigned = computed(() => batch.progressCumulativeUnassigned.value);
  const progressMessage = computed(() => auto.progressMessage.value || batch.progressMessage.value);

  // 进度弹窗关闭处理（弹出结果后复位 finished 标志，避免残留状态干扰下一次分支判断）
  function handleProgressClose() {
    auto.progressVisible.value = false;
    batch.progressVisible.value = false;

    if (auto.progressType.value === 'single' && auto.progressFinished.value) {
      arrangeResultVisible.value = true;
      auto.progressFinished.value = false;
    } else if (batch.progressType.value === 'batch' && batch.progressFinished.value) {
      batchResultVisible.value = true;
      batch.progressFinished.value = false;
    }
  }

  return {
    progressVisible,
    progressType,
    progressModeLabel,
    progressFinished,
    progressCurrentPhase,
    progressProcessed,
    progressTotal,
    progressCurrentCourseName,
    progressCumulativeAssigned,
    progressCumulativeUnassigned,
    progressMessage,
    handleProgressClose,
  };
}
