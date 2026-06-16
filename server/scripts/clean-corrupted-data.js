import { prisma } from '../src/lib/prisma.js';

async function cleanCorruptedData() {
  console.log('=== 清理乱码数据 ===\n');
  
  try {
    // 删除ID>=3的乱码教材（通过curl创建的）
    const deleted = await prisma.textbooks.deleteMany({ 
      where: { id: { gte: 3 } } 
    });
    console.log(`✓ 已删除 ${deleted.count} 条乱码教材`);
    
    // 创建正确的测试数据
    const textbook = await prisma.textbooks.create({
      data: {
        title: '数学教材',
        isbn: '978-7-111-99999-9',
        publisher: '教育出版社',
        author: '张老师',
        sort_order: 3
      }
    });
    console.log(`✓ 已创建新教材: ${textbook.title}\n`);
    
    // 验证数据正确性
    const verify = await prisma.textbooks.findUnique({ where: { id: textbook.id } });
    console.log('验证结果:');
    console.log('  ID:', verify.id);
    console.log('  标题:', verify.title);
    console.log('  出版社:', verify.publisher);
    console.log('  作者:', verify.author);
    console.log('  编码正确:', verify.title === '数学教材' ? '✓' : '✗');
    
  } catch (error) {
    console.error('❌ 操作失败:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

cleanCorruptedData();
