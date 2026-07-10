import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import request from '../utils/request';
import { useAuthStore } from '../stores/auth';
import { getCookie } from '../utils/cookies';

/**
 * 导入结果通知卡片（右下角浮层）
 * 自管理挂载，避免被全局 .el-dialog 样式污染
 */
let importResultContainer = null;
function getImportResultContainer() {
  if (!importResultContainer) {
    importResultContainer = document.createElement('div');
    importResultContainer.id = 'import-result-toast-container';
    importResultContainer.style.cssText =
      'position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:12px;pointer-events:none;';
    document.body.appendChild(importResultContainer);
  }
  return importResultContainer;
}

/**
 * 显示一个导入结果通知卡片（导出供页面直接调用）
 * 颜色全部引用 design token，跟随主题切换
 */
export function showImportResultCard({
  title,
  type,
  total,
  imported,
  overwritten,
  failed,
  errors,
}) {
  const container = getImportResultContainer();

  // 通过 CSS 变量引用令牌，避免硬编码色值
  const typeVar = type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'danger';
  const c = {
    primary: `var(--brand-${typeVar})`,
    bg: `var(--brand-${typeVar}-soft)`,
  };

  // 错误列表（最多 5 条，可展开/折叠）
  const MAX_PREVIEW = 5;
  const errorList = Array.isArray(errors) ? errors : [];
  const previewErrors = errorList.slice(0, MAX_PREVIEW);
  const hiddenCount = errorList.length - previewErrors.length;

  // 构建卡片 DOM
  const card = document.createElement('div');
  card.style.cssText = `pointer-events:auto;width:360px;background:var(--bg-card);border-radius:var(--radius-sm);box-shadow:var(--shadow-md);overflow:hidden;border-left:4px solid ${c.primary};animation:importToastSlideIn 0.3s ease;`;

  // 头部：图标 + 标题 + 关闭按钮
  const header = document.createElement('div');
  header.style.cssText = `display:flex;align-items:center;gap:8px;padding:12px 16px;background:${c.bg};border-bottom:1px solid var(--border-light);`;
  const iconChar = type === 'success' ? '✓' : type === 'warning' ? '!' : '✗';
  header.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:${c.primary};color:#fff;font-size:12px;font-weight:bold;flex-shrink:0;">${iconChar}</span><span style="font-weight:600;color:var(--text-primary);font-size:14px;flex:1;">${title}</span><span style="cursor:pointer;color:var(--text-secondary);font-size:18px;line-height:1;padding:0 4px;" title="关闭">×</span>`;
  const closeBtn = header.querySelector('span:last-child');
  card.appendChild(header);

  // 统计区：紧凑横向卡片
  const statsBox = document.createElement('div');
  statsBox.style.cssText = 'display:flex;padding:12px 16px 8px;gap:6px;';
  const stats = [
    { label: '总计', value: total, color: 'var(--text-secondary)' },
    { label: '新增', value: imported, color: 'var(--brand-success)' },
    { label: '覆盖', value: overwritten, color: 'var(--brand-primary)' },
    { label: '失败', value: failed, color: 'var(--brand-danger)' },
  ];
  statsBox.innerHTML = stats
    .map(
      (
        s
      ) => `<div style="flex:1;text-align:center;padding:6px 0;background:var(--bg-subtle);border-radius:4px;">
      <div style="font-size:16px;font-weight:600;color:${s.color};line-height:1.2;">${s.value}</div>
      <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${s.label}</div>
    </div>`
    )
    .join('');
  card.appendChild(statsBox);

  // 错误详情区（可展开）
  if (errorList.length > 0) {
    const errSection = document.createElement('div');
    errSection.style.cssText = 'padding:0 16px 12px;';

    const errHeader = document.createElement('div');
    errHeader.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;cursor:pointer;padding:6px 0;color:var(--brand-danger-text);font-size:13px;font-weight:500;';
    errHeader.innerHTML = `<span><span style="margin-right:4px;">✗</span>失败详情（${errorList.length}）<span style="margin-left:4px;color:var(--text-secondary);font-weight:400;font-size:12px;">点击展开</span></span><span style="transition:transform 0.2s;">▼</span>`;
    const arrow = errHeader.querySelector('span:last-child');

    const errList = document.createElement('div');
    errList.style.cssText =
      'max-height:0;overflow:hidden;transition:max-height 0.25s ease;margin-top:0;';
    errList.innerHTML = `<div style="max-height:200px;overflow-y:auto;padding:8px 10px;background:var(--bg-subtle);border-radius:4px;border:1px solid var(--border-light);margin-top:6px;">${previewErrors
      .map(
        (err, i) =>
          `<div style="font-size:12px;color:var(--text-regular);padding:3px 0;border-bottom:1px dashed var(--border-light);display:flex;gap:6px;"><span style="color:var(--text-placeholder);flex-shrink:0;min-width:20px;">${i + 1}.</span><span style="flex:1;word-break:break-all;">${String(err).replace(/</g, '&lt;')}</span></div>`
      )
      .join('')}${
      hiddenCount > 0
        ? `<div style="font-size:12px;color:var(--text-secondary);padding:6px 0 2px;text-align:center;">... 还有 ${hiddenCount} 条未展示</div>`
        : ''
    }</div>`;

    let expanded = false;
    errHeader.addEventListener('click', () => {
      expanded = !expanded;
      errList.style.maxHeight = expanded ? '300px' : '0';
      errList.style.marginTop = expanded ? '0' : '0';
      arrow.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0)';
      const hint = errHeader.querySelector('span:first-child span:last-child');
      if (hint) hint.textContent = expanded ? '点击收起' : '点击展开';
    });

    errSection.appendChild(errHeader);
    errSection.appendChild(errList);
    card.appendChild(errSection);
  }

  // 底部操作栏：关闭
  const footer = document.createElement('div');
  footer.style.cssText =
    'display:flex;justify-content:flex-end;gap:8px;padding:8px 16px 12px;border-top:1px solid var(--border-light);';
  const closeBtn2 = document.createElement('button');
  closeBtn2.textContent = '关闭';
  closeBtn2.style.cssText =
    'padding:4px 12px;font-size:13px;border:1px solid var(--border-base);background:var(--bg-card);color:var(--text-regular);border-radius:4px;cursor:pointer;';
  closeBtn2.addEventListener('mouseenter', () => (closeBtn2.style.borderColor = c.primary));
  closeBtn2.addEventListener(
    'mouseleave',
    () => (closeBtn2.style.borderColor = 'var(--border-base)')
  );
  footer.appendChild(closeBtn2);
  card.appendChild(footer);

  container.appendChild(card);

  // 关闭函数
  const dismiss = () => {
    card.style.transition = 'opacity 0.25s, transform 0.25s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    setTimeout(() => card.remove(), 250);
  };
  closeBtn.addEventListener('click', dismiss);
  closeBtn2.addEventListener('click', dismiss);

  // 自动消失（成功 6s，部分失败 10s，全失败 不自动消失）
  const duration = type === 'success' ? 6000 : type === 'warning' ? 10000 : 0;
  if (duration > 0) setTimeout(dismiss, duration);

  // 添加滑入动画 keyframes（只添加一次）
  if (!document.getElementById('import-toast-keyframes')) {
    const style = document.createElement('style');
    style.id = 'import-toast-keyframes';
    style.textContent =
      '@keyframes importToastSlideIn{from{opacity:0;transform:translateX(20px);}to{opacity:1;transform:translateX(0);}}';
    document.head.appendChild(style);
  }
}

