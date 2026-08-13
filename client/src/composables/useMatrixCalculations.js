import { computed } from 'vue';

/**
 * 课程矩阵共享计算逻辑 composable
 * 提取自 CourseMatrix.vue 和 CourseMatrixTable.vue 的重复代码
 *
 * FE-P2 优化：将原先在模板中以方法形式逐单元格调用的 getHours / calcTotalHours /
 * calcSemesterSubtotal / calcGrandTotalSemester 改为在 computed 中一次性预计算：
 * - groups 计算时为每门课程构建 semesterMap（O(1) 学期查找）并预计算 totalHours
 * - subtotals / grandTotals / totalAllHours 均为 computed，避免每次渲染重复遍历
 */
export function useMatrixCalculations(rawCourses, semesterWeeksRef = null) {
  // 按类型分组（公共课 / 专业课），同时预计算每门课程的学期查找表与总课时
  const groups = computed(() => {
    const map = { public: [], professional: [] };
    rawCourses.value.forEach((c) => {
      const type = c.courses?.type || 'public';
      const semesterList = c.planCourseSemesters || [];

      // 构建学期 → 记录 的 Map，供 O(1) 查找（替代原先每次 .find() 线性扫描）
      const semesterMap = new Map();
      semesterList.forEach((s) => {
        semesterMap.set(s.semester, s);
      });

      // 预计算总课时（原先 calcTotalHours 在模板中每行/每小计重复调用）
      let totalHours = 0;
      for (let s = c.startSemester; s <= c.endSemester; s++) {
        const sem = semesterMap.get(s);
        if (sem) {
          const hours = sem.weeklyHours || 0;
          const weeks =
            sem.weeksCount || (semesterWeeksRef ? semesterWeeksRef.value[s - 1] : null) || 18;
          totalHours += hours * weeks;
        } else {
          const hours = c.weeklyHours || 0;
          const weeks =
            c.weeksPerSemester || (semesterWeeksRef ? semesterWeeksRef.value[s - 1] : null) || 18;
          totalHours += hours * weeks;
        }
      }

      map[type].push({
        id: c.id,
        courseName: c.courses?.name || '未知课程',
        courseCode: c.courses?.code || '',
        startSemester: c.startSemester,
        endSemester: c.endSemester,
        weeklyHours: c.weeklyHours,
        weeksPerSemester: c.weeksPerSemester,
        semesters: semesterList,
        semesterMap,
        totalHours: Math.round(totalHours),
        sortOrder: c.sortOrder ?? 0,
        // 启用状态需透传给矩阵行（停用行灰底/开关状态）；旧数据缺字段视为启用
        isActive: c.isActive !== false,
      });
    });
    map.public.sort((a, b) => a.sortOrder - b.sortOrder);
    map.professional.sort((a, b) => a.sortOrder - b.sortOrder);
    return [
      { type: 'public', label: '公共课', courses: map.public },
      { type: 'professional', label: '专业课', courses: map.professional },
    ];
  });

  // 最大学期数（至少 8），统一从此处取，消除 CourseMatrixTable / useCourseMatrixData 中的重复定义
  const maxSemester = computed(() => {
    if (!rawCourses.value.length) return 8;
    const max = Math.max(...rawCourses.value.map((c) => c.endSemester), 0);
    return Math.max(max, 8);
  });

  // 判断学期是否在课程范围内
  function isInRange(course, semester) {
    return semester >= course.startSemester && semester <= course.endSemester;
  }

  // 获取某学期周课时（O(1) Map 查找）
  function getHours(course, semester) {
    const sem = course.semesterMap?.get(semester);
    return sem ? sem.weeklyHours : null;
  }

  // 计算总课时（直接返回预计算值）
  function calcTotalHours(course) {
    return course.totalHours ?? 0;
  }

  // 分组小计（使用预计算的 totalHours）
  function calcGroupTotal(group) {
    return group.courses.reduce((sum, c) => sum + (c.totalHours ?? 0), 0);
  }

  // 判断是否是分组中的第一项
  function isFirstInGroup(course, group) {
    return group.courses[0]?.id === course.id;
  }

  // 判断是否是分组中的最后一项
  function isLastInGroup(course, group) {
    return group.courses[group.courses.length - 1]?.id === course.id;
  }

  // 预计算各分组每学期的小时小计：{ [groupType]: number[] }（下标 = semester - 1）
  const subtotals = computed(() => {
    const result = {};
    const max = maxSemester.value;
    for (const group of groups.value) {
      const arr = new Array(max).fill(0);
      group.courses.forEach((c) => {
        for (let s = c.startSemester; s <= c.endSemester; s++) {
          const sem = c.semesterMap?.get(s);
          if (sem && sem.weeklyHours != null) {
            arr[s - 1] += sem.weeklyHours;
          }
        }
      });
      result[group.type] = arr;
    }
    return result;
  });

  // 预计算总计行每学期小时数：number[]（下标 = semester - 1）
  const grandTotals = computed(() => {
    const max = maxSemester.value;
    const arr = new Array(max).fill(0);
    for (const group of groups.value) {
      const sub = subtotals.value[group.type];
      if (sub) {
        for (let i = 0; i < max; i++) arr[i] += sub[i] || 0;
      }
    }
    return arr;
  });

  // 所有课程总课时合计（使用预计算的 totalHours，消除 useCourseMatrixData / PlanQuery 中的重复实现）
  const totalAllHours = computed(() =>
    groups.value.reduce((sum, g) => sum + g.courses.reduce((s, c) => s + (c.totalHours ?? 0), 0), 0)
  );

  return {
    groups,
    maxSemester,
    isInRange,
    getHours,
    calcTotalHours,
    calcGroupTotal,
    isFirstInGroup,
    isLastInGroup,
    subtotals,
    grandTotals,
    totalAllHours,
  };
}
