import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { authConfig } from '../src/config/auth.config.js';

const prisma = new PrismaClient();

async function updateAdminPassword() {
  console.log('=== 更新管理员密码 ===\n');

  try {
    const newPassword = 'admin@123456';

    // 查找 admin 用户
    const admin = await prisma.users.findUnique({
      where: { username: 'admin' },
    });

    if (!admin) {
      console.log('❌ 未找到 admin 用户');
      return;
    }

    console.log(`找到用户: ${admin.username} (${admin.real_name})`);

    // 生成新的密码哈希（与主应用统一 bcrypt rounds，避免弱哈希）
    const hashedPassword = await bcrypt.hash(newPassword, authConfig.bcryptRounds);
    console.log('✓ 已生成新密码哈希\n');

    // 更新密码
    await prisma.users.update({
      where: { id: admin.id },
      data: { password: hashedPassword },
    });

    console.log('✓ 密码更新成功!\n');
    console.log('=== 新的登录信息 ===');
    console.log(`用户名: admin`);
    console.log(`密码: ${newPassword}`);
    console.log(`角色: ${admin.role}\n`);
  } catch (error) {
    console.error('❌ 密码更新失败:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

updateAdminPassword().catch((err) => {
  console.error(err);
  process.exit(1);
});