/**
 * 导入进度浮层（全屏遮罩 + 居中卡片 + 取消按钮）
 * 在 confirmImport 开始时显示，完成或取消时隐藏
 */
let _progressOverlay = null;

function showImportProgressOverlay(onCancel) {
  hideImportProgressOverlay(); // 防止重复

  // 注入动画（只添加一次）
  if (!document.getElementById('import-progress-keyframes')) {
    const style = document.createElement('style');
    style.id = 'import-progress-keyframes';
    style.textContent = `
      @keyframes importPulseDot {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1); }
      }
      @keyframes importOverlayFadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  // 全屏遮罩
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,0.45);animation:importOverlayFadeIn 0.2s ease;';

  // 居中卡片
  const card = document.createElement('div');
  card.style.cssText =
    'background:var(--bg-card, #fff);border-radius:12px;padding:32px 40px;text-align:center;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.18);min-width:260px;';

  // 跳动圆点动画
  const dots = document.createElement('div');
  dots.style.cssText = 'display:flex;justify-content:center;gap:6px;margin-bottom:16px;';
  for (let i = 0; i < 3; i++) {
    const dot = document.createElement('span');
    dot.style.cssText =
      `width:10px;height:10px;border-radius:50%;background:var(--brand-primary, #1C82F5);` +
      `animation:importPulseDot 1.4s infinite ease-in-out both;animation-delay:${i * 0.16}s;`;
    dots.appendChild(dot);
  }
  card.appendChild(dots);

  // 提示文字
  const text = document.createElement('div');
  text.textContent = '正在导入...';
  text.style.cssText =
    'font-size:15px;font-weight:500;color:var(--text-primary, #1e293b);margin-bottom:20px;';
  card.appendChild(text);

  // 取消按钮
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消导入';
  cancelBtn.style.cssText =
    'padding:8px 24px;font-size:13px;border-radius:6px;cursor:pointer;transition:all 0.2s;' +
    'border:1px solid var(--border-base, #cbd5e1);background:var(--bg-card, #fff);color:var(--text-regular, #475569);';
  cancelBtn.addEventListener('mouseenter', () => {
    cancelBtn.style.borderColor = 'var(--brand-danger, #F87171)';
    cancelBtn.style.color = 'var(--brand-danger, #F87171)';
  });
  cancelBtn.addEventListener('mouseleave', () => {
    cancelBtn.style.borderColor = 'var(--border-base, #cbd5e1)';
    cancelBtn.style.color = 'var(--text-regular, #475569)';
  });
  cancelBtn.addEventListener('click', () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = '正在取消...';
    cancelBtn.style.cursor = 'not-allowed';
    cancelBtn.style.opacity = '0.6';
    if (onCancel) onCancel();
  });
  card.appendChild(cancelBtn);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  _progressOverlay = overlay;
}

