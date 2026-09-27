import { App, Modal, Notice, PluginSettingTab, Setting, FuzzySuggestModal, TFile, setIcon, requireApiVersion } from 'obsidian';
import type { Plugin } from 'obsidian';
import type { Settings } from './stores';
import { configurationError, errorMessage, progressLabel, providerNames } from './presentation';
import type { Progress, SyncReport } from './presentation';

export interface SyncHost {
  config: Settings; busy: boolean; operation: 'sync' | 'test' | null;
  report?: SyncReport; progress?: Progress;
  subscribe(listener: () => void): () => void;
  saveSettings(settings: Settings): Promise<void>;
  sync(manual?: boolean): Promise<void>;
  testConnection(settings?: Settings): Promise<string>;
  openCopies(): void;
}

function button(parent: HTMLElement, text: string, action: () => void, primary = false): HTMLButtonElement {
  const el = parent.createEl('button', { text, cls: primary ? 'mod-cta' : '', attr: { type: 'button' } });
  el.addEventListener('click', action);
  return el;
}

// This renderer is shared by the live modal, settings and visual smoke tests.
export function renderDashboard(el: HTMLElement, host: SyncHost, configure: () => void): void {
  el.empty(); el.addClass('tri-sync-panel');
  const configured = !configurationError(host.config);
  const report = host.report;
  const busy = host.busy;
  const needsAttention = !!report?.error || !!report?.result?.conflicts || !!report?.result?.skipped;
  const hero = el.createDiv({ cls: 'tri-sync-hero' });
  const logo = hero.createDiv({ cls: 'tri-sync-logo' }); setIcon(logo, 'cloud');
  const heading = hero.createDiv();
  heading.createDiv({ text: 'Tri Sync', cls: 'tri-sync-brand' });
  heading.createDiv({ text: '你的笔记，随处接续。', cls: 'tri-sync-muted' });
  const badge = hero.createDiv({ cls: 'tri-sync-badge', text: busy ? '处理中' : !configured ? '待配置' : needsAttention ? '需要查看' : '已配置' });
  if (needsAttention && !busy) badge.addClass('tri-sync-warning');
  const card = el.createDiv({ cls: 'tri-sync-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const title = busy ? (host.operation === 'test' ? '正在测试连接' : '正在同步笔记') : !configured ? '先连接你的存储服务' : report?.error ? '上次同步未完成' : report?.result ? '上次同步已完成' : '准备好开始同步';
  card.createDiv({ text: title, cls: 'tri-sync-status-title' });
  const subtitle = busy ? progressLabel(host.progress) : !configured ? '只需配置一次。其他设备填写相同的服务和文件夹。' : report?.error ?? (report ? new Date(report.at).toLocaleString() : '首次同步前，建议先测试连接。');
  card.createDiv({ text: subtitle, cls: 'tri-sync-muted' });
  if (busy) {
    const meter = card.createEl('progress', { cls: 'tri-sync-progress', attr: { 'aria-label': '同步进度' } });
    if (host.progress?.total) { meter.max = host.progress.total; meter.value = host.progress.current; }
  }
  if (!configured) {
    const steps = card.createDiv({ cls: 'tri-sync-steps' });
    for (const [index, text] of ['选择服务', '填写连接', '开始同步'].entries()) steps.createSpan({ text: `${index + 1}  ${text}` });
  }
  const actions = card.createDiv({ cls: 'tri-sync-actions' });
  const main = button(actions, busy ? '请稍候…' : configured ? '立即同步' : '开始配置', () => { if (configured) void host.sync(); else configure(); }, true);
  main.disabled = busy;
  if (configured) {
    button(actions, '连接设置', configure).disabled = busy;
    button(actions, '测试连接', () => { void host.testConnection().then(message => new Notice(message)).catch(error => new Notice(errorMessage(error, host.config))); }).disabled = busy;
  }
  if (report?.result) {
    const stats = el.createDiv({ cls: 'tri-sync-stats', attr: { 'aria-label': '上次同步统计' } });
    for (const [label, value] of [['上传', report.result.uploaded], ['下载', report.result.downloaded], ['冲突副本', report.result.conflicts], ['已跳过', report.result.skipped]]) {
      const stat = stats.createDiv({ cls: 'tri-sync-stat' });
      stat.createDiv({ text: String(value), cls: 'tri-sync-number' }); stat.createDiv({ text: String(label), cls: 'tri-sync-muted' });
    }
    if (report.result.issues?.length) {
      const details = el.createEl('details', { cls: 'tri-sync-details' });
      details.createEl('summary', { text: `查看需要处理的文件（${report.result.issues.length}${report.result.issues.length === 100 ? '+' : ''}）` });
      for (const item of report.result.issues) {
        const row = details.createDiv({ cls: 'tri-sync-issue' });
        row.createDiv({ text: item.path }); row.createDiv({ text: item.reason, cls: 'tri-sync-muted' });
      }
    }
  }
  const connection = el.createDiv({ cls: 'tri-sync-connection' });
  const meta = connection.createDiv();
  meta.createDiv({ text: configured ? providerNames[host.config.provider] : '尚未连接', cls: 'tri-sync-label' });
  meta.createDiv({ text: host.config.auto ? `每 ${Math.round(host.config.interval / 60)} 分钟自动同步 · 应用运行时` : '自动同步已关闭 · 手动同步', cls: 'tri-sync-muted' });
  button(connection, '查看备份与副本', () => host.openCopies());
  const note = el.createDiv({ cls: 'tri-sync-footnote' });
  setIcon(note.createSpan(), 'shield-check');
  note.createSpan({ text: '覆盖前保留备份；删除不会传到其他设备。' });
}

export class SyncPanel extends Modal {
  private unsubscribe?: () => void;
  constructor(app: App, private host: SyncHost) { super(app); }
  onOpen() {
    this.modalEl.addClass('tri-sync-modal'); this.setTitle('笔记同步');
    const draw = () => renderDashboard(this.contentEl, this.host, () => new ConnectionModal(this.app, this.host).open());
    draw(); this.unsubscribe = this.host.subscribe(draw);
  }
  onClose() { this.unsubscribe?.(); this.contentEl.empty(); }
}

export class ConnectionModal extends Modal {
  private draft: Settings;
  private pending = false;
  private message!: HTMLElement;
  private fields!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  private testButton!: HTMLButtonElement;
  constructor(app: App, private host: SyncHost) { super(app); this.draft = { ...host.config }; }
  onOpen() {
    this.modalEl.addClass('tri-sync-modal'); this.contentEl.addClass('tri-sync-config'); this.setTitle('连接你的存储服务');
    this.contentEl.createEl('p', { text: '三台设备选择同一服务，并使用同一个同步文件夹。', cls: 'tri-sync-muted' });
    const services = this.contentEl.createDiv({ cls: 'tri-sync-services', attr: { role: 'group', 'aria-label': '存储服务' } });
    for (const provider of ['webdav', 's3', 'baidu'] as const) {
      const card = button(services, providerNames[provider], () => {
        if (this.pending) return;
        this.draft.provider = provider;
        for (const child of Array.from(services.children)) child.setAttribute('aria-pressed', String(child === card));
        this.renderFields();
      });
      card.addClass('tri-sync-service'); card.setAttribute('aria-pressed', String(this.draft.provider === provider));
    }
    this.fields = this.contentEl.createDiv(); this.renderFields();
    this.message = this.contentEl.createDiv({ cls: 'tri-sync-feedback', attr: { role: 'status', 'aria-live': 'polite' } });
    const actions = this.contentEl.createDiv({ cls: 'tri-sync-actions' });
    this.testButton = button(actions, '测试连接', () => void this.test());
    this.saveButton = button(actions, '保存连接', () => void this.save(), true);
    button(actions, '取消', () => { if (!this.pending) this.close(); });
    this.contentEl.createEl('p', { cls: 'tri-sync-footnote', text: '授权信息仅保存在本机插件设置中，未加密。不要分享插件的 data.json 文件。' });
  }
  private renderFields() {
    this.fields.empty();
    if (this.message) this.message.setText('');
    const d = this.draft;
    type TextKey = 'endpoint' | 'folder' | 'username' | 'password' | 'accessKey' | 'secretKey' | 'region' | 'baiduToken' | 'baiduFolder';
    const field = (parent: HTMLElement, name: string, key: TextKey, placeholder: string, description: string, secret = false) => {
      const setting = new Setting(parent).setName(name).setDesc(description);
      setting.addText(input => {
        input.setValue(d[key]).setPlaceholder(placeholder); input.inputEl.setAttribute('aria-label', name);
        input.inputEl.autocomplete = 'off'; input.inputEl.spellcheck = false;
        if (secret) input.inputEl.type = 'password';
        input.onChange(value => { if (!this.pending) { d[key] = secret ? value : value.trim(); if (this.message) this.message.setText(''); } });
        if (secret) setting.addExtraButton(b => b.setIcon('eye').setTooltip('显示或隐藏密钥').onClick(() => { const show = input.inputEl.type === 'password'; input.inputEl.type = show ? 'text' : 'password'; b.setIcon(show ? 'eye-off' : 'eye'); }));
      });
    };
    if (d.provider === 'baidu') {
      this.fields.createDiv({ cls: 'tri-sync-callout', text: '实验性支持：需要百度开放平台授权，无法直接用网盘账号密码登录。令牌过期后需手动更新。' });
      field(this.fields, '授权令牌', 'baiduToken', 'Access token', '通过百度网盘开放平台获取。', true);
      field(this.fields, '应用内的同步文件夹', 'baiduFolder', '/apps/应用名称/我的笔记', '先在网盘中创建此目录，三端填写相同路径。');
    } else {
      field(this.fields, d.provider === 'webdav' ? '服务地址' : '存储桶地址', 'endpoint', d.provider === 'webdav' ? 'https://dav.example.com/dav' : 'https://bucket.s3.region.amazonaws.com', d.provider === 'webdav' ? '使用服务商提供的 WebDAV 地址。' : '填写包含桶名的 HTTPS 地址。');
      field(this.fields, '同步文件夹', 'folder', 'tri-sync/personal', '每个笔记库单独一个文件夹，三端保持一致。');
      if (d.provider === 'webdav') {
        field(this.fields, '账号', 'username', '你的账号', '使用服务商的 WebDAV 账号。');
        field(this.fields, '应用密码', 'password', '应用专用密码', '优先使用应用密码，而非账号登录密码。', true);
      } else {
        field(this.fields, '访问密钥', 'accessKey', 'Access key', '需要此同步目录的读取、写入和列举权限。');
        field(this.fields, '密钥密码', 'secretKey', 'Secret key', '由你的存储服务商提供。', true);
        field(this.fields, '存储区域', 'region', 'us-east-1', '按服务商要求填写，例如 us-east-1。');
      }
    }
    const advanced = this.fields.createEl('details', { cls: 'tri-sync-details' });
    advanced.createEl('summary', { text: '自动同步与高级选项' });
    new Setting(advanced).setName('自动同步').setDesc('仅在 Obsidian 运行时执行。').addToggle(t => t.setValue(d.auto).onChange(v => { if (!this.pending) d.auto = v; }));
    new Setting(advanced).setName('同步间隔').addDropdown(select => {
      const options: Record<string, string> = { '60': '每 1 分钟', '300': '每 5 分钟', '900': '每 15 分钟', '1800': '每 30 分钟' };
      if (!options[String(d.interval)]) options[String(d.interval)] = `每 ${d.interval} 秒`;
      select.addOptions(options).setValue(String(d.interval)).onChange(v => { if (!this.pending) d.interval = Number(v); });
    });
    new Setting(advanced).setName('单文件上限（MB）').setDesc('超过上限会跳过，可在同步结果中查看。').addText(t => t.setValue(String(d.maxMB)).onChange(v => { if (!this.pending) d.maxMB = Number(v); }));
  }
  private lock(value: boolean) {
    this.pending = value; this.testButton.disabled = value; this.saveButton.disabled = value;
    for (const el of Array.from(this.fields.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'))) el.disabled = value;
  }
  private async test() {
    const error = configurationError(this.draft); if (error) { this.message.setText(error); return; }
    this.lock(true); this.message.setText('正在连接，请稍候…');
    try { this.message.setText(await this.host.testConnection({ ...this.draft })); }
    catch (e) { this.message.setText(errorMessage(e, this.draft)); }
    finally { this.lock(false); }
  }
  private async save() {
    const error = configurationError(this.draft); if (error) { this.message.setText(error); return; }
    this.lock(true);
    try { await this.host.saveSettings({ ...this.draft }); this.close(); new Notice('连接已保存，可以开始同步'); }
    catch (e) { this.message.setText(errorMessage(e, this.draft)); }
    finally { this.lock(false); }
  }
  onClose() { this.contentEl.empty(); }
}

export class CopiesModal extends FuzzySuggestModal<TFile> {
  constructor(app: App) { super(app); this.setPlaceholder('搜索备份、冲突副本或待替换附件…'); }
  getItems() { return this.app.vault.getFiles().filter(file => file.path.startsWith('_TriSync/')).sort((a, b) => b.stat.mtime - a.stat.mtime); }
  getItemText(file: TFile) {
    const parts = file.path.split('/');
    const labels: Record<string, string> = { backups: '备份', conflicts: '冲突', incoming: '待替换附件' };
    return `[${labels[parts[1]] ?? '副本'}] ${parts.slice(3).join('/')} · ${new Date(file.stat.mtime).toLocaleString()}`;
  }
  onChooseItem(file: TFile) { void this.app.workspace.getLeaf(false).openFile(file); }
}

export class SyncSettings extends PluginSettingTab {
  private unsubscribe?: () => void;
  constructor(app: App, plugin: Plugin, private host: SyncHost) { super(app, plugin); }
  getSettingDefinitions() {
    return [{ name: '同步面板', desc: '同步状态、连接和备份。', aliases: ['WebDAV', 'S3', '百度网盘', '自动同步', '备份'], render: (setting: Setting) => {
      setting.settingEl.addClass('tri-sync-dashboard-setting');
      setting.infoEl.empty(); setting.controlEl.empty();
      const panel = setting.settingEl.createDiv();
      const draw = () => renderDashboard(panel, this.host, () => new ConnectionModal(this.app, this.host).open());
      draw(); this.unsubscribe?.(); const off = this.host.subscribe(draw); this.unsubscribe = off; return off;
    } }];
  }
  display() { this.containerEl.empty(); this.getSettingDefinitions()[0].render(new Setting(this.containerEl)); }
  hide() { this.unsubscribe?.(); this.unsubscribe = undefined; }
  refresh() { if (requireApiVersion('1.13.0')) this.update(); }
}
