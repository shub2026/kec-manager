import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authConfig } from '../src/config/auth.config.js';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('=== 开始重置数据库 ===\n');

  try {
    // 1. 清空所有现有数据（按依赖顺序）
    console.log('清空现有数据...');
    await prisma.$transaction([
      prisma.audit_logs.deleteMany(),
      prisma.teaching_assignments.deleteMany(),
      prisma.plan_textbooks.deleteMany(),
      prisma.plan_course_semesters.deleteMany(),
      prisma.plan_courses.deleteMany(),
      prisma.training_plans.deleteMany(),
      prisma.teacher_training_levels.deleteMany(),
      prisma.teacher_scheduling_colleges.deleteMany(),
      prisma.teacher_courses.deleteMany(),
      prisma.teachers.deleteMany(),
      prisma.classes.deleteMany(),
      prisma.textbooks.deleteMany(),
      prisma.courses.deleteMany(),
      prisma.training_levels.deleteMany(),
      prisma.majors.deleteMany(),
      prisma.colleges.deleteMany(),
      prisma.system_settings.deleteMany(),
      prisma.users.deleteMany(),
    ]);
    console.log('✓ 所有数据已清空\n');

    // 2. 重新生成数据库表结构
    console.log('重新生成数据库表结构...');
    const { execSync } = await import('child_process');
    execSync('npx prisma db push --force-reset', { stdio: 'inherit', cwd: process.cwd() });
    console.log('✓ 数据库表结构已重置\n');

    // 3. 创建默认用户
    console.log('创建默认用户...');
    const initialPassword = process.env.ADMIN_INITIAL_PASSWORD || 'admin@123456';
    const hashedPassword = await bcrypt.hash(initialPassword, authConfig.bcryptRounds);

    try {
      const adminUser = await prisma.users.create({
        data: {
          username: 'admin',
          password: hashedPassword,
          role: 'super_admin',
          real_name: '系统管理员',
          email: 'admin@example.com',
          is_active: true,
        },
      });
      console.log(`✓ 超级管理员已创建: ${adminUser.username}（密码已通过环境变量设置）\n`);
    } catch (error) {
      if (error.code === 'P2002') {
        console.log('⚠ 管理员用户已存在，跳过创建\n');
      } else {
        throw error;
      }
    }

    // 4. 初始化系统设置
    console.log('初始化系统设置...');
    const defaultSettings = [
      {
        key: 'system.name',
        value: 'KEC课程管理平台',
        description: '系统名称',
      },
      {
        key: 'system.version',
        value: '1.0.0',
        description: '系统版本',
      },
      {
        key: 'upload.maxFileSize',
        value: '10',
        description: '最大上传文件大小(MB)',
      },
      {
        key: 'upload.allowedTypes',
        value: 'xlsx,xls,csv,pdf,jpg,png',
        description: '允许上传的文件类型',
      },
      {
        key: 'semester.current',
        value: '2026-1',
        description: '当前学期',
      },
      {
        key: 'academic.year',
        value: '2026',
        description: '当前学年',
      },
    ];

    for (const setting of defaultSettings) {
      await prisma.system_settings.create({
        data: setting,
      });
    }
    console.log(`✓ 已创建 ${defaultSettings.length} 条系统设置\n`);

    // 5. 创建基础数据(可选)
    console.log('是否创建基础测试数据?');
    console.log('(学院、专业、培养层次、课程等)');
    console.log('提示: 可以稍后通过管理界面添加\n');

    console.log('=== 数据库重置完成! ===\n');
    console.log('登录信息:');
    console.log('  用户名: admin');
    console.log('  密码: 已通过环境变量 ADMIN_INITIAL_PASSWORD 设置');
    console.log('  角色: super_admin\n');
  } catch (error) {
    console.error('❌ 数据库重置失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// 执行重置
resetDatabase().catch((err) => {
  console.error(err);
  process.exit(1);
});
