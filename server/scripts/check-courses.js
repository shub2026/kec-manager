import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

(async () => {
  const courses = await prisma.courses.findMany({ 
    select: { id: true, name: true, code: true },
    orderBy: { id: 'asc' }
  });
  
  console.log('课程列表:');
  courses.forEach(c => {
    console.log(`  ID=${c.id}, ${c.name} (${c.code})`);
  });
  
  await prisma.$disconnect();
})();
