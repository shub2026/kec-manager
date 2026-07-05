import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// 从环境变量读取配置
const FORCE_RESET = process.env.FORCE_RESET === 'true';
const DEV_MODE = process.env.NODE_ENV !== 'production' || process.env.DEV_SEEDS === 'true';

/**
 * 确保超级管理员存在
 * 如果已存在则跳过，保护生产环境的账号不被覆盖
 */
async function ensureSuperAdmin() {
  const existingAdmin = await prisma.users.findFirst({
    where: { username: 'admin' }
  });

  if (existingAdmin) {
    console.log('✓ 超级管理员已存在，跳过创建');
    console.log(`  用户名: ${existingAdmin.username}`);
    console.log(`  角色: ${existingAdmin.role}`);
    console.log(`  状态: ${existingAdmin.is_active ? '激活' : '禁用'}\n`);
    return;
  }

  // 仅在不存在时创建
  console.log('创建超级管理员账号...');
  const defaultPassword = 'admin@123456';
  const adminPassword = await bcrypt.hash(defaultPassword, 10);

  const admin = await prisma.users.create({
    data: {
      username: 'admin',
      password: adminPassword,
      role: 'super_admin',
      real_name: '系统管理员',
      email: 'admin@example.com',
      is_active: true,
      must_change_password: true,
    }
  });

  console.log('═══════════════════════════════════════════════════');
  console.log('✓ 超级管理员账号已创建');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   用户名: admin`);
  console.log(`   密码: ${defaultPassword}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('⚠️  警告：生产环境首次登录后请立即修改密码！');
  console.log('═══════════════════════════════════════════════════\n');
}

/**
 * 清空所有业务数据（仅在强制重置或开发模式下执行）
 */
async function clearAllData() {
  if (!FORCE_RESET && !DEV_MODE) {
    console.log('✓ 跳过数据清空（生产环境保护模式）\n');
    return;
  }

  console.warn('\n⚠️  警告：即将清空所有数据！');
  console.warn('   此操作不可恢复！\n');

  // 按依赖关系逆序删除
  console.log('清空现有数据...');
  await prisma.audit_logs.deleteMany();
  await prisma.users.deleteMany();
  await prisma.plan_textbooks.deleteMany();
  await prisma.plan_course_semesters.deleteMany();
  await prisma.plan_courses.deleteMany();
  await prisma.training_plans.deleteMany();
  await prisma.classes.deleteMany();
  await prisma.textbooks.deleteMany();
  await prisma.courses.deleteMany();
  await prisma.majors.deleteMany();
  await prisma.colleges.deleteMany();
  await prisma.training_levels.deleteMany();
  await prisma.system_settings.deleteMany();
  console.log('✓ 数据清空完成\n');
}

/**
 * 可选：在开发模式下创建测试数据
 */
async function createDevSeeds() {
  if (!DEV_MODE) return;

  console.log('开发模式：创建基础测试数据...');
  // 这里可以添加开发环境的测试数据
  // 例如：示例学院、专业、课程等
  console.log('✓ 开发测试数据创建完成\n');
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('KEC 课程管理平台 - 数据库初始化');
  console.log('═══════════════════════════════════════════════════');
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`强制重置: ${FORCE_RESET ? '是' : '否'}`);
  console.log(`开发模式: ${DEV_MODE ? '是' : '否'}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 步骤1：根据配置决定是否清空数据
  await clearAllData();

  // 步骤2：确保超级管理员存在（智能检查，不重复创建）
  await ensureSuperAdmin();

  // 步骤3：开发环境下创建测试数据（可选）
  await createDevSeeds();

  console.log('═══════════════════════════════════════════════════');
  console.log('✓ 数据库初始化完成');
  console.log('═══════════════════════════════════════════════════');
  console.log('下一步：');
  console.log('  1. 启动应用: npm run dev');
  console.log('  2. 访问前端: http://localhost:5173');
  console.log('  3. 使用 admin 账号登录');
  console.log('  4. 导入基础数据（学院、专业、课程等）');
  console.log('═══════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error('种子数据创建失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
