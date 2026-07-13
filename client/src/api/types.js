/**
 * API 共享类型定义
 *
 * 命名约定：
 * - 前端一律 camelCase
 * - 请求 body/query params 用 camelCase，由 naming 中间件转 snake_case 给后端
 * - 响应数据已由中间件转为 camelCase
 * - 审计日志 details JSON 保留 snake_case（后端原始写入，不转换）
 */

/**
 * 统一 API 响应包装
 * @template T
 * @typedef {Object} ApiResponse<T>
 * @property {boolean} success
 * @property {string} [message]
 * @property {T} [data]
 */

/**
 * 分页响应
 * @template T
 * @typedef {Object} PaginatedResponse<T>
 * @property {T[]} items
 * @property {number} total
 */

/** @typedef {'admin' | 'viewer' | 'super_admin'} UserRole */

/** @typedef {'active' | 'inactive' | 'left_school' | 'graduated'} ClassStatus */

/** @typedef {'full_time' | 'part_time' | 'external'} PersonnelType */

/**
 * 用户
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} [realName]
 * @property {string} [email]
 * @property {UserRole} role
 * @property {boolean} isActive
 * @property {string} [lastLoginAt]
 */
/**
 * 创建/更新用户参数
 * @typedef {Object} UserInput
 * @property {string} [username] - 创建时必填
 * @property {string} [password] - 创建时必填，至少 8 位
 * @property {string} [realName]
 * @property {string} [email]
 * @property {UserRole} [role]
 */

/** @typedef {Object} ToggleUserStatusInput @property {boolean} isActive */

/**
 * 登录响应
 * @typedef {Object} LoginResult
 * @property {User} user
 * @property {string} token
 * @property {string} refreshToken
 */

/** @typedef {Object} RefreshTokenInput @property {string} refreshToken */
/** @typedef {Object} ChangePasswordInput @property {string} oldPassword @property {string} newPassword */

/**
 * 班级
 * @typedef {Object} Class
 * @property {number} id
 * @property {string} name
 * @property {number} enrollmentYear
 * @property {number} durationYears
 * @property {number} [majorId]
 * @property {number} [collegeId]
 * @property {number} [trainingLevelId]
 * @property {number} studentCount
 * @property {number} [customPlanId]
 * @property {ClassStatus} [status]
 * @property {boolean} isLeftSchool
 */
/**
 * 创建/更新班级参数
 * @typedef {Object} ClassInput
 * @property {string} name
 * @property {number} enrollmentYear
 * @property {number} durationYears
 * @property {number} [majorId]
 * @property {number} [collegeId]
 * @property {number} [trainingLevelId]
 * @property {number} [studentCount]
 * @property {number} [customPlanId]
 * @property {boolean} [isLeftSchool]
 */
/**
 * 班级列表查询参数
 * @typedef {Object} ClassListParams
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [name]
 * @property {number} [majorId]
 * @property {number} [collegeId]
 * @property {number} [trainingLevelId]
 * @property {number} [planId] - 传 'none' 查询未关联方案的班级
 * @property {number} [enrollmentYear]
 * @property {string} [status] - 'active' | 'graduated' | 'left_school'
 */

/** @typedef {Object} College @property {number} id @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */
/** @typedef {Object} CollegeInput @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */

/** @typedef {Object} Major @property {number} id @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */
/** @typedef {Object} MajorInput @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */

/** @typedef {Object} TrainingLevel @property {number} id @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */
/** @typedef {Object} TrainingLevelInput @property {string} name @property {string} [code] @property {string} [description] @property {number} [sortOrder] */

/** @typedef {Object} Course @property {number} id @property {string} name @property {string} [code] @property {string} [type] @property {string} [description] @property {number} [sortOrder] */
/** @typedef {Object} CourseInput @property {string} name @property {string} [code] @property {string} [type] @property {string} [description] @property {number} [sortOrder] */
/** @typedef {Object} CourseListParams @property {string} [name] @property {string} [type] @property {string} [code] */

/**
 * 教材
 * @typedef {Object} Textbook
 * @property {number} id
 * @property {string} title
 * @property {string} [isbn]
 * @property {string} [publisher]
 * @property {string} [author]
 * @property {string} [edition]
 * @property {string} [publishDate]
 * @property {number} [price]
 * @property {string} [category]
 * @property {string} [description]
 * @property {boolean} isActive
 * @property {number} [sortOrder]
 */
/**
 * 创建/更新教材参数
 * @typedef {Object} TextbookInput
 * @property {string} title
 * @property {string} [isbn]
 * @property {string} [publisher]
 * @property {string} [author]
 * @property {string} [edition]
 * @property {string} [publishDate]
 * @property {number} [price]
 * @property {string} [category]
 * @property {string} [description]
 * @property {boolean} [isActive]
 * @property {number} [sortOrder]
 */

/**
 * 培养方案
 * @typedef {Object} Plan
 * @property {number} id
 * @property {string} name
 * @property {number} [majorId]
 * @property {number} [collegeId]
 * @property {number} [trainingLevelId]
 * @property {string} [version]
 * @property {string} [description]
 * @property {number} [sortOrder]
 */
/**
 * 创建/更新方案参数
 * @typedef {Object} PlanInput
 * @property {string} name
 * @property {number} [majorId]
 * @property {number} [collegeId]
 * @property {number} [trainingLevelId]
 * @property {string} [version]
 * @property {string} [description]
 */
/** @typedef {Object} PlanListParams @property {number} [collegeId] */

/**
 * 培养方案课程
 * @typedef {Object} PlanCourse
 * @property {number} id
 * @property {number} planId
 * @property {number} courseId
 * @property {number} startSemester
 * @property {number} endSemester
 * @property {number} weeklyHours
 * @property {number} [weeksPerSemester]
 * @property {number} [sortOrder]
 */
