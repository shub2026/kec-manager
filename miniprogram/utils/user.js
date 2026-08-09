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

const ROLE_CLASS_MAP = {
  super_admin: 'pt-super',
  admin: 'pt-admin',
  viewer: 'pt-viewer',
};

// 角色对应的标签样式类（颜色区分权限等级）
function roleClass(role) {
  return ROLE_CLASS_MAP[role] || 'pt-viewer';
}

module.exports = { roleLabel, roleClass };
