import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { runAutoArrangeWithProgress } from '../../../api/teachingArrange';

/**
 * 自动排课逻辑 composable
 * 从 TeachingArrange.vue 抽取，封装单课程自动排课的状态管理和进度控制
 */
export function useAutoArrange({
  selectedCourseId,
  selectedSemester,
  courseInfo,
  hourSettingsRef,
  loadData,
  confirmHistoricalEdit,
}) {
  const arranging = ref(false);
  const arrangeConfirmVisible = ref(false);
  const arrangeConfirmData = ref({
    title: '',
    mode: '',
    message: '',
    confirmText: '',
    courseName: '',
  });
  const arrangeResultVisible = ref(false);
  const arrangeResult = ref({});
  const arrangeResultMode = ref('');

  // 进度状态
  const progressVisible = ref(false);
  const progressType = ref('single');
  const progressModeLabel = ref('');
  const progressFinished = ref(false);
  const progressCurrentPhase = ref(0);
  const progressMessage = ref('');

  let pendingArrangeMode = null;
  // 当前排课请求的中止控制器（进度弹窗"取消排课"用）
  let arrangeAbortController = null;

  function resetProgress() {
    progressFinished.value = false;
    progressCurrentPhase.value = 0;
    progressMessage.value = '';
  }

  function handleAutoArrange(mode) {
    const modeLabel = mode === 'full' ? '全量模式' : '标准模式';

    arrangeConfirmData.value = {
      title: `自动排课 - ${modeLabel}`,
      mode: modeLabel,
      courseName: courseInfo.value?.name || '当前课程',
      message: '将自动安排当前课程的所有班级（已有手动安排和已锁定的安排不会被覆盖）。',
      confirmText: '确定排课',
    };
    pendingArrangeMode = mode;
    arrangeConfirmVisible.value = true;
  }

  async function doAutoArrange() {
    const mode = pendingArrangeMode;
    arrangeConfirmVisible.value = false;

    if (!(await confirmHistoricalEdit())) return;

    arranging.value = true;
    resetProgress();
    progressType.value = 'single';
    progressModeLabel.value = arrangeConfirmData.value.mode;
    progressVisible.value = true;
    arrangeAbortController = new AbortController();

    try {
      const result = await runAutoArrangeWithProgress(
        {
          courseId: selectedCourseId.value,
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
        },
        (progress) => {
          if (progress.phase) {
            progressCurrentPhase.value = progress.phase;
          }
        },
        { signal: arrangeAbortController.signal }
      );
      const data = result.data || {};
      progressFinished.value = true;
      progressMessage.value = result.message;

      arrangeResult.value = data;
      arrangeResultMode.value = arrangeConfirmData.value.mode;

      await loadData();
    } catch (e) {
      progressVisible.value = false;
      // 用户主动取消：前端已断流，后端任务可能继续执行，仅提示不报错
      if (e.cancelled || arrangeAbortController?.signal.aborted) {
        ElMessage.info('已取消排课，服务端已启动的任务可能继续执行');
      } else {
        ElMessage.error('自动排课失败');
        if (import.meta.env.DEV) {
          console.error('自动排课失败:', e);
        }
      }
    } finally {
      arranging.value = false;
      arrangeAbortController = null;
    }
  }

  // 中止进行中的排课请求（进度弹窗二次确认后调用）
  function cancelArrange() {
    arrangeAbortController?.abort();
  }

  return {
    arranging,
    arrangeConfirmVisible,
    arrangeConfirmData,
    arrangeResultVisible,
    arrangeResult,
    arrangeResultMode,
    progressVisible,
    progressType,
    progressModeLabel,
    progressFinished,
    progressCurrentPhase,
    progressMessage,
    handleAutoArrange,
    doAutoArrange,
    cancelArrange,
    resetProgress,
  };
}