/**
 * 添加方案课程参数
 * @typedef {Object} PlanCourseInput
 * @property {number} courseId
 * @property {number} startSemester
 * @property {number} endSemester
 * @property {number} weeklyHours
 * @property {number} [weeksPerSemester]
 */

/** @typedef {Object} PlanSemester @property {number} id @property {number} planCourseId @property {number} semester @property {number} weeklyHours @property {number} [weeksCount] } */
/** @typedef {Object} PlanSemesterInput @property {number} planCourseId @property {number} semester @property {number} weeklyHours @property {number} [weeksCount] } */
/** @typedef {Object} SetSemesterTextbookInput @property {number} textbookId @property {boolean} [isRequired] } */

/**
 * 教师
 * @typedef {Object} Teacher
 * @property {number} id
 * @property {string} name
 * @property {string} [gender]
 * @property {string} [birthDate]
 * @property {PersonnelType} [personnelType]
 * @property {string} [qualificationType]
 * @property {number} [defaultWeeklyHours]
 * @property {string} [status]
 * @property {number} [sortOrder]
 * @property {number} [affiliatedCollegeId]
 */
/**
 * 创建/更新教师参数
 * @typedef {Object} TeacherInput
 * @property {string} name
 * @property {string} [gender]
 * @property {string} [birthDate]
 * @property {PersonnelType} [personnelType]
 * @property {string} [qualificationType]
 * @property {number} [defaultWeeklyHours]
 * @property {string} [status]
 * @property {number} [sortOrder]
 * @property {number} [affiliatedCollegeId]
 */

/**
 * 教学安排 - 班级课程列表查询
 * @typedef {Object} TeachingArrangeParams
 * @property {number} courseId
 * @property {string} semester
 * @property {string} [college]
 * @property {string} [major]
 * @property {string} [trainingLevel]
 * @property {number} [grade]
 * @property {string} [textbook]
 */

/** @typedef {Object} AssignTeacherInput @property {number} teacherId @property {number} classId @property {number} courseId @property {string} semester @property {number} [weeklyHours] } */
/** @typedef {Object} AutoArrangeInput @property {number} courseId @property {string} semester @property {'full' | 'standard'} mode */
/** @typedef {Object} BatchAutoArrangeInput @property {string} semester @property {'full' | 'standard'} mode */

/**
 * 课时要求
 * @typedef {Object} HourSettings
 * @property {{standard: number, max: number}} [fullTime]
 * @property {{standard: number, max: number}} [partTime]
 * @property {{standard: number, max: number}} [external]
 */
/** @typedef {Object} HourSettingsInput @property {number} courseId @property {HourSettings} hourSettings } */
/** @typedef {Object} HourSettingsQuery @property {number} courseId } */

/**
 * 首页统计
 * @typedef {Object} DashboardStats
 * @property {number} plans
 * @property {number} teachingTeachers
 * @property {number} majors
 * @property {number} courses
 * @property {number} classes
 * @property {number} textbooks
 * @property {number} totalStudents
 * @property {number} totalWeeklyHours
 * @property {string} semester
 * @property {Object} [alerts]
 * @property {Array<{id: number, name: string}>} [alerts.unassignedCourses]
 * @property {Array<{id: number, name: string, limit: number, hours: number}>} [alerts.overloadedTeachers]
 */

/**
 * 审计日志查询
 * @typedef {Object} AuditLogParams
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [action]
 * @property {string} [module]
 * @property {string} [result]
 */

/**
 * 审计日志
 * @typedef {Object} AuditLog
 * @property {number} id
 * @property {string} action
 * @property {string} module
 * @property {number} [operatorId]
 * @property {string} [ip]
 * @property {string} [details] - JSON 字符串，内部字段保留 snake_case
 * @property {string} result
 * @property {string} [message]
 * @property {string} createdAt
 */

/**
 * 审计日志分页响应
 * 注意：后端对审计接口返回 `logs`（而非通用分页的 `items`），并额外携带 page/pageSize
 * @typedef {Object} AuditLogResponse
 * @property {Array<AuditLog>} logs
 * @property {number} total
 * @property {number} page
 * @property {number} pageSize
 */

/**
 * 系统设置
 * @typedef {Object} SystemSettings
 * @property {{value: string}} [currentSemester] - 如 { value: '2025-2026-2' }
 * @property {{value: string}} [organizationName] - 如 { value: '某某学院' }
 */
/** @typedef {Object} SystemSettingsInput @property {string} [currentSemester] @property {string} [organizationName] } */
/** @typedef {Object} ResetInput @property {string} [confirm] @property {string} [reason] } */

/**
 * 学期查询参数
 * @typedef {Object} SemesterQueryParams
 * @property {string} semester
 * @property {number} [collegeId]
 * @property {number} [majorId]
 * @property {number} [trainingLevelId]
 * @property {number} [enrollmentYear]
 * @property {number} [grade]
 */

/** @typedef {Object} TextbookQueryParams @property {string} [semester] } */
/** @typedef {Object} TextbooksOverviewParams @property {string} [category] @property {boolean} [isActive] @property {string} [publisher] } */

/**
 * 导出参数
 * @typedef {Object} ExportStatisticsParams
 * @property {string} semester
 * @property {string} [name]
 * @property {string} [type]
 * @property {string} [subject]
 * @property {string} [affiliatedCollege]
 * @property {string} [level]
 * @property {string} [college]
 */
/** @typedef {Object} ExportSemesterInput @property {string} semester @property {number} [collegeId] @property {number} [majorId] @property {number} [trainingLevelId] @property {number} [enrollmentYear] @property {number} [grade] } */

/** @typedef {Object} DeleteOptions @property {boolean} [silent] - 静默错误（不弹错误提示） */
