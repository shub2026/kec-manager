// utils/personnel.js
// 人员类别中文映射 + 标签配色，与 WEB 端 client/src/utils/personnel.js 保持一致
const PERSONNEL_MAP = {
  full_time: '专职',
  part_time: '兼职',
  external: '外聘',
};

// WEB 端 el-tag 语义类型 → 小程序对应配色 class
// 专职=success(绿)、兼职=warning(橙)、外聘=info(灰)
const PERSONNEL_TAG_MAP = {
  full_time: 'success',
  part_time: 'warning',
  external: 'info',
};

function personnelLabel(type) {
  return PERSONNEL_MAP[type] || type || '';
}

function personnelTagClass(type) {
  return PERSONNEL_TAG_MAP[type] || '';
}

module.exports = { personnelLabel, personnelTagClass };
