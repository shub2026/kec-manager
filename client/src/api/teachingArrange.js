import request, { buildAuthHeaders } from '../utils/request';
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
 * @param {{timeout?: number}} [options] - 超时等配置
 * @returns {Promise<{success: boolean, data: object, message: string}>} 最终结果
 */
async function fetchArrangeSSE(url, body, onProgress, options = {}) {
  // 复用拦截器同源的认证头构造，避免认证逻辑漂移
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    ...buildAuthHeaders(),
  };

  // SSE 流式响应不设 HTTP 超时（后端 batch.js 自带 5 分钟业务超时）
  // 但设置一个兜底超时避免无限等待
  const controller = new AbortController();
  const timeoutMs = options.timeout || 7 * 60 * 1000; // 7 分钟，略大于后端上限
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`/api${url}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
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
 * 手动安排教师
 * @param {import('./types').AssignTeacherInput} data
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const assignTeacher = (data) => request.post('/teaching-arrange/assign', data);

/**
 * 删除教学安排
 * @param {number} id - 教学安排 ID
 * @returns {Promise<import('./types').ApiResponse<void>>}
 */
export const deleteAssignment = (id) => request.delete(`/teaching-arrange/assignments/${id}`);

/**
 * 自动排课（单课程）
 * P0 修复：排课可能耗时较长（禁忌搜索+置换回溯），单独设置 6 分钟超时
 * 略大于后端批量排课 5 分钟上限，避免前端超时但后端仍在写入
 * @param {import('./types').AutoArrangeInput} data
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const runAutoArrange = (data) =>
  request.post('/teaching-arrange/auto-arrange', data, { timeout: 6 * 60 * 1000 });

/**
 * 批量自动排课（所有课程）
 * P0 修复：同上，单独设置 6 分钟超时
 * @param {import('./types').BatchAutoArrangeInput} data
 * @returns {Promise<import('./types').ApiResponse<Object>>}
 */
export const runBatchAutoArrange = (data) =>
  request.post('/teaching-arrange/batch-auto-arrange', data, { timeout: 6 * 60 * 1000 });

/**
 * 自动排课（单课程）- SSE 流式版本
 * 通过 fetch + ReadableStream 读取后端推送的五阶段进度事件
 * @param {import('./types').AutoArrangeInput} data
 * @param {(progress: {phase: number, phaseName: string, total: number}) => void} onProgress
 * @returns {Promise<{success: boolean, data: object, message: string}>}
 */
export const runAutoArrangeWithProgress = (data, onProgress) =>
  fetchArrangeSSE('/teaching-arrange/auto-arrange', data, onProgress);

/**
 * 批量自动排课 - SSE 流式版本
 * 通过 fetch + ReadableStream 读取后端推送的每门课程进度事件
 * @param {import('./types').BatchAutoArrangeInput} data
 * @param {(progress: {processed: number, total: number, currentCourseName: string, cumulativeAssigned: number, cumulativeUnassigned: number}) => void} onProgress
 * @returns {Promise<{success: boolean, data: object, message: string}>}
 */
export const runBatchAutoArrangeWithProgress = (data, onProgress) =>
  fetchArrangeSSE('/teaching-arrange/batch-auto-arrange', data, onProgress);

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
