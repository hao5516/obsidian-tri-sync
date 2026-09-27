import { SyncPanel } from '../src/ui';
import type { SyncHost } from '../src/ui';
import type { App } from 'obsidian';
const listeners = new Set<()=>void>();
const host: SyncHost = {
  config:{provider:'webdav',endpoint:'https://dav.example.com/dav',folder:'tri-sync',username:'demo',password:'demo',region:'us-east-1',accessKey:'',secretKey:'',baiduToken:'',baiduFolder:'',auto:true,interval:300,maxMB:20},
  busy:false,operation:null,
  report:{at:1790593200000,result:{uploaded:12,downloaded:8,conflicts:1,skipped:0,issues:[{path:'旅行/周末计划.md',reason:'存在不同版本，已保留冲突副本'}]}},
  subscribe(fn){listeners.add(fn);return()=>{listeners.delete(fn);};},
  async saveSettings(s){host.config=s;listeners.forEach(fn=>fn());},
  async sync(){host.busy=true;host.operation='sync';host.progress={phase:'files',current:12,total:40};listeners.forEach(fn=>fn());},
  async testConnection(){return '连接成功，可以访问同步文件夹。文件写入权限会在首次同步时验证。';},
  openCopies(){document.body.setAttribute('data-copies','opened');}
};
const preview = {
  host,
  reset(mode:string){
    host.busy=false;host.operation=null;
    if(mode==='new'){host.config.endpoint='';host.report=undefined;}
    listeners.forEach(fn=>fn());
  }
};
Object.assign(window,{triSyncPreview:preview});
new SyncPanel({} as App,host).open();
