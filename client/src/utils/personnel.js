const PERSONNEL_MAP = { full_time: '专职', part_time: '兼职', external: '外聘' };
// 人员类别 TAG 全站统一为语义色方案（产品定稿）：专职=绿、兼职=橙、外聘=灰，
// 默认 light 效果；属 TAG 用色规则中的既定例外（见 global.css 注释）
const PERSONNEL_TAG_MAP = { full_time: 'success', part_time: 'warning', external: 'info' };

// 归一化人员类别键：后端/缓存可能返回驼峰变体（fullTime/partTime），
// 统一转 snake_case 再查表，避免英文原值直接展示
export function normalizePersonnelType(type) {
  return typeof type === 'string' ? type.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() : type;
}

export function personnelLabel(type) {
  return PERSONNEL_MAP[normalizePersonnelType(type)] || type || '-';
}

export function personnelTagType(type) {
  return PERSONNEL_TAG_MAP[normalizePersonnelType(type)] || '';
}
