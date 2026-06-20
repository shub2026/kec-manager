import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const teachers = await prisma.teachers.findMany({
    select: { 
      id: true, 
      name: true,
      scheduling_colleges: { select: { college_id: true } },
      scheduling_levels: { select: { training_level_id: true } }
    },
    take: 5
  });
  
  console.log('教师意向示例:');
  teachers.forEach(t => {
    const colleges = t.scheduling_colleges.map(sc => sc.college_id);
    const levels = t.scheduling_levels.map(sl => sl.training_level_id);
    console.log(`  ${t.name}: colleges=${JSON.stringify(colleges)}, levels=${JSON.stringify(levels)}`);
  });
  
  // 统计有多少教师有意向
  const allTeachers = await prisma.teachers.findMany({
    include: {
      scheduling_colleges: { select: { college_id: true } },
      scheduling_levels: { select: { training_level_id: true } }
    }
  });
  
  const withCollege = allTeachers.filter(t => t.scheduling_colleges.length > 0).length;
  const withLevel = allTeachers.filter(t => t.scheduling_levels.length > 0).length;
  const withoutAny = allTeachers.filter(t => t.scheduling_colleges.length === 0 && t.scheduling_levels.length === 0).length;
  
  console.log(`\n教师意向统计:`);
  console.log(`  总教师数: ${allTeachers.length}`);
  console.log(`  有学院意向: ${withCollege}`);
  console.log(`  有层次意向: ${withLevel}`);
  console.log(`  无任何意向: ${withoutAny}`);
  
  await prisma.$disconnect();
})();
