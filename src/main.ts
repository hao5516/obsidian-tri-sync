import { App, Notice, Plugin, PluginSettingTab, Setting, TFile, normalizePath, requireApiVersion } from 'obsidian';
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
      const r=await synchronize(createStore(s),this.local(),state,()=>this.persist(),Math.max(1,Math.min(100,s.maxMB))*1024*1024,()=>{
        if(this.stopped) throw new Error('插件已停用');
      });
      const message=`上传 ${r.uploaded}，下载 ${r.downloaded}，冲突 ${r.conflicts}，跳过 ${r.skipped}`;
      this.status.setText(`三端同步：${message}`);
      if(manual || r.conflicts || r.skipped) new Notice(message,8000);
    } catch(e) {
      this.status.setText('三端同步：失败');
      new Notice(`同步停止：${e instanceof Error ? e.message : '未知错误'}`,10000);
    } finally { this.busy=false; }
  }
}
interface SettingsRow {
  name: string;
  desc: string;
  visible?: () => boolean;
  render: (setting: Setting) => void;
}

class SyncSettings extends PluginSettingTab {
  constructor(app:App,private plugin:TriSync) { super(app,plugin); }

  // Newer hosts index these definitions for settings search. Older hosts use display().
  getSettingDefinitions(): SettingsRow[] { return this.rows(); }
  display() { this.renderLegacy(); }
  private refresh() {
    if(requireApiVersion('1.13.0')) this.update();
    else this.renderLegacy();
  }
  private renderLegacy() {
    this.containerEl.empty();
    for(const row of this.rows()) {
      if(row.visible && !row.visible()) continue;
      row.render(new Setting(this.containerEl).setName(row.name).setDesc(row.desc));
    }
  }
  private rows(): SettingsRow[] {
    const s=this.plugin.data.settings;
    const rows: SettingsRow[]=[];
    rows.push({name:'使用说明',desc:'三台设备选择同一服务、同一远端目录。首次使用请手动同步；自动同步仅在 Obsidian 运行时执行。',render:()=>{}});
    rows.push({name:'同步服务',desc:'选择远端存储服务。',render:setting=>{
      setting.addDropdown(d=>d.addOption('webdav','WebDAV（坚果云 / NAS）').addOption('s3','S3 兼容存储').addOption('baidu','百度网盘（实验性）').setValue(s.provider).onChange(async v=>{
        if(this.plugin.busy) {d.setValue(s.provider);new Notice('请等待同步完成后再修改服务');return;}
        s.provider=v as Settings['provider'];await this.plugin.persist();this.refresh();
      }));
    }});
    type TextKey = { [K in keyof Settings]: Settings[K] extends string ? K : never }[keyof Settings];
    const text=(name:string,key:TextKey,desc:string,visible:()=>boolean,secret=false)=>{
      rows.push({name,desc,visible,render:setting=>{
        setting.addText(t=>{
          t.setValue(s[key]);if(secret) t.inputEl.type='password';
          t.onChange(async value=>{
            if(this.plugin.busy) {t.setValue(s[key]);new Notice('请等待同步完成后再修改连接信息');return;}
            if(key==='provider') return;
            s[key]=secret?value:value.trim();await this.plugin.persist();
          });
        });
      }});
    };
    const baidu=()=>s.provider==='baidu', webdav=()=>s.provider==='webdav', s3=()=>s.provider==='s3', endpoint=()=>s.provider!=='baidu';
    text('Access token','baiduToken','通过百度网盘开放平台授权获取；过期后需要更新。',baidu,true);
    text('应用目录','baiduFolder','请先在网盘中建立 /apps/你的应用名/tri-sync；应用必须具有该目录的读写及下载权限。',baidu);
    text('HTTPS 地址','endpoint','WebDAV 填根地址，S3 填包含桶名的根地址。',endpoint);
    text('远端子目录','folder','每个笔记库使用独立目录，例如 tri-sync/personal。',endpoint);
    text('用户名','username','WebDAV 账号。',webdav);
    text('应用密码','password','使用服务商提供的应用密码。',webdav,true);
    text('Region','region','例如 us-east-1；按服务商要求填写。',s3);
    text('Access key','accessKey','允许列举、读取和写入同步目录。',s3);
    text('Secret key','secretKey','S3 访问密钥。',s3,true);
    rows.push({name:'自动同步',desc:'默认关闭；手机锁屏或应用被挂起时无法保证执行。',render:setting=>{setting.addToggle(t=>t.setValue(s.auto).onChange(async v=>{s.auto=v;await this.plugin.persist();}));}});
    rows.push({name:'同步间隔（秒）',desc:'最短 60 秒。',render:setting=>{setting.addText(t=>t.setValue(String(s.interval)).onChange(async v=>{const n=Number(v);if(Number.isFinite(n)&&n>=60){s.interval=n;await this.plugin.persist();}}));}});
    rows.push({name:'单文件上限（MB）',desc:'1–100 MB，默认 20 MB；过大文件跳过。',render:setting=>{setting.addText(t=>t.setValue(String(s.maxMB)).onChange(async v=>{const n=Number(v);if(Number.isFinite(n)&&n>=1&&n<=100){s.maxMB=n;await this.plugin.persist();}}));}});
    rows.push({name:'执行',desc:'测试连接仅验证目录访问；立即同步会上传和下载文件。',render:setting=>{setting.addButton(b=>b.setButtonText('测试连接').onClick(()=>void this.plugin.testConnection())).addButton(b=>b.setButtonText('立即同步').setCta().onClick(()=>void this.plugin.sync()));}});
    rows.push({name:'同步范围',desc:'不传播删除或重命名，不同步隐藏文件及配置。二进制附件更新保存在备份目录内，需要手动替换。',render:()=>{}});
    rows.push({name:'凭据与隐私',desc:'授权信息保存在本机插件 data.json 中，未做加密；不要分享该文件。远端保存内容和历史版本，尚无端到端加密。',render:()=>{}});
    return rows;
  }
}
