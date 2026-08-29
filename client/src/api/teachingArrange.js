import request, { buildAuthHeaders } from '../utils/request';
import { useAuthStore } from '../stores/auth';
import './types';

/**
 * SSE（Server-Sent Events）流式调用封装
 * 用于排课等长耗时操作，通过 fetch + ReadableStream 读取后端推送的进度事件
 *
 * 事件类型：
 *   - progress: 排课进度（每完成一门课程或一个阶段推送）
 *   - complete: 排课完成，携带最终结果
 *   - error: 排课失败，携带错误信息
 *
 * @param {string} url - API 端点
 * @param {object} body - 请求体
 * @param {(progress: object) => void} onProgress - 进度回调
 * @param {{timeout?: number, signal?: AbortSignal}} [options] - 超时/外部取消信号等配置
 * @returns {Promise<{success: boolean, data: object, message: string}>} 最终结果
 */
async function fetchArrangeSSE(url, body, onProgress, options = {}) {
  // SSE 流式响应不设 HTTP 超时（后端 batch.js 自带 5 分钟业务超时）
  // 但设置一个兜底超时避免无限等待
  const controller = new AbortController();
  const timeoutMs = options.timeout || 7 * 60 * 1000; // 7 分钟，略大于后端上限
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // 外部取消信号（用户主动中止）联动内部 controller，断开 fetch 与流读取
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  // 每次发送时重新构造认证头（复用拦截器同源逻辑），重试时才能拿到刷新后的新凭证
  const sendRequest = () =>
    fetch(`/api${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...buildAuthHeaders(),
      },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });

  let response;
  try {
    response = await sendRequest();

    // 自愈重试：fetch 不走 axios 拦截器，需自行处理凭证失效，每类各允许一次：
    // - 401：访问令牌过期 → 刷新令牌后重试（长会话中排课前未触发过 axios 刷新时会遇到）
    // - 403 CSRF：cookie 轮换竞态/服务端重启导致签名失效 → 重取 csrf-token 后重试
    // 循环允许 403→401 等组合（如服务端重启后两类凭证同时失效）
    let healed401 = false;
    let healed403 = false;
    for (;;) {
      if (response.status === 401 && !healed401) {
        healed401 = true;
        const refreshed = await useAuthStore().refreshAccessToken();
        if (!refreshed) break;
        response = await sendRequest();
        continue;
      }
      if (response.status === 403 && !healed403) {
        let errMsg = '';
        try {
          errMsg = (await response.clone().json())?.message || '';
        } catch (_) {
          /* 非 JSON 响应忽略 */
        }
        if (!errMsg.includes('CSRF')) break;
        healed403 = true;
        await fetch('/api/auth/csrf-token', { credentials: 'include' });
        response = await sendRequest();
        continue;
      }
      break;
    }
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
      // 用户主动取消与兜底超时均表现为 AbortError，按外部信号区分
      if (options.signal?.aborted) {
        const cancelErr = new Error('排课已取消', { cause: fetchErr });
        cancelErr.cancelled = true;
        throw cancelErr;
      }
      throw new Error('排课请求超时，请稍后重试', { cause: fetchErr });
    }
    throw fetchErr;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    let msg = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      msg = errBody.message || msg;
    } catch (_) {
      /* 非 JSON 响应忽略 */
    }
    throw new Error(msg);
  }

  try {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 事件以空行分隔
      const events = buffer.split('\n\n');
      buffer = events.pop(); // 保留最后可能不完整的片段

      for (const eventStr of events) {
        if (!eventStr.trim()) continue;
        const lines = eventStr.split('\n');
        let eventType = 'message';
        let eventData = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) eventData = line.slice(6);
        }
        if (!eventData) continue;

        const parsed = JSON.parse(eventData);
        if (eventType === 'progress') {
          onProgress?.(parsed);
        } else if (eventType === 'complete') {
          finalResult = parsed;
        } else if (eventType === 'error') {
          throw new Error(parsed.message || '排课失败');
        }
      }
    }

    if (!finalResult) {
      throw new Error('排课响应异常：未收到完成事件');
    }
    return finalResult;
  } finally {
    // FR3修复：clearTimeout 覆盖整个 SSE 流读取周期，包括 reader.read() 循环
    clearTimeout(timeoutId);
  }
}

/**
 * 教学安排 - 班级课程数据
 * @param {import('./types').TeachingArrangeParams} params
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCourseClasses = (params) => request.get('/teaching-arrange/classes', { params });

/**
 * 教学安排 - 教师列表
 * @param {import('./types').TeachingArrangeParams} params
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getCourseTeachers = (params) => request.get('/teaching-arrange/teachers', { params });

/**
 * 教学安排 - 全部课程概览（每门课程的班级数/已安排/已锁定/课时汇总）
 * @param {{semester: string}} params
 * @returns {Promise<import('./types').ApiResponse<import('./types').CourseOverviewItem[]>>}
 */
export const getCourseOverview = (params) =>
  request.get('/teaching-arrange/course-overview', { params });

/**
 * 手动安排教师
 * @param {import('./types').AssignTeacherInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const assignTeacher = (data) => request.post('/teaching-arrange/assign', data);

/**
 * 对比同科目两位教师在本学期的任课班级（逐班清单 + 课时汇总）
 * @param {object} params - { courseId, semester, teacherIdA, teacherIdB }
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const compareTeacherAssignments = (params) =>
  request.get('/teaching-arrange/compare-teachers', { params });

/**
 * 按名单互换两位教师在同课程同学期的指定班级
 * 合班成员班整组联动；锁定班级跳过并在返回中报告；单教材开关冲突时后端 400 拦截
 * @param {object} data - { courseId, semester, teacherIdA, teacherIdB, classIdsA, classIdsB }
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const swapSelectiveClasses = (data) =>
  request.post('/teaching-arrange/swap-teachers-selective', data);

/**
 * 删除教学安排
 * @param {number} id - 教学安排 ID
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteAssignment = (id) => request.delete(`/teaching-arrange/assignments/${id}`);

/**
 * 自动排课（单课程）- SSE 流式版本
 * 通过 fetch + ReadableStream 读取后端推送的五阶段进度事件
 * @param {import('./types').AutoArrangeInput} data
 * @param {(progress: {phase: number, phaseName: string, total: number}) => void} onProgress
 * @param {{signal?: AbortSignal}} [options] - 可选取消信号等配置
 * @returns {Promise<{success: boolean, data: object, message: string}>}
 */
export const runAutoArrangeWithProgress = (data, onProgress, options) =>
  fetchArrangeSSE('/teaching-arrange/auto-arrange', data, onProgress, options);

/**
 * 批量自动排课 - SSE 流式版本
 * 通过 fetch + ReadableStream 读取后端推送的每门课程进度事件
 * @param {import('./types').BatchAutoArrangeInput} data
 * @param {(progress: {processed: number, total: number, currentCourseName: string, cumulativeAssigned: number, cumulativeUnassigned: number}) => void} onProgress
 * @param {{signal?: AbortSignal}} [options] - 可选取消信号等配置
 * @returns {Promise<{success: boolean, data: object, message: string}>}
 */
export const runBatchAutoArrangeWithProgress = (data, onProgress, options) =>
  fetchArrangeSSE('/teaching-arrange/batch-auto-arrange', data, onProgress, options);

/**
 * 重置自动安排（清除指定学期的自动安排）
 * @param {Object} data
 * @param {string} data.semester - 学期标识
 * @param {number} [data.courseId] - 课程ID，不传则重置全部科目
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const resetAutoAssignments = (data) => request.post('/teaching-arrange/reset', data);

/**
 * 课时统计
 * @param {Object} params
 * @param {string} params.semester
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const getTeachingStatistics = (params) =>
  request.get('/teaching-arrange/statistics', { params });

/**
 * 获取课时要求设置
 * @param {import('./types').HourSettingsQuery} params
 * @returns {Promise<import('./types').ApiResponse<import('./types').HourSettings>>}
 */
export const getHourSettings = (params) =>
  request.get('/teaching-arrange/hour-settings', { params });

/**
 * 保存课时要求设置
 * @param {import('./types').HourSettingsInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const saveHourSettings = (data) => request.put('/teaching-arrange/hour-settings', data);

/**
 * 锁定/解锁单条教学安排
 * @param {number} id - 教学安排 ID
 * @param {boolean} locked - 是否锁定
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const toggleAssignmentLock = (id, locked) =>
  request.patch(`/teaching-arrange/assignments/${id}/lock`, { locked });

/**
 * 批量锁定/解锁教学安排
 * @param {Object} data
 * @param {string} data.semester - 学期
 * @param {number} [data.courseId] - 课程ID，不传则操作全部科目
 * @param {boolean} data.locked - 是否锁定
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const batchLockAssignments = (data) => request.post('/teaching-arrange/lock-batch', data);

/**
 * 排课优化（预览模式）- SSE 流式版本
 * 对当前学期所有已排课的教师进行全局优化，返回优化前后对比
 * @param {Object} data
 * @param {string} data.semester - 学期
 * @param {string} [data.mode='standard'] - 排课模式 'standard' | 'full'
 * @param {(progress: {phase: string, message: string, percent: number}) => void} onProgress
 * @returns {Promise<{success: boolean, data: object, message: string}>}
 */
export const runOptimizeScheduleWithProgress = (data, onProgress) =>
  fetchArrangeSSE('/teaching-arrange/optimize-schedule', data, onProgress);

/**
 * 应用优化结果
 * 将预览阶段确认的优化方案写入数据库
 * @param {Object} data
 * @param {string} data.semester - 学期
 * @param {Array} data.changes - 变更列表
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const applyOptimizeResult = (data) => request.post('/teaching-arrange/apply-optimize', data);
