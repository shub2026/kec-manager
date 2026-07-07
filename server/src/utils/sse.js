/**
 * SSE（Server-Sent Events）工具
 *
 * 用于排课等长耗时操作的实时进度推送。
 * 前端通过 fetch + ReadableStream 读取事件流（POST 请求不支持 EventSource）。
 *
 * 事件格式（RFC 8895）：
 *   event: <eventType>\n
 *   data: <JSON string>\n
 *   \n\n
 */

/**
 * 初始化 SSE 响应
 * 设置响应头并禁用 Nagle 算法与代理缓冲，确保事件即时推送
 * @param {import('express').Response} res
 */
export function initSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx 禁用缓冲，确保事件即时推送
    'X-Accel-Buffering': 'no',
  });
  // 关闭 Nagle 算法，减少小数据包延迟
  if (res.socket) {
    res.socket.setTimeout(0);
    res.socket.setNoDelay(true);
  }
}

/**
 * 推送一个 SSE 事件
 * @param {import('express').Response} res
 * @param {string} event - 事件类型（如 progress / complete / error）
 * @param {object} data - 要序列化为 JSON 的数据
 */
export function sendSSEEvent(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 判断请求是否要求 SSE 流式响应
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isSSERequest(req) {
  return req.headers.accept?.includes('text/event-stream');
}
