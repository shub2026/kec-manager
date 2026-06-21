/**
 * 初始化系统默认设置
 * 用法: node scripts/init-settings.js
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 加载环境变量
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const prisma = new PrismaClient();

const DEFAULT_SETTINGS = [
  {
    key: 'current_semester',
    value: '2025-2026-2',
    description:
      '当前学期（格式：起始学年-结束学年-学期序号，如 2025-2026-2 表示2025-2026学年第2学期）',
  },
  {
    key: 'organization_name',
    value: '欢迎回来',
    description: '系统标识（单位名称），用于首页展示',
  },
];

async function initSettings() {
  console.log('🔧 开始初始化系统设置...\n');

  try {
    // 测试数据库连接
    await prisma.$connect();
    console.log('✅ 数据库连接成功\n');

    let created = 0;
    let updated = 0;

    for (const setting of DEFAULT_SETTINGS) {
      const existing = await prisma.system_settings.findUnique({
        where: { key: setting.key },
      });

      if (existing) {
        console.log(`⏭️  ${setting.key} 已存在，跳过`);
        console.log(`   当前值: ${existing.value}`);
        updated++;
      } else {
        await prisma.system_settings.create({
          data: setting,
        });
        console.log(`✅ ${setting.key} 已创建`);
        console.log(`   值: ${setting.value}`);
        console.log(`   描述: ${setting.description}`);
        created++;
      }
      console.log();
    }

    console.log('='.repeat(50));
    console.log(`\n📊 初始化完成:`);
    console.log(`   - 新建: ${created} 条`);
    console.log(`   - 已存在: ${updated} 条`);
    console.log(`   - 总计: ${DEFAULT_SETTINGS.length} 条\n`);

    if (created > 0) {
      console.log('💡 提示: 如需修改这些设置，请使用管理员账号登录系统');
      console.log('   或在数据库中直接修改 system_settings 表\n');
    }
  } catch (error) {
    console.error('❌ 初始化失败:', error.message);
    console.error('错误代码:', error.code);
    console.error('\n可能的原因:');
    console.error('1. 数据库文件不存在或路径错误');
    console.error('2. 数据库权限不足');
    console.error('3. Prisma schema 未同步\n');
    console.error('建议执行:');
    console.error('  npx prisma generate');
    console.error('  npx prisma migrate deploy\n');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

initSettings().catch((err) => {
  console.error('💥 未预期的错误:', err);
  process.exit(1);
});
