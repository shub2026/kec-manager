// utils/user.js
// 用户相关常量与映射，与 WEB 端保持一致

const ROLE_LABEL_MAP = {
  super_admin: '超级管理员',
  admin: '管理员',
  viewer: '访客',
};

function roleLabel(role) {
  return ROLE_LABEL_MAP[role] || role || '—';
}

module.exports = { roleLabel };
