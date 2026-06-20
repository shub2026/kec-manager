import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 查询Plan 9的所有学期
  const planCourses = await prisma.plan_courses.findMany({
    where: { course_id: 6 },
    include: {
      training_plans: { select: { id: true, name: true } },
      plan_course_semesters: {
        select: { semester: true }
      }
    }
  });
  
  console.log('Plan Courses Semesters:');
  planCourses.forEach(pc => {
    console.log(`  Plan ${pc.training_plans.id} (${pc.training_plans.name}):`);
    pc.plan_course_semesters.forEach(sem => {
      console.log(`    Semester: ${sem.semester} (type: ${typeof sem.semester})`);
    });
  });
  
  await prisma.$disconnect();
})();
