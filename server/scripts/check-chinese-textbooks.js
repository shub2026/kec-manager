import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 查询语文课程（ID=6）的排课和班级教材
  const assignments = await prisma.teaching_assignments.findMany({
    where: { 
      course_id: 6,
      semester: '2025-2026-2'
    },
    include: {
      teacher: { select: { name: true } },
      class: { select: { id: true, custom_plan_id: true, major_id: true, training_level_id: true } }
    }
  });
  
  console.log(`语文课程排课结果 (${assignments.length}条记录):\n`);
  
  // 获取培养方案中的教材信息
  const planCourses = await prisma.plan_courses.findMany({
    where: { course_id: 6 },
    include: {
      training_plans: { select: { id: true, major_id: true, training_level_id: true } },
      plan_course_semesters: {
        where: { semester: 2025202602 },
        include: {
          plan_textbooks: { select: { textbook_id: true } }
        }
      }
    }
  });
  
  console.log('培养方案教材:');
  planCourses.forEach(pc => {
    const textbooks = pc.plan_course_semesters.flatMap(sem => sem.plan_textbooks.map(pt => pt.textbook_id));
    console.log(`  Plan ${pc.training_plans.id}: [${textbooks.join(', ')}]`);
  });
  
  // 构建班级到教材的映射
  const classTextbookMap = new Map();
  for (const a of assignments) {
    const cls = a.class;
    const textbooks = new Set();
    
    for (const pc of planCourses) {
      const plan = pc.training_plans;
      
      // 三级互斥匹配
      let match = false;
      if (cls.custom_plan_id && plan.id === cls.custom_plan_id) {
        match = true;
      } else if (!cls.custom_plan_id && cls.major_id && plan.major_id && cls.major_id === plan.major_id) {
        match = true;
      } else if (!cls.custom_plan_id && !cls.major_id && cls.training_level_id && plan.training_level_id && cls.training_level_id === plan.training_level_id) {
        match = true;
      }
      
      if (match) {
        for (const sem of pc.plan_course_semesters) {
          for (const pt of sem.plan_textbooks) {
            textbooks.add(pt.textbook_id);
          }
        }
      }
    }
    
    classTextbookMap.set(cls.id, [...textbooks]);
  }
  
  // 按教师分组统计教材
  const teacherMap = new Map();
  for (const a of assignments) {
    if (!teacherMap.has(a.teacher_id)) {
      teacherMap.set(a.teacher_id, {
        name: a.teacher.name,
        classIds: [],
        textbookSet: new Set()
      });
    }
    
    const info = teacherMap.get(a.teacher_id);
    info.classIds.push(a.class_id);
    
    const tbs = classTextbookMap.get(a.class_id);
    if (tbs) {
      for (const tb of tbs) {
        info.textbookSet.add(tb);
      }
    }
  }
  
  // 输出每个教师的教材情况
  const sortedTeachers = Array.from(teacherMap.entries()).sort((a, b) => a[0] - b[0]);
  
  console.log('\n教师教材分配情况:');
  let count1 = 0, count2 = 0, count3plus = 0;
  
  sortedTeachers.forEach(([tid, info]) => {
    const textbooks = [...info.textbookSet].sort();
    const tbCount = textbooks.length;
    
    if (tbCount === 1) count1++;
    else if (tbCount === 2) count2++;
    else count3plus++;
    
    console.log(`  ${info.name}: ${tbCount}本教材 [${textbooks.join(', ')}] ${info.classIds.length}个班`);
  });
  
  console.log(`\n📊 统计:`);
  console.log(`  1本教材: ${count1}位教师`);
  console.log(`  2本教材: ${count2}位教师`);
  console.log(`  3本及以上: ${count3plus}位教师`);
  console.log(`  总计: ${sortedTeachers.length}位教师`);
  
  await prisma.$disconnect();
})();
