// 测试学期格式转换
const semesterStr = '2025-2026-2';
const semesterNum = parseInt(semesterStr.replace(/-/g, ''));

console.log(`原始学期: ${semesterStr}`);
console.log(`转换后: ${semesterNum}`);
console.log(`期望值: 2025202602`);
console.log(`匹配: ${semesterNum === 2025202602}`);
