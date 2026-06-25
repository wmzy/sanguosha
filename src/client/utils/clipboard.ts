// src/client/utils/clipboard.ts
// 复制文本到剪贴板的安全 fallback 包装器。
// navigator.clipboard 仅在安全上下文(HTTPS / localhost)可用,通过局域网 IP 访问时为 undefined。
// 提供 document.execCommand('copy') 兜底:创建临时 textarea 选中后执行复制,完成后移除。
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. 安全上下文优先走 Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 某些浏览器即使存在 clipboard API 也可能拒绝(权限/焦点),继续 fallback
    }
  }

  // 2. fallback:临时 textarea + execCommand('copy')
  if (typeof document.execCommand === 'function') {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      // 放到屏幕外,避免焦点跳动
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.setAttribute('readonly', '');
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }

  // 3. 两条路都不通(罕见,如非浏览器环境)
  return false;
}
