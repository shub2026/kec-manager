import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 测试学期格式转换
  const semesterStr = '2025-2026-2';
  const [year1, year2, sem] = semesterStr.split('-');
  const semesterNum = parseInt(`${year1}${year2}${sem.padStart(2, '0')}`);
  
  console.log(`原始学期: ${semesterStr}`);
  console.log(`转换后: ${semesterNum}`);
  console.log(`期望值: 2025202602`);
  console.log(`匹配: ${semesterNum === 2025202602}\n`);
  
  // 查询Plan 9的Semester 2是否有教材
  const planCourses = await prisma.plan_courses.findMany({
    where: { course_id: 6 },
    include: {
      training_plans: { select: { id: true, name: true } },
      plan_course_semesters: {
        where: { semester: semesterNum },
        include: {
          plan_textbooks: { 
            include: {
              textbooks: { select: { id: true, title: true } }
            }
          }
        }
      }
    }
  });
  
  console.log(`Plan Courses for Semester ${semesterNum}:`);
  planCourses.forEach(pc => {
    console.log(`  Plan ${pc.training_plans.id} (${pc.training_plans.name}):`);
    pc.plan_course_semesters.forEach(sem => {
      console.log(`    Semester ${sem.semester}:`);
      sem.plan_textbooks.forEach(pt => {
        console.log(`      - Textbook ${pt.textbooks.id}: ${pt.textbooks.title}`);
      });
    });
  });
  
  await prisma.$disconnect();
})();
