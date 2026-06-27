// vitest.setup.js
// 在所有测试前运行，设置测试环境变量
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_DOWNLOAD_SECRET = 'test-download-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.JWT_DOWNLOAD_EXPIRES_IN = '60s';
process.env.BCRYPT_ROUNDS = '10';
process.env.NODE_ENV = 'test';
// 防止 Prisma Client 在测试时因缺少 DATABASE_URL 而崩溃
process.env.DATABASE_URL = 'file:./test.db';

