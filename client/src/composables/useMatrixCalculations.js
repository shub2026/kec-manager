import { computed } from 'vue';

/**
 * 课程矩阵共享计算逻辑 composable
 * 提取自 CourseMatrix.vue 和 CourseMatrixTable.vue 的重复代码
 */
export function useMatrixCalculations(rawCourses, semesterWeeksRef = null) {
  // 按类型分组（公共基础课 / 专业课）
  const groups = computed(() => {
    const map = { public: [], professional: [] };
    rawCourses.value.forEach((c) => {
      const type = c.courses?.type || 'public';
      map[type].push({
        id: c.id,
        courseName: c.courses?.name || '未知课程',
        courseCode: c.courses?.code || '',
        startSemester: c.startSemester,
        endSemester: c.endSemester,
        weeklyHours: c.weeklyHours,
        weeksPerSemester: c.weeksPerSemester,
        semesters: c.planCourseSemesters || [],
        sortOrder: c.sortOrder ?? 0,
      });
    });
    map.public.sort((a, b) => a.sortOrder - b.sortOrder);
    map.professional.sort((a, b) => a.sortOrder - b.sortOrder);
    return [
      { type: 'public', label: '公共基础课', courses: map.public },
      { type: 'professional', label: '专业课', courses: map.professional },
    ];
  });

  // 判断学期是否在课程范围内
  function isInRange(course, semester) {
    return semester >= course.startSemester && semester <= course.endSemester;
  }

  // 获取某学期周课时
  function getHours(course, semester) {
    const sem = course.semesters.find((s) => s.semester === semester);
    return sem ? sem.weeklyHours : null;
  }

  // 计算总课时（支持 semesterWeeks ref 回退）
  function calcTotalHours(course) {
    let total = 0;
    for (let s = course.startSemester; s <= course.endSemester; s++) {
      const sem = course.semesters.find((x) => x.semester === s);
      if (sem) {
        const hours = sem.weeklyHours || 0;
        const weeks =
          sem.weeksCount || (semesterWeeksRef ? semesterWeeksRef.value[s - 1] : null) || 18;
        total += hours * weeks;
      } else {
        const hours = course.weeklyHours || 0;
        const weeks =
          course.weeksPerSemester ||
          (semesterWeeksRef ? semesterWeeksRef.value[s - 1] : null) ||
          18;
        total += hours * weeks;
      }
    }
    return Math.round(total);
  }

  // 分组小计
  function calcGroupTotal(group) {
    return group.courses.reduce((sum, c) => sum + calcTotalHours(c), 0);
  }

  // 判断是否是分组中的第一项
  function isFirstInGroup(course, group) {
    return group.courses[0]?.id === course.id;
  }

  // 判断是否是分组中的最后一项
  function isLastInGroup(course, group) {
    return group.courses[group.courses.length - 1]?.id === course.id;
  }

  return {
    groups,
    isInRange,
    getHours,
    calcTotalHours,
    calcGroupTotal,
    isFirstInGroup,
    isLastInGroup,
  };
}
