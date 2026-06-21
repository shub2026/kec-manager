import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function resetDatabase() {
  console.log('=== 开始重置数据库 ===\n');

  try {
    // 1. 删除现有数据库文件
    const dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
    if (fs.existsSync(dbPath)) {
      console.log('删除现有数据库文件...');
      fs.unlinkSync(dbPath);
      console.log('✓ 数据库文件已删除\n');
    }

    // 2. 重新生成数据库表结构
    console.log('重新生成数据库表结构...');
    const { execSync } = await import('child_process');
    execSync('npx prisma db push', { stdio: 'inherit', cwd: process.cwd() });
    console.log('✓ 数据库表结构已生成\n');

    // 3. 创建默认用户
    console.log('创建默认用户...');
    const hashedPassword = await bcrypt.hash('admin@123456', 10);

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
    console.log(`✓ 超级管理员已创建: ${adminUser.username} (密码: admin@123456)\n`);

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
    console.log('  密码: admin@123456');
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
