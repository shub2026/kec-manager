const PERSONNEL_MAP = { full_time: '专职', part_time: '兼职', external: '外聘' };
// 人员类别 TAG 全站统一为语义色方案（产品定稿）：专职=绿、兼职=橙、外聘=灰，
// 默认 light 效果；属 TAG 用色规则中的既定例外（见 global.css 注释）
const PERSONNEL_TAG_MAP = { full_time: 'success', part_time: 'warning', external: 'info' };

export function personnelLabel(type) {
  return PERSONNEL_MAP[type] || type || '-';
}

export function personnelTagType(type) {
  return PERSONNEL_TAG_MAP[type] || '';
}
