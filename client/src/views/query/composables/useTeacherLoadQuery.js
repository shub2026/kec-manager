import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { getTeacherLoadQuery } from '@/api/query';
import { exportTeacherLoad, exportTextbookLoad } from '@/api/export';
import { downloadBlob } from '@/utils/download';
import { getWithCache } from '@/utils/cache';
import { useSemesters } from '@/composables/useSemesters';
import { useDebounceFn } from '@/composables/useDebounce';

const CACHE_TTL = 30 * 1000;
const EMPTY = { name: '', personnelType: '', course: '', affiliatedCollege: '', college: '', level: '' };
const EMPTY_TEXTBOOK = { title: '', course: '', level: '', major: '' };

function uniqSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    String(a).localeCompare(String(b), 'zh-Hans-CN')
  );
}

function slicePage(list, page, pageSize) {
  const start = (page - 1) * pageSize;
  return list.slice(start, start + pageSize);
}

/**
 * 任课查询页数据与交互逻辑
 *
 * 两个视图由同一接口一次返回（同一次排课取数），因此切换 TAB 不重新请求，
 * 各自维护独立的筛选与分页状态。
 */
export function useTeacherLoadQuery() {
  const { availableSemesters, fetchCurrentSemester } = useSemesters();

  const activeTab = ref('teacher');
  const semester = ref('');
  // 记录后端/本地推算出的当前学期，供「当前学期」按钮判断是否已在该学期
  const currentSemester = ref('');
  const data = ref(null);
  // 初始即加载态：挂载到 initSemester 完成之间隔着异步取学期，
  // 若初始 false 会让空状态闪现一帧
  const loading = ref(true);
  const error = ref(null);
  const exporting = ref(false);

  const teachers = computed(() => data.value?.teachers || []);
  const textbooks = computed(() => data.value?.textbooks || []);
  const summary = computed(() => data.value?.summary || null);
  const semesterLabel = computed(() => data.value?.semesterLabel || '');
  const isCurrentSemester = computed(
    () => !!semester.value && semester.value === currentSemester.value
  );

  async function loadData() {
    if (!semester.value) {
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const res = await getWithCache(
        () => getTeacherLoadQuery({ semester: semester.value }),
        `teacher-load:${semester.value}`,
        CACHE_TTL
      );
      data.value = res.data || null;
    } catch (e) {
      data.value = null;
      error.value = e?.response?.data?.message || '任课数据加载失败，请稍后重试';
    } finally {
      loading.value = false;
    }
  }

  async function initSemester() {
    currentSemester.value = await fetchCurrentSemester();
    semester.value = currentSemester.value;
    await loadData();
  }

  // ── 教师视图筛选（纯前端过滤，选项从返回数据动态去重生成）──
  const teacherFilters = ref({ ...EMPTY });
  const debouncedTeacherName = ref('');
  const applyTeacherName = useDebounceFn((val) => {
    debouncedTeacherName.value = val;
  }, 200);
  watch(
    () => teacherFilters.value.name,
    (val) => applyTeacherName(val)
  );

  const teacherCourseOptions = computed(() =>
    uniqSorted(teachers.value.flatMap((t) => (t.courseList || []).map((c) => c.name)))
  );
  const teacherCollegeOptions = computed(() =>
    uniqSorted(teachers.value.flatMap((t) => (t.collegeList || []).map((c) => c.name)))
  );
  const teacherLevelOptions = computed(() =>
    uniqSorted(teachers.value.flatMap((t) => (t.trainingLevelList || []).map((l) => l?.name)))
  );
  const affiliatedCollegeOptions = computed(() =>
    uniqSorted(teachers.value.map((t) => t.affiliatedCollege?.name))
  );

  const filteredTeachers = computed(() => {
    const f = teacherFilters.value;
    return teachers.value.filter((t) => {
      if (debouncedTeacherName.value && !t.teacherName.includes(debouncedTeacherName.value))
        return false;
      if (f.personnelType && t.personnelType !== f.personnelType) return false;
      if (f.course && !(t.courseList || []).some((c) => c.name === f.course)) return false;
      if (f.college && !(t.collegeList || []).some((c) => c.name === f.college)) return false;
      if (f.level && !(t.trainingLevelList || []).some((l) => l?.name === f.level)) return false;
      if (f.affiliatedCollege && t.affiliatedCollege?.name !== f.affiliatedCollege) return false;
      return true;
    });
  });

  // ── 教材视图筛选 ──
  const textbookFilters = ref({ ...EMPTY_TEXTBOOK });
  const debouncedTextbookTitle = ref('');
  const applyTextbookTitle = useDebounceFn((val) => {
    debouncedTextbookTitle.value = val;
  }, 200);
  watch(
    () => textbookFilters.value.title,
    (val) => applyTextbookTitle(val)
  );

  const textbookCourseOptions = computed(() =>
    uniqSorted(
      textbooks.value.flatMap((tb) => [
        tb.primaryCourse?.name,
        ...(tb.extraCourses || []).map((c) => c.name),
      ])
    )
  );
  const textbookLevelOptions = computed(() =>
    uniqSorted(textbooks.value.flatMap((tb) => (tb.groups || []).map((g) => g.levelName)))
  );
  const textbookMajorOptions = computed(() =>
    uniqSorted(textbooks.value.flatMap((tb) => (tb.groups || []).map((g) => g.majorName)))
  );

  const filteredTextbooks = computed(() => {
    const f = textbookFilters.value;
    return textbooks.value.filter((tb) => {
      if (debouncedTextbookTitle.value && !tb.title.includes(debouncedTextbookTitle.value))
        return false;
      if (
        f.course &&
        tb.primaryCourse?.name !== f.course &&
        !(tb.extraCourses || []).some((c) => c.name === f.course)
      )
        return false;
      if (f.level && !(tb.groups || []).some((g) => g.levelName === f.level)) return false;
      if (f.major && !(tb.groups || []).some((g) => g.majorName === f.major)) return false;
      return true;
    });
  });

  // ── 前端分页：两个视图各自独立，切 TAB 互不影响 ──
  const teacherPage = ref(1);
  const teacherPageSize = ref(20);
  const pagedTeachers = computed(() =>
    slicePage(filteredTeachers.value, teacherPage.value, teacherPageSize.value)
  );
  watch(filteredTeachers, () => {
    teacherPage.value = 1;
  });

  const textbookPage = ref(1);
  const textbookPageSize = ref(20);
  const pagedTextbooks = computed(() =>
    slicePage(filteredTextbooks.value, textbookPage.value, textbookPageSize.value)
  );
  watch(filteredTextbooks, () => {
    textbookPage.value = 1;
  });

  const activeFilters = computed(() =>
    activeTab.value === 'teacher' ? teacherFilters.value : textbookFilters.value
  );
  const activeFilterCount = computed(
    () => Object.values(activeFilters.value).filter((v) => v !== '' && v != null).length
  );

  function resetFilters() {
    if (activeTab.value === 'teacher') {
      teacherFilters.value = { ...EMPTY };
      debouncedTeacherName.value = '';
    } else {
      textbookFilters.value = { ...EMPTY_TEXTBOOK };
      debouncedTextbookTitle.value = '';
    }
  }

  // 切换学期时两套筛选都清空：新学期下选项集完全不同，保留旧值会得到空结果
  async function handleSemesterChange() {
    teacherFilters.value = { ...EMPTY };
    debouncedTeacherName.value = '';
    textbookFilters.value = { ...EMPTY_TEXTBOOK };
    debouncedTextbookTitle.value = '';
    teacherPage.value = 1;
    textbookPage.value = 1;
    await loadData();
  }

  async function goToCurrentSemester() {
    const target = await fetchCurrentSemester();
    currentSemester.value = target;
    // 赋相同值不触发 el-select 的 change，故显式走一遍刷新
    semester.value = target;
    await handleSemesterChange();
  }

  async function handleExport() {
    if (!semester.value) {
      ElMessage.warning('请先设置当前学期');
      return;
    }
    const isTeacherView = activeTab.value === 'teacher';
    exporting.value = true;
    try {
      const params = { semester: semester.value };
      const response = isTeacherView
        ? await exportTeacherLoad(params)
        : await exportTextbookLoad(params);
      downloadBlob(response, `任课查询_${isTeacherView ? '教师' : '教材'}_${semester.value}.xlsx`);
      ElMessage.success('导出成功');
    } catch (e) {
      if (import.meta.env.DEV) console.error('导出失败:', e);
      ElMessage.error('导出失败');
    } finally {
      exporting.value = false;
    }
  }

  return {
    // 学期
    availableSemesters,
    semester,
    semesterLabel,
    currentSemester,
    isCurrentSemester,
    initSemester,
    handleSemesterChange,
    goToCurrentSemester,
    // 状态
    activeTab,
    data,
    loading,
    error,
    exporting,
    summary,
    // 教师视图
    teacherFilters,
    teacherCourseOptions,
    teacherCollegeOptions,
    teacherLevelOptions,
    affiliatedCollegeOptions,
    filteredTeachers,
    pagedTeachers,
    teacherPage,
    teacherPageSize,
    // 教材视图
    textbookFilters,
    textbookCourseOptions,
    textbookLevelOptions,
    textbookMajorOptions,
    filteredTextbooks,
    pagedTextbooks,
    textbookPage,
    textbookPageSize,
    // 通用
    activeFilterCount,
    resetFilters,
    loadData,
    handleExport,
  };
}
