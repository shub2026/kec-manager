// 班级状态常量
export const CLASS_STATUS = {
  ACTIVE: 'active',
  GRADUATED: 'graduated',
  LEFT_SCHOOL: 'left_school'
};

// 用户角色常量
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  VIEWER: 'viewer'
};

// 分页常量
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE: 1
};

// 导入配置
export const IMPORT = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['xlsx', 'xls']
};

// 密码策略
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[a-zA-Z\d@$!%*?&]{8,}$/
};

// 审计模块
export const AUDIT_MODULES = {
  AUTH: 'auth',
  USER: 'user',
  MAJOR: 'major',
  COLLEGE: 'college',
  COURSE: 'course',
  TEXTBOOK: 'textbook',
  CLASS: 'class',
  PLAN: 'trainingPlan',
  TRAINING_LEVEL: 'training_level',
  SYSTEM: 'system',
  TEACHER: 'teacher',
  TEACHING_ARRANGE: 'teachingArrange'
};

// 人员类别
export const PERSONNEL_TYPE = {
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  EXTERNAL: 'external'
};

// 默认课时要求设置
export const DEFAULT_HOUR_SETTINGS = {
  full_time: { standard: 16, max: 20 },
  part_time: { standard: 12, max: 16 },
  external: { standard: 12, max: 16 },
};

// 课时设置存储键前缀
export const HOUR_SETTINGS_PREFIX = 'teaching_hour_settings';

// 排课模式
export const ARRANGE_MODE = {
  FULL: 'full',
  STANDARD: 'standard',
};

// 工作量平衡阈值
export const WORKLOAD_BALANCE = {
  SCORE_THRESHOLD: 1,
  LOAD_RATE_THRESHOLD: 0.2,
};

// 教材内聚优化配置（2026-06-20 新增）
// 用于解决"教师同时上多本教材、内聚度低"问题
// 关闭时（ENABLED=false）回退到原有评分逻辑
export const TEXTBOOK_COHESION = {
  ENABLED: true,                // 总开关：是否启用内聚优化
  // 评分权重（calcMatchScore）
  COLLEGE_WEIGHT: 5,            // 学院匹配权重
  LEVEL_WEIGHT: 5,              // 层次匹配权重
  ASSIGNED_WEIGHT: 6,           // 本轮已用教材权重（强化内聚，保留原值）
  INHERENT_WEIGHT: 4,           // 固有教材权重（原值 3，提升以鼓励历史教材）
  PENALTY_PER_NEW: 2,           // 每新增一本教材的扣分（新增项，0 表示禁用惩罚）
  // 阶段链
  COHESION_PHASE_ENABLED: true, // 是否启用 phase2.5 内聚优先阶段
  // 兜底推导
  FALLBACK_EMPTY: true,         // true=无排课记录教师教材为空集合；false=保留全量并集兜底
  // 统计
  SCATTERED_THRESHOLD: 3,       // 教师教材数 ≥ 此值视为"分散"
};

// 审计操作
export const AUDIT_ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  IMPORT: 'import',
  EXPORT: 'export'
};

// 审计结果
export const AUDIT_RESULTS = {
  SUCCESS: 'success',
  FAILED: 'failed'
};
