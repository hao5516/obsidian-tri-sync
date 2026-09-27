import { Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { encode, hash, Local, safePath, State, synchronize } from './core';
import { buffer, createStore, defaults, Settings } from './stores';
import { CopiesModal, SyncPanel, SyncSettings } from './ui';
import { configurationError, errorMessage, progressLabel } from './presentation';
import type { Progress, SyncReport } from './presentation';

interface Data { settings: Settings; states: Record<string, State>; reports: Record<string, SyncReport>; }
export default class TriSync extends Plugin {
  data!: Data; busy=false; stopped=false; status!: HTMLElement;
  operation: 'sync' | 'test' | null = null;
  progress?: Progress;
  private listeners = new Set<() => void>();
  private automaticError = '';
  get config() { return this.data.settings; }
  get report() { return this.data.reports[this.identity(this.config)]; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  async saveSettings(settings: Settings) {
    if (this.busy) throw new Error('请等待同步完成后再保存连接。');
    const error = configurationError(settings); if (error) throw new Error(error);
    const previous = this.data.settings;
    this.data.settings = { ...settings };
    try { await this.persist(); } catch (e) { this.data.settings = previous; throw e; }
    this.emit();
  }
  openCopies() {
    if (!this.app.vault.getFiles().some(file => file.path.startsWith('_TriSync/'))) { new Notice('还没有备份或冲突副本'); return; }
    new CopiesModal(this.app).open();
  }
  async onload() {
    const saved=await this.loadData() as Partial<Data> | null;
    this.data={settings:{...defaults,...saved?.settings},states:saved?.states ?? {},reports:saved?.reports ?? {}};
    this.status=this.addStatusBarItem(); this.status.setText('三端同步：就绪');
    this.addRibbonIcon('cloud','打开同步面板',()=>new SyncPanel(this.app,this).open());
    this.addCommand({id:'open-panel',name:'打开同步面板',callback:()=>new SyncPanel(this.app,this).open()});
    this.addCommand({id:'sync-now',name:'立即同步',callback:()=>void this.sync()});
    this.addCommand({id:'test-connection',name:'测试连接',callback:()=>{void this.testConnection().then(message=>new Notice(message)).catch(error=>new Notice(errorMessage(error,this.config)));}});
    this.addSettingTab(new SyncSettings(this.app,this,this));
    let elapsed=0;
    this.registerInterval(window.setInterval(()=>{
      elapsed+=10;
      if (this.data.settings.auto && !configurationError(this.config) && elapsed>=Math.max(60,this.data.settings.interval)) {
        elapsed=0; void this.sync(false);
      }
    },10000));
    this.app.workspace.onLayoutReady(()=>{if(this.data.settings.auto && !configurationError(this.config)) void this.sync(false);});
  }
  onunload() { this.stopped=true; this.listeners.clear(); }
  persist() { return this.saveData(this.data); }
  identity(s:Settings) {
    return hash(encode(JSON.stringify([s.provider,s.endpoint.replace(/\/$/,''),s.folder,s.username,s.baiduFolder])));
  }
  async parents(path:string) {
    const parts=path.split('/'); parts.pop(); let folder='';
    for(const part of parts) {
      if(this.stopped) throw new Error('插件已停用');
      folder=folder ? folder+'/'+part : part;
      if(!this.app.vault.getAbstractFileByPath(folder)) {
        try { await this.app.vault.createFolder(folder); }
        catch(error) { if(!this.app.vault.getAbstractFileByPath(folder)) throw error; }
      }
    }
  }
  local():Local {
    const vault=this.app.vault;
    const read=async(path:string)=>{
      if(this.stopped) throw new Error('插件已停用');
      if(path===vault.configDir || path.startsWith(vault.configDir+'/')) throw new Error('禁止同步配置目录');
      const f=vault.getAbstractFileByPath(path);
      if(f && !(f instanceof TFile)) throw new Error(`文件与文件夹重名：${path}`);
      return f instanceof TFile ? new Uint8Array(await vault.readBinary(f)) : null;
    };
    return {
      list:async()=>vault.getFiles().map(f=>f.path).filter(p=>safePath(p) && p!==vault.configDir && !p.startsWith(vault.configDir+'/')),
      read,
      preserve:async(path,bytes)=>{
        if(this.stopped) throw new Error('插件已停用');
        const existing=await read(path);
        if(existing) {
          if(hash(existing)!==hash(bytes)) throw new Error('备份文件已被修改，请移走该备份后重试');
          return;
        }
        await this.parents(path); await vault.createBinary(normalizePath(path),buffer(bytes));
      },
      replace:async(path,bytes,expected)=>{
        if(this.stopped) throw new Error('插件已停用');
        // Remote paths must never target the active configuration directory.
        if(path===vault.configDir || path.startsWith(vault.configDir+'/')) throw new Error('禁止同步配置目录');
        const f=vault.getAbstractFileByPath(path);
        if(!f) {
          if(expected!==null) return false;
          await this.parents(path);
          if(vault.getAbstractFileByPath(path)) return false;
          await vault.createBinary(normalizePath(path),buffer(bytes)); return true;
        }
        if(!(f instanceof TFile) || expected===null) return false;
        if(['md','txt','canvas','json','csv','css','js','ts','html','xml','svg','yaml','yml'].includes(f.extension.toLowerCase())) {
          let content:string;
          try { content=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
          catch { throw new Error(`文件不是有效 UTF-8：${path}`); }
          let replaced=false;
          await vault.process(f,current=>{
            if(hash(encode(current))!==expected || this.stopped) return current;
            replaced=true; return content;
          });
          return replaced;
        }
        // Obsidian exposes no atomic compare-and-swap for binary files. Keep the
        // incoming update separately, so an external editor's write cannot be lost.
        const copy=`_TriSync/incoming/${hash(bytes)}/${path}`;
        if(!await read(copy)) { await this.parents(copy); await vault.createBinary(copy,buffer(bytes)); }
        return false;
      }
    };
  }
  async testConnection(settings: Settings = this.config): Promise<string> {
    if(this.busy || this.stopped) throw new Error('请等待当前操作完成后再测试连接。');
    const s = { ...settings }; const error = configurationError(s); if (error) throw new Error(error);
    this.busy=true; this.operation='test'; this.progress=undefined; this.emit();
    try {
      const store=createStore(s); await store.init(); await store.list();
      return '连接成功，可以访问同步文件夹。文件写入权限会在首次同步时验证。';
    } finally { this.busy=false; this.operation=null; this.emit(); }
  }
  async sync(manual=true) {
    if(this.busy || this.stopped) { if(manual) new Notice('同步正在进行或插件已停用'); return; }
    const validation = configurationError(this.config);
    if (validation) { if (manual) { new Notice(validation); new SyncPanel(this.app,this).open(); } return; }
    const s={...this.data.settings}; const key=this.identity(s);
    this.busy=true; this.operation='sync'; this.progress=undefined; this.status.setText('三端同步：进行中'); this.emit();
    try {
      const state=this.data.states[key] ?? (this.data.states[key]={});
      let lastPaint=0;
      const r=await synchronize(createStore(s),this.local(),state,()=>this.persist(),Math.max(1,Math.min(100,s.maxMB))*1024*1024,()=>{
        if(this.stopped) throw new Error('插件已停用');
      },progress=>{
        this.progress=progress;
        if(Date.now()-lastPaint>=150) {lastPaint=Date.now();this.status.setText(progressLabel(progress));this.emit();}
      });
      this.data.reports[key]={at:Date.now(),result:r}; await this.persist(); this.automaticError='';
      const message=`上传 ${r.uploaded}，下载 ${r.downloaded}，冲突 ${r.conflicts}，跳过 ${r.skipped}`;
      this.status.setText(`三端同步：${message}`);
      if(manual || r.conflicts || r.skipped) new Notice(message,8000);
    } catch(e) {
      if(this.stopped) return;
      const message=errorMessage(e,s);
      this.data.reports[key]={at:Date.now(),error:message};
      try { await this.persist(); } catch { /* Surface the original failure even if local settings storage is unavailable. */ }
      this.status.setText('三端同步：失败');
      if(manual || this.automaticError!==message) new Notice(`同步停止：${message}`,10000);
      if(!manual) this.automaticError=message;
    } finally { this.busy=false; this.operation=null; this.progress=undefined; this.emit(); }
  }
}