function hideImportProgressOverlay() {
  if (_progressOverlay) {
    const el = _progressOverlay;
    _progressOverlay = null;
    el.style.transition = 'opacity 0.2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }
}

/**
 * 通用导入 Composable
 * 封装 Excel 导入的完整流程：文件校验 → 确认弹窗 → 上传 → 结果反馈
 * @param {string} endpoint - 导入 API 路径（如 '/import/teachers'）
 * @param {string} confirmMessage - 确认弹窗提示文字
 * @param {Function} onSuccess - 导入成功后的回调（通常是 load() 或 silentReload()）
 * @returns {object} { pendingFile, uploadHeaders, beforeImport, onImportSuccess, onImportError }
 */
export function useImport(endpoint, confirmMessage, onSuccess) {
  const pendingFile = ref(null);
  const importConfirmVisible = ref(false);
  const importing = ref(false);

  // F-13: AbortController for import cancellation
  let abortController = null;

  const uploadHeaders = computed(() => {
    const authStore = useAuthStore();
    const headers = {};
    if (authStore.token) headers.Authorization = `Bearer ${authStore.token}`;
    const csrfToken = getCookie('XSRF-TOKEN');
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    return headers;
  });

  async function beforeImport(file) {
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
    if (!isExcel) {
      ElMessage.error('请上传Excel文件');
      return false;
    }
    // M-7 修复：前端文件大小校验（10MB），与生产环境 Nginx client_max_body_size 一致
    // 避免开发环境测试通过但生产环境返回 413 Request Entity Too Large
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      ElMessage.error(`文件大小 ${(file.size / 1024 / 1024).toFixed(1)}MB 超过限制（最大 10MB）`);
      return false;
    }
    pendingFile.value = file;
    importConfirmVisible.value = true;
    return false;
  }

  async function confirmImport() {
    importConfirmVisible.value = false;
    importing.value = true;
    abortController = new AbortController();
    showImportProgressOverlay(() => cancelImport());
    try {
      const formData = new FormData();
      formData.append('file', pendingFile.value);
      const response = await request.post(endpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        signal: abortController.signal,
      });
      onImportSuccess(response);
    } catch (err) {
      if (abortController.signal.aborted) return; // User cancelled
      onImportError(err);
    } finally {
      hideImportProgressOverlay();
      pendingFile.value = null;
      importing.value = false;
      abortController = null;
    }
  }

  function cancelImport() {
    importConfirmVisible.value = false;
    pendingFile.value = null;
    hideImportProgressOverlay();
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  /**
   * 导入成功回调。
   * 兼容两种调用方式：
   * 1. confirmImport 通过 axios 调用，拦截器返回 res = {success, message, data}
   * 2. el-upload 直传（不走 axios），:on-success 回调收到裸 response body = {success, message, data}
   * 两种情况下 res 都已包含 {success, message, data}，直接读取即可。
   */
  function onImportSuccess(res) {
    const data = res?.data || {};
    const total = Number(data.total) || 0;
    const imported = Number(data.imported) || 0;
    const overwritten = Number(data.overwritten) || 0;
    const failed = Number(data.failed) || 0;
    const errors = Array.isArray(data.errors) ? data.errors : [];
    const succeeded = imported + overwritten;

    // 判定结果类型
    let type = 'success';
    if (succeeded === 0 && failed > 0) type = 'error';
    else if (failed > 0) type = 'warning';

    const titleMap = {
      success: '导入成功',
      warning: '导入完成（部分失败）',
      error: '导入失败',
    };

    showImportResultCard({
      title: titleMap[type],
      type,
      total,
      imported,
      overwritten,
      failed,
      errors,
    });

    if (typeof onSuccess === 'function') onSuccess();
  }

  function onImportError(err) {
    if (import.meta.env.DEV) {
      console.error('导入错误:', err);
    }
    ElMessage.error('导入失败，请检查文件格式或联系管理员');
  }

  return {
    pendingFile,
    uploadHeaders,
    beforeImport,
    onImportSuccess,
    onImportError,
    // 新增：用于页面自定义弹窗
    importConfirmVisible,
    confirmMessage,
    importing,
    confirmImport,
    cancelImport,
  };
}
