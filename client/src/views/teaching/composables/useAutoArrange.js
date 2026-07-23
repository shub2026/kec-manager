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
  const previewMode = ref(false);

  // 进度状态
  const progressVisible = ref(false);
  const progressType = ref('single');
  const progressModeLabel = ref('');
  const progressFinished = ref(false);
  const progressCurrentPhase = ref(0);
  const progressMessage = ref('');

  let pendingArrangeMode = null;

  function resetProgress() {
    progressFinished.value = false;
    progressCurrentPhase.value = 0;
    progressMessage.value = '';
  }

  function handleAutoArrange(mode) {
    const modeLabel = mode === 'full' ? '全量模式' : '标准模式';
    const isPreview = previewMode.value;

    arrangeConfirmData.value = {
      title: isPreview ? `预览排课 - ${modeLabel}` : `自动排课 - ${modeLabel}`,
      mode: modeLabel,
      courseName: courseInfo.value?.name || '当前课程',
      message: isPreview
        ? '将以预览模式运行，结果不会写入数据库。预览满意后可在结果弹窗中点击"执行排课"按钮应用结果。'
        : '将自动安排当前课程的所有班级（已有手动安排和已锁定的安排不会被覆盖）。',
      confirmText: isPreview ? '开始预览' : '确定排课',
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

    try {
      const result = await runAutoArrangeWithProgress(
        {
          courseId: selectedCourseId.value,
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
          preview: previewMode.value,
        },
        (progress) => {
          if (progress.phase) {
            progressCurrentPhase.value = progress.phase;
          }
        }
      );
      const data = result.data || {};
      progressFinished.value = true;
      progressMessage.value = result.message;

      arrangeResult.value = data;
      arrangeResultMode.value = arrangeConfirmData.value.mode;

      if (!previewMode.value) {
        await loadData();
      }
    } catch (e) {
      progressVisible.value = false;
      ElMessage.error('自动排课失败');
      if (import.meta.env.DEV) {
        console.error('自动排课失败:', e);
      }
    } finally {
      arranging.value = false;
    }
  }

  async function handleExecutePreview() {
    if (!(await confirmHistoricalEdit())) return;
    const wasPreview = previewMode.value;
    previewMode.value = false;

    const mode = arrangeResultMode.value === '全量模式' ? 'full' : 'standard';

    arranging.value = true;
    resetProgress();
    progressType.value = 'single';
    progressModeLabel.value = arrangeResultMode.value;
    progressVisible.value = true;

    try {
      await runAutoArrangeWithProgress(
        {
          courseId: selectedCourseId.value,
          semester: selectedSemester.value,
          mode,
          hourSettings: hourSettingsRef.value,
          preview: false,
        },
        (progress) => {
          if (progress.phase) {
            progressCurrentPhase.value = progress.phase;
          }
        }
      );

      await loadData();
      progressFinished.value = true;
      progressMessage.value = '排课已执行，可关闭此弹窗';
      arrangeResultVisible.value = false;
      arrangeResult.value = {};
    } catch (e) {
      progressVisible.value = false;
      ElMessage.error('执行排课失败');
      if (import.meta.env.DEV) {
        console.error('执行排课失败:', e);
      }
    } finally {
      arranging.value = false;
      previewMode.value = wasPreview;
    }
  }

  return {
    arranging,
    arrangeConfirmVisible,
    arrangeConfirmData,
    arrangeResultVisible,
    arrangeResult,
    arrangeResultMode,
    previewMode,
    progressVisible,
    progressType,
    progressModeLabel,
    progressFinished,
    progressCurrentPhase,
    progressMessage,
    handleAutoArrange,
    doAutoArrange,
    handleExecutePreview,
    resetProgress,
  };
}
