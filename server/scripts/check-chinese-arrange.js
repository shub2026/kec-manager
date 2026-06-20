import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 查询语文课程（ID=6）的最新排课
  const assignments = await prisma.teaching_assignments.findMany({
    where: { 
      course_id: 6,
      semester: '2025-2026-2'
    },
    include: {
      teacher: { select: { name: true } },
      class: { select: { id: true, name: true } }
    },
    orderBy: { teacher_id: 'asc' }
  });
  
  console.log(`语文课程排课结果 (${assignments.length}条记录):\n`);
  
  // 按教师分组
  const teacherMap = new Map();
  for (const a of assignments) {
    if (!teacherMap.has(a.teacher_id)) {
      teacherMap.set(a.teacher_id, {
        name: a.teacher.name,
        classIds: [],
        classNames: []
      });
    }
    
    const info = teacherMap.get(a.teacher_id);
    info.classIds.push(a.class_id);
    info.classNames.push(a.class.name);
  }
  
  // 输出每个教师的分配情况
  const sortedTeachers = Array.from(teacherMap.entries()).sort((a, b) => a[0] - b[0]);
  
  console.log('教师分配情况:');
  sortedTeachers.forEach(([tid, info]) => {
    console.log(`  ${info.name}: ${info.classIds.length}个班级 [${info.classNames.join(', ')}]`);
  });
  
  console.log(`\n总计: ${sortedTeachers.length}位教师，${assignments.length}条记录`);
  
  await prisma.$disconnect();
})();
