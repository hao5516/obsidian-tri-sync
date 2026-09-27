import type { Result } from './core';
import type { Settings } from './stores';

export interface SyncReport { at: number; result?: Result; error?: string; }
export interface Progress { phase: 'connecting' | 'history' | 'files'; current: number; total: number; }
export const providerNames = { webdav: 'WebDAV', s3: 'S3 存储', baidu: '百度网盘' };

export function configurationError(s: Settings): string | null {
  if (!Number.isFinite(s.maxMB) || s.maxMB < 1 || s.maxMB > 100) return '文件大小上限需要在 1 到 100 MB 之间。';
  if (!Number.isFinite(s.interval) || s.interval < 60) return '同步间隔不能少于 60 秒。';
  if (s.provider === 'baidu') {
    if (!s.baiduToken.trim()) return '请填写百度网盘的授权令牌。';
    if (!/^\/apps\/[^/]+\/.+/.test(s.baiduFolder) || s.baiduFolder.includes('你的应用名')) return '请填写实际的应用目录，例如 /apps/应用名称/我的笔记。';
  } else {
    try {
      const url = new URL(s.endpoint);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '服务地址需要以 https:// 开头，不含账号、密码或查询参数。';
    } catch { return '请填写完整的服务地址，例如 https://dav.example.com/dav。'; }
    if (!s.folder.trim() || s.folder.split('/').some(p => p === '..' || p === '.')) return '请填写有效的同步文件夹名称。';
    if (s.provider === 's3' && (!s.accessKey.trim() || !s.secretKey || !s.region.trim())) return '请填写访问密钥、密钥密码和存储区域。';
  }
  return null;
}

export function errorMessage(error: unknown, settings: Settings): string {
  let text = error instanceof Error ? error.message : '发生未知错误，请重试。';
  for (const secret of [settings.password, settings.secretKey, settings.baiduToken, settings.accessKey]) {
    if (secret) text = text.split(secret).join('••••');
  }
  if (/HTTP 401|百度网盘错误 (110|111)/.test(text)) return '授权已失效。请更新应用密码或授权令牌，再测试连接。';
  if (/HTTP 403/.test(text)) return '没有访问权限。请检查账号是否允许读取、写入这个同步文件夹。';
  if (/HTTP 404/.test(text)) return '找不到同步位置。请检查服务地址、存储桶或应用目录。';
  if (/HTTP 429/.test(text)) return '请求过于频繁。请稍后再试，或延长自动同步间隔。';
  if (/网络请求失败|连接失败/.test(text)) return '暂时无法连接存储服务。请检查网络和服务地址，然后重试。';
  return text.slice(0, 300);
}

export function progressLabel(progress?: Progress): string {
  if (!progress || progress.phase === 'connecting') return '正在连接存储服务…';
  if (progress.phase === 'history') return `正在读取同步历史 ${progress.current} / ${progress.total}`;
  return `正在检查文件 ${progress.current} / ${progress.total}`;
}
