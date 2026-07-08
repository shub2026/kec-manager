// 班级状态常量
export const CLASS_STATUS = {
  ACTIVE: 'active',
  GRADUATED: 'graduated',
  LEFT_SCHOOL: 'left_school',
};

// 用户角色常量
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  VIEWER: 'viewer',
};

// 分页常量
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MIN_PAGE: 1,
};

// 导入配置
export const IMPORT = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  ALLOWED_FILE_TYPES: ['xlsx', 'xls'],
  MAX_ROWS: 20000,
};

// 默认教材类别
export const DEFAULT_TEXTBOOK_CATEGORY = '技工';

// 默认学期（系统初始化时使用）
// P2-4: 此处 2025-2026-2 为开发默认值；部署时建议通过 DEFAULT_SEMESTER 环境变量覆盖，
// 避免硬编码时间相关值导致不同环境学期不一致
export const DEFAULT_SEMESTER = process.env.DEFAULT_SEMESTER || '2025-2026-2';

// 密码策略
export const PASSWORD_POLICY = {
  MIN_LENGTH: 8,
  MAX_LENGTH: 128,
  MIN_TYPES: 2,
  DESCRIPTION: '密码须至少包含两种字符类型（小写字母、大写字母、数字、特殊字符），长度8-128位',
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
  TEACHING_ARRANGE: 'teachingArrange',
};

// 人员类别
export const PERSONNEL_TYPE = {
  FULL_TIME: 'full_time',
  PART_TIME: 'part_time',
  EXTERNAL: 'external',
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
  ENABLED: true, // 总开关：是否启用内聚优化
  // 评分权重（calcMatchScore）
  COLLEGE_WEIGHT: 5, // 学院匹配权重
  LEVEL_WEIGHT: 5, // 层次匹配权重
  ASSIGNED_WEIGHT: 10, // 本轮已用教材权重（提高，促进内聚）
  INHERENT_WEIGHT: 4, // 固有教材权重
  PENALTY_PER_NEW: 10, // 新增教材每本扣分（提高）
  // 教材数量分级奖惩（2026-06-20 十二轮：强化内聚）
  // P1-4 修复：对齐配置项与实现，移除 calcMatchScore 中的硬编码
  ZERO_TEXTBOOK_BONUS: 30, // 0本教师加分（提高）
  TEXTBOOK_COUNT_PENALTY_1_NEW: 10000, // 1本教师接新课极重惩罚（实质淘汰，原硬编码 -10000）
  TEXTBOOK_COUNT_BONUS_1_SAME: 10, // 1本教师接同类加分（原硬编码 +10）
  TEXTBOOK_COUNT_PENALTY_2: 20, // 已有2本教材扣分（提高）
  TEXTBOOK_COUNT_PENALTY_3PLUS: 150, // 已有3+本教材惩戒（实质禁止）
  MAX_TEXTBOOKS_PER_TEACHER: 2, // 硬上限：教师最多同时教几本教材（0=不限制）
  // 阶段链
  COHESION_PHASE_ENABLED: true, // 是否启用 phase2.5 内聚优先阶段
  PHASE0_ENABLED: false, // 关闭旧 Phase 0，改用教材分组优先
  // 兜底推导
  FALLBACK_EMPTY: true, // true=无排课记录教师教材为空集合；false=保留全量并集兜底
  // 统计
  SCATTERED_THRESHOLD: 3, // 教师教材数 ≥ 此值视为"分散"
};

// 禁忌搜索优化配置（2026-07-06 新增）
// 在五阶段贪心构造初始解后，用禁忌搜索迭代优化
// 关闭时（ENABLED=false）行为与纯贪心完全一致
export const TABU_SEARCH = {
  ENABLED: false, // 总开关：是否启用禁忌搜索优化层
  MAX_ITERATIONS: 500, // 单课程最大迭代次数
  TABU_TENURE: 10, // 禁忌期限（轮数）
  NO_IMPROVEMENT_LIMIT: 80, // 连续无改进轮数，达到后提前终止
  SINGLE_COURSE_TIMEOUT_MS: 15000, // 单课程超时上限（毫秒）
  UNASSIGNED_PENALTY: 500, // 每个未分配班级的惩罚分值
};

// P0-1 修复：置换回溯递归深度限制
// 支持链式调整（A→B→C），maxDepth=3 平衡搜索能力与性能
export const SWAP_CONFIG = {
  MAX_DEPTH: 3, // 最大递归深度
  MAX_UNASSIGNED: 30, // 未分配数超过此值时跳过递归（性能保护）
};

// P0-2 修复：批量排课容量预留
// 避免先处理课程耗尽教师容量，预留比例给后续课程
export const BATCH_CONFIG = {
  RESERVE_RATIO: 0.85, // 每门课程最多使用教师剩余容量的 85%，预留 15% 给后续课程
};

// 审计操作
export const AUDIT_ACTIONS = {
  LOGIN: 'login',
  LOGOUT: 'logout',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  IMPORT: 'import',
  EXPORT: 'export',
};

// 审计结果
export const AUDIT_RESULTS = {
  SUCCESS: 'success',
  FAILED: 'failed',
};

// 教师状态常量
export const TEACHER_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
};
