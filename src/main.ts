import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath } from 'obsidian';
import { encode, hash, Local, safePath, State, synchronize } from './core';
import { buffer, createStore, defaults, Settings } from './stores';

interface Data { settings: Settings; states: Record<string, State>; }
export default class TriSync extends Plugin {
  data!: Data; busy=false; stopped=false; status!: HTMLElement;
  async onload() {
    const saved=await this.loadData() as Partial<Data> | null;
    this.data={settings:{...defaults,...saved?.settings},states:saved?.states ?? {}};
    this.status=this.addStatusBarItem(); this.status.setText('三端同步：就绪');
    this.addRibbonIcon('refresh-cw','立即同步',()=>void this.sync());
    this.addCommand({id:'sync-now',name:'立即同步',callback:()=>void this.sync()});
    this.addCommand({id:'test-connection',name:'测试连接',callback:()=>void this.testConnection()});
    this.addSettingTab(new SyncSettings(this.app,this));
    let elapsed=0;
    this.registerInterval(window.setInterval(()=>{
      elapsed+=10;
      if (this.data.settings.auto && elapsed>=Math.max(60,this.data.settings.interval)) {
        elapsed=0; void this.sync(false);
      }
    },10000));
    this.app.workspace.onLayoutReady(()=>{if(this.data.settings.auto) void this.sync(false);});
  }
  onunload() { this.stopped=true; }
  persist() { return this.saveData(this.data); }
  identity(s:Settings) {
    return hash(encode(JSON.stringify([s.provider,s.endpoint.replace(/\/$/,''),s.folder,s.username,s.baiduFolder])));
  }
  async parents(path:string) {
    const parts=path.split('/'); parts.pop(); let folder='';
    for(const part of parts) {
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
  async testConnection() {
    if(this.busy) { new Notice('同步正在进行'); return; }
    this.busy=true;
    try {
      const store=createStore({...this.data.settings}); await store.init();
      const keys=await store.list(); new Notice(`连接成功，发现 ${keys.length} 个远端对象（尚未测试写入）`);
    } catch(e) { new Notice(e instanceof Error ? e.message : '连接失败'); }
    finally { this.busy=false; }
  }
  async sync(manual=true) {
    if(this.busy || this.stopped) { if(manual) new Notice('同步正在进行或插件已停用'); return; }
    this.busy=true; this.status.setText('三端同步：进行中');
    try {
      const s={...this.data.settings}; const key=this.identity(s);
      const state=this.data.states[key] ?? (this.data.states[key]={});
      const r=await synchronize(createStore(s),this.local(),state,()=>this.persist(),Math.max(1,Math.min(100,s.maxMB))*1024*1024);
      const message=`上传 ${r.uploaded}，下载 ${r.downloaded}，冲突 ${r.conflicts}，跳过 ${r.skipped}`;
      this.status.setText(`三端同步：${message}`);
      if(manual || r.conflicts || r.skipped) new Notice(message,8000);
    } catch(e) {
      this.status.setText('三端同步：失败');
      new Notice(`同步停止：${e instanceof Error ? e.message : '未知错误'}`,10000);
    } finally { this.busy=false; }
  }
}
class SyncSettings extends PluginSettingTab {
  constructor(app:App,private plugin:TriSync) { super(app,plugin); }
  display() {
    const {containerEl:el}=this; el.empty(); const s=this.plugin.data.settings;
    el.createEl('h2',{text:'Tri Sync 三端同步'});
    el.createEl('p',{text:'三台设备选择同一服务、同一远端目录。首次使用请手动同步；自动同步仅在 Obsidian 运行时执行。'});
    new Setting(el).setName('同步服务').addDropdown(d=>d.addOption('webdav','WebDAV（坚果云 / NAS）').addOption('s3','S3 兼容存储').addOption('baidu','百度网盘（实验性）').setValue(s.provider).onChange(async v=>{if(this.plugin.busy) return; s.provider=v as Settings['provider'];await this.plugin.persist();this.display();}));
    const text=(name:string,key:keyof Settings,desc:string,secret=false)=>{
      new Setting(el).setName(name).setDesc(desc).addText(t=>{
        t.setValue(String(s[key])); if(secret) t.inputEl.type='password';
        t.onChange(async value=>{if(this.plugin.busy) return; (s as unknown as Record<string,unknown>)[key]=value.trim();await this.plugin.persist();});
      });
    };
    if(s.provider==='baidu') {
      text('Access token','baiduToken','通过百度网盘开放平台授权获取；过期后需要更新。',true);
      text('应用目录','baiduFolder','请先在网盘中建立 /apps/你的应用名/tri-sync；应用必须具有该目录的读写及下载权限。');
    } else {
      text('HTTPS 地址','endpoint',s.provider==='s3'?'桶根地址，例如 https://bucket.s3.ap-southeast-1.amazonaws.com 或 https://host/bucket':'WebDAV 根地址，例如 https://dav.example.com/dav');
      text('远端子目录','folder','每个笔记库使用独立目录，例如 tri-sync/personal');
      if(s.provider==='webdav') { text('用户名','username','WebDAV 账号');text('应用密码','password','使用服务商提供的应用密码。',true); }
      else { text('Region','region','例如 us-east-1；按服务商要求填写');text('Access key','accessKey','允许列举、读取和写入同步目录');text('Secret key','secretKey','S3 访问密钥',true); }
    }
    new Setting(el).setName('自动同步').setDesc('默认关闭；手机锁屏或应用被挂起时无法保证执行。').addToggle(t=>t.setValue(s.auto).onChange(async v=>{s.auto=v;await this.plugin.persist();}));
    new Setting(el).setName('同步间隔（秒）').addText(t=>t.setValue(String(s.interval)).onChange(async v=>{const n=Number(v);if(Number.isFinite(n)&&n>=60){s.interval=n;await this.plugin.persist();}}));
    new Setting(el).setName('单文件上限（MB）').setDesc('1–100 MB，默认 20 MB；过大文件跳过。').addText(t=>t.setValue(String(s.maxMB)).onChange(async v=>{const n=Number(v);if(Number.isFinite(n)&&n>=1&&n<=100){s.maxMB=n;await this.plugin.persist();}}));
    new Setting(el).setName('执行').addButton(b=>b.setButtonText('测试连接').onClick(()=>void this.plugin.testConnection())).addButton(b=>b.setButtonText('立即同步').setCta().onClick(()=>void this.plugin.sync()));
    el.createEl('p',{text:'此版本不传播删除或重命名，不同步隐藏文件及 Obsidian 配置。二进制附件的新版本保存在 _TriSync/incoming，需要手动替换；冲突与备份在 _TriSync 下。'});
    el.createEl('p',{text:'授权信息保存在本机插件 data.json 中，未做加密；不要分享该文件。远端保存内容和历史版本，尚无端到端加密。'});
  }
}
