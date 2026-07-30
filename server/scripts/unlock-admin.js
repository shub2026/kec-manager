import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const r = await p.users.update({
  where: { username: 'admin' },
  data: { locked_until: null, failed_login_count: 0 },
});
console.log('Unlocked:', r.username, 'locked_until:', r.locked_until, 'fail_count:', r.fail_count);
await p.$disconnect();
