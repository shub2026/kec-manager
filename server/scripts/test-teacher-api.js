// 使用Node.js内置的fetch API（Node 18+）

(async () => {
  try {
    // 模拟登录获取token
    const loginRes = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    
    const loginData = await loginRes.json();
    const token = loginData.data?.token;
    
    if (!token) {
      console.error('❌ 登录失败');
      return;
    }
    
    console.log('✅ 登录成功\n');
    
    // 获取语文课程（ID=6）的教师列表
    const teachersRes = await fetch('http://localhost:3001/api/teaching-arrange/teachers?course_id=6&semester=2025-2026-2', {
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const teachersData = await teachersRes.json();
    const teachers = teachersData.data || [];
    
    console.log(`教师列表 (${teachers.length}位教师):\n`);
    
    // 检查前5位教师的教材信息
    teachers.slice(0, 5).forEach(t => {
      console.log(`${t.name}:`);
      console.log(`  inherentTextbookIds: [${t.inherentTextbookIds.join(', ')}]`);
      console.log(`  assignedTextbooks: [${t.assignedTextbooks.map(tb => tb.title).join(', ')}]`);
      console.log(`  textbookIds: [${t.textbookIds.join(', ')}]`);
      console.log('');
    });
    
    // 统计有多少教师有assignedTextbooks
    const withAssigned = teachers.filter(t => t.assignedTextbooks && t.assignedTextbooks.length > 0);
    const withoutAssigned = teachers.filter(t => !t.assignedTextbooks || t.assignedTextbooks.length === 0);
    
    console.log(`\n📊 统计:`);
    console.log(`  有已用教材的教师: ${withAssigned.length}位`);
    console.log(`  无已用教材的教师: ${withoutAssigned.length}位`);
    
    if (withAssigned.length > 0) {
      console.log('\n有已用教材的教师示例:');
      withAssigned.slice(0, 3).forEach(t => {
        console.log(`  ${t.name}: [${t.assignedTextbooks.map(tb => tb.title).join(', ')}]`);
      });
    }
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
    process.exit(1);
  }
})();
