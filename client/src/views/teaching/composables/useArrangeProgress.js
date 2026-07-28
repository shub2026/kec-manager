import { computed, shallowRef, watch } from 'vue';

/**
 * 统一排课进度弹窗状态
 *
 * 将 useAutoArrange（单课程）与 useBatchArrange（批量）两组进度状态
 * 合并为一组供 ArrangeProgressDialog 使用的代理 computed，
 * 并提供进度弹窗关闭后自动弹出对应结果弹窗的处理函数。
 *
 * 活动来源机制：哪个 composable 的进度弹窗被打开，它就成为当前活动来源（active），
 * 所有代理字段仅从 active 取值，避免两组状态用 || 短路合并时被另一侧残值遮蔽
 * （如单科跑过后批量弹窗错显单科阶段列表/模式标签）；弹窗关闭后 active 保持不变，
 * 关闭动画期间弹窗内容不会闪变。
 *
 * @param {Object} options
 * @param {Object} options.auto - useAutoArrange 返回的进度相关 refs
 * @param {Object} options.batch - useBatchArrange 返回的进度相关 refs
 * @param {Ref} options.arrangeResultVisible - 单课程排课结果弹窗可见性
 * @param {Ref} options.batchResultVisible - 批量排课结果弹窗可见性
 */
export function useArrangeProgress({ auto, batch, arrangeResultVisible, batchResultVisible }) {
  // 当前活动的进度来源：谁的进度弹窗被打开谁生效
  const active = shallowRef(auto);
  watch(
    () => auto.progressVisible.value,
    (visible) => {
      if (visible) active.value = auto;
    }
  );
  watch(
    () => batch.progressVisible.value,
    (visible) => {
      if (visible) active.value = batch;
    }
  );

  // 统一的进度弹窗可见性（双向委托给当前打开的 composable）
  const progressVisible = computed({
    get: () => auto.progressVisible.value || batch.progressVisible.value,
    set: (val) => {
      if (auto.progressVisible.value) auto.progressVisible.value = val;
      if (batch.progressVisible.value) batch.progressVisible.value = val;
    },
  });

  // 代理字段均从 active 取值；两组 composable 字段不完全对称
  // （auto 无 processed/total 等，batch 无 currentPhase），用可选链回退默认值
  const progressType = computed(() => active.value.progressType.value);
  const progressModeLabel = computed(() => active.value.progressModeLabel.value);
  const progressFinished = computed(() => active.value.progressFinished.value);
  const progressCurrentPhase = computed(() => active.value.progressCurrentPhase?.value ?? 0);
  const progressProcessed = computed(() => active.value.progressProcessed?.value ?? 0);
  const progressTotal = computed(() => active.value.progressTotal?.value ?? 0);
  const progressCurrentCourseName = computed(
    () => active.value.progressCurrentCourseName?.value ?? ''
  );
  const progressCumulativeAssigned = computed(
    () => active.value.progressCumulativeAssigned?.value ?? 0
  );
  const progressCumulativeUnassigned = computed(
    () => active.value.progressCumulativeUnassigned?.value ?? 0
  );
  const progressMessage = computed(() => active.value.progressMessage.value);

  // 进度弹窗关闭处理（弹出结果后复位 finished 标志，避免残留状态干扰下一次分支判断）
  function handleProgressClose() {
    auto.progressVisible.value = false;
    batch.progressVisible.value = false;

    const src = active.value;
    if (src.progressFinished.value) {
      (src === auto ? arrangeResultVisible : batchResultVisible).value = true;
      src.progressFinished.value = false;
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
