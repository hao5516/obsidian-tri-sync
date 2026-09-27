import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configurationError, errorMessage, progressLabel } from '../src/presentation';
import type { Settings } from '../src/stores';

// TypeScript tests for stores use a bundled Obsidian mock; this test only needs
// plain settings values, so the fixture deliberately avoids a runtime API import.
const settings: Settings = { provider: 'webdav', endpoint: 'https://example.com/dav', folder: 'tri-sync', username: '', password: '', accessKey: '', secretKey: '', region: 'us-east-1', baiduToken: '', baiduFolder: '/apps/你的应用名/tri-sync', auto: false, interval: 300, maxMB: 20 };
test('配置检查提示缺失信息且允许既有 WebDAV 配置', () => {
  assert.equal(configurationError(settings), null);
  assert.match(configurationError({ ...settings, endpoint: '' })!, /服务地址/);
  assert.match(configurationError({ ...settings, endpoint: 'http://example.com' })!, /https/);
  assert.match(configurationError({ ...settings, provider: 's3' })!, /密钥/);
  assert.match(configurationError({ ...settings, provider: 'baidu', baiduToken: 'test' })!, /实际/);
  assert.match(configurationError({ ...settings, maxMB: Number.NaN })!, /大小/);
});
test('连接错误提供操作建议且不暴露凭据', () => {
  assert.match(errorMessage(new Error('HTTP 401'), settings), /授权/);
  assert.match(errorMessage(new Error('HTTP 429'), settings), /稍后/);
  assert.equal(errorMessage(new Error('bad secret value'), { ...settings, password: 'secret' }), 'bad •••• value');
});
test('进度文字区分连接、历史读取和文件检查', () => {
  assert.match(progressLabel(), /连接/);
  assert.match(progressLabel({ phase: 'history', current: 2, total: 10 }), /2 \/ 10/);
  assert.match(progressLabel({ phase: 'files', current: 3, total: 4 }), /文件 3 \/ 4/);
});
