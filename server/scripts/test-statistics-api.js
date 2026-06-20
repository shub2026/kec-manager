// 测试 getStatistics API
const testAPI = async () => {
  try {
    const response = await fetch('http://localhost:3001/api/teaching-arrange/statistics?semester=2025-2026-2', {
      headers: {
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJhZG1pbiIsImlhdCI6MTcxODg4MDAwMCwiZXhwIjoxNzE4OTY2NDAwfQ.test'
      }
    });
    
    const data = await response.json();
    console.log('API Response:', JSON.stringify(data, null, 2));
    
    if (data.data && data.data.teachers) {
      console.log('\n前3位教师的trainingLevelList:');
      data.data.teachers.slice(0, 3).forEach(t => {
        console.log(`  ${t.teacherName}:`, JSON.stringify(t.trainingLevelList));
      });
    }
  } catch (error) {
    console.error('Error:', error);
  }
};

testAPI();
