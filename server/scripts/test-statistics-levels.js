import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const semester = '2025-2026-2';
  
  // 模拟 getStatistics 函数的逻辑
  const stats = await prisma.teaching_assignments.groupBy({
    by: ['teacher_id'],
    where: { semester },
    _sum: { weekly_hours: true },
    _count: { id: true },
  });

  console.log(`找到 ${stats.length} 位教师\n`);

  // 获取前3位教师的详细信息
  const teacherIds = stats.slice(0, 3).map(s => s.teacher_id);
  const teachers = await prisma.teachers.findMany({
    where: { id: { in: teacherIds } },
    include: {
      affiliated_college: { select: { id: true, name: true } },
      courses: { include: { course: { select: { id: true, name: true } } } },
      scheduling_colleges: { include: { college: { select: { id: true, name: true } } } },
      scheduling_levels: { include: { training_level: { select: { id: true, name: true } } } },
    },
  });

  for (const teacher of teachers) {
    console.log(`教师: ${teacher.name} (ID: ${teacher.id})`);
    console.log(`  scheduling_levels: ${JSON.stringify(teacher.scheduling_levels.map(sl => sl.training_level))}`);
    
    // 查询该教师的实际授课安排
    const assignments = await prisma.teaching_assignments.findMany({
      where: { semester, teacher_id: teacher.id },
      include: {
        class: { select: { id: true, name: true, training_level_id: true } },
      },
    });
    
    console.log(`  授课安排数: ${assignments.length}`);
    
    // 提取实际授课层次
    const levelIdSet = new Set();
    for (const a of assignments) {
      if (a.class.training_level_id) {
        levelIdSet.add(a.class.training_level_id);
      }
    }
    
    console.log(`  实际授课层次IDs: ${[...levelIdSet].join(', ')}`);
    
    if (levelIdSet.size > 0) {
      const levels = await prisma.training_levels.findMany({
        where: { id: { in: [...levelIdSet] } },
        select: { id: true, name: true },
      });
      console.log(`  实际授课层次: ${JSON.stringify(levels)}`);
    }
    
    console.log('');
  }
  
  await prisma.$disconnect();
})();
