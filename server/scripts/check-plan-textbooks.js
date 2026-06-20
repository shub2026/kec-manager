import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  // 查询语文课程（ID=6）的培养方案
  const planCourses = await prisma.plan_courses.findMany({
    where: { course_id: 6 },
    include: {
      training_plans: { select: { id: true, name: true, major_id: true, training_level_id: true } },
      plan_course_semesters: {
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
  
  console.log(`语文课程的培养方案 (${planCourses.length}个):\n`);
  
  planCourses.forEach(pc => {
    console.log(`Plan ${pc.training_plans.id} (${pc.training_plans.name}):`);
    console.log(`  Major: ${pc.training_plans.major_id}, Level: ${pc.training_plans.training_level_id}`);
    
    pc.plan_course_semesters.forEach(sem => {
      console.log(`  Semester ${sem.semester}:`);
      sem.plan_textbooks.forEach(pt => {
        console.log(`    - Textbook ${pt.textbooks.id}: ${pt.textbooks.title}`);
      });
    });
    console.log('');
  });
  
  // 查询班级的培养方案
  const assignments = await prisma.teaching_assignments.findMany({
    where: { 
      course_id: 6,
      semester: '2025-2026-2'
    },
    select: { class_id: true },
    distinct: ['class_id']
  });
  
  const classIds = assignments.map(a => a.class_id);
  
  const classes = await prisma.classes.findMany({
    where: { id: { in: classIds } },
    select: { 
      id: true, 
      name: true,
      custom_plan_id: true,
      major_id: true,
      training_level_id: true
    }
  });
  
  console.log(`\n相关班级 (${classes.length}个):`);
  classes.slice(0, 5).forEach(cls => {
    console.log(`  ${cls.name}: custom_plan=${cls.custom_plan_id}, major=${cls.major_id}, level=${cls.training_level_id}`);
  });
  
  await prisma.$disconnect();
})();
