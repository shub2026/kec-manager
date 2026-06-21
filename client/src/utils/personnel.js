const PERSONNEL_MAP = { full_time: '专职', part_time: '兼职', external: '外聘' };
const PERSONNEL_TAG_MAP = { full_time: 'success', part_time: 'warning', external: 'info' };

export function personnelLabel(type) {
  return PERSONNEL_MAP[type] || type || '-';
}

export function personnelTagType(type) {
  return PERSONNEL_TAG_MAP[type] || '';
}
