const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnose() {
  try {
    const courseId = 6;
    const semester = '2025-2026-2';

    console.log('=== 1. 教师固有教材数据 ===');
    const teacherIds = await prisma.teachingArrangement
      .findMany({
        where: { courseId, semester },
        select: { teacherId: true },
      })
      .then((arr) => [...new Set(arr.map((a) => a.teacherId))]);

    const teachers = await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      include: { textbook: true },
    });

    console.log(`共 ${teachers.length} 位教师：`);
    teachers.forEach((t) => {
      const tbIds = t.textbook?.map((tb) => tb.id) || [];
      console.log(
        `  ${t.name} (id=${t.id}): textbookIds=${JSON.stringify(tbIds)}, length=${tbIds.length}`
      );
    });

    console.log('\n=== 2. 班级教材数据 ===');
    const classIds = await prisma.teachingArrangement
      .findMany({
        where: { courseId, semester },
        select: { classId: true },
      })
      .then((arr) => [...new Set(arr.map((a) => a.classId))]);

    const classes = await prisma.class.findMany({
      where: { id: { in: classIds } },
    });

    console.log(`共 ${classes.length} 个班级：`);
    const textbookGroupCount = {};
    classes.forEach((c) => {
      const key = (c.textbookIds || []).sort().join(',');
      textbookGroupCount[key] = (textbookGroupCount[key] || 0) + 1;
    });
    console.log('教材组合分布：', textbookGroupCount);

    console.log('\n=== 3. 排课结果 ===');
    const arrangements = await prisma.teachingArrangement.findMany({
      where: { courseId, semester },
      include: { teacher: true, class: true },
    });

    const teacherTextbooks = {};
    arrangements.forEach((a) => {
      if (!teacherTextbooks[a.teacherId]) {
        teacherTextbooks[a.teacherId] = { name: a.teacher.name, textbooks: new Set() };
      }
      (a.class?.textbookIds || []).forEach((id) => teacherTextbooks[a.teacherId].textbooks.add(id));
    });

    console.log(`排课结果：${arrangements.length} 条`);
    const stats = {};
    Object.values(teacherTextbooks).forEach((t) => {
      const count = t.textbooks.size;
      console.log(`  ${t.name}: ${count} 本教材`);
      stats[count] = (stats[count] || 0) + 1;
    });
    console.log('\n统计：', stats);

    console.log('\n=== 4. 课时量分析 ===');
    const totalWeeklyHours = classes.reduce((s, c) => s + c.weeklyHours, 0);
    console.log(`总课时量：${totalWeeklyHours}`);

    const teachersWithCapacity = await prisma.teacher.findMany({
      where: { id: { in: teacherIds } },
      select: { id: true, name: true, standardCap: true, fullCap: true },
    });

    const totalStandardCap = teachersWithCapacity.reduce((s, t) => s + t.standardCap, 0);
    const totalFullCap = teachersWithCapacity.reduce((s, t) => s + t.fullCap, 0);
    console.log(`教师总容量(standard)：${totalStandardCap}`);
    console.log(`教师总容量(full)：${totalFullCap}`);
    console.log(`standard模式下，最多可分配课时：${totalStandardCap}`);
    console.log(`是否可能所有教师只拿1本教材？需要深入分析...`);
  } catch (error) {
    console.error('诊断出错：', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

diagnose();
