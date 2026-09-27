import { requestUrl, RequestUrlParam } from 'obsidian';
import { AwsClient } from 'aws4fetch';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';
import { encode, Store } from './core';

export interface Settings {
  provider: 'webdav' | 's3' | 'baidu'; endpoint: string; folder: string;
  username: string; password: string; region: string; accessKey: string; secretKey: string;
  baiduToken: string; baiduFolder: string; interval: number; auto: boolean; maxMB: number;
}
export const defaults: Settings = { provider: 'webdav', endpoint: '', folder: 'tri-sync', username: '', password: '', region: 'us-east-1', accessKey: '', secretKey: '', baiduToken: '', baiduFolder: '/apps/你的应用名/tri-sync', interval: 300, auto: false, maxMB: 20 };
export const buffer = (b: Uint8Array): ArrayBuffer => Uint8Array.from(b).buffer;
async function http(options: RequestUrlParam) {
  let r;
  try { r = await requestUrl({ ...options, throw: false }); }
  catch { throw new Error('网络请求失败，请检查网络和服务地址'); }
  if (r.status < 200 || r.status >= 300) throw new Error(`服务请求失败（HTTP ${r.status}）`);
  return r;
}
const xml = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('服务返回了无效 XML');
  return doc;
};
const elements = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
function httpsEndpoint(endpoint: string): string {
  const u = new URL(endpoint);
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error('服务地址必须是 HTTPS 地址，不含密码、查询参数或片段');
  return u.href.replace(/\/$/, '');
}
function folderSegments(folder: string): string[] {
  const parts = folder.split('/').filter(Boolean);
  if (!parts.length || parts.some(p => p === '.' || p === '..' || /[\\\x00-\x1f]/.test(p))) throw new Error('同步目录无效');
  return parts;
}
class WebDAV implements Store {
  base: string; auth: Record<string,string>;
  constructor(private s: Settings) {
    this.base = httpsEndpoint(s.endpoint) + '/' + folderSegments(s.folder).map(encodeURIComponent).join('/');
    const credentials = encode(s.username + ':' + s.password);
    this.auth = { Authorization: 'Basic ' + btoa(Array.from(credentials, c => String.fromCharCode(c)).join('')) };
  }
  async init() {
    let url = httpsEndpoint(this.s.endpoint);
    for (const part of folderSegments(this.s.folder)) {
      url += '/' + encodeURIComponent(part);
      let r;
      try { r = await requestUrl({ url: url + '/', method: 'MKCOL', headers: this.auth, throw: false }); }
      catch { throw new Error('WebDAV 连接失败'); }
      if (![200,201,204,405].includes(r.status)) throw new Error(`WebDAV 创建目录失败（HTTP ${r.status}）`);
    }
  }
  async list() {
    const r = await http({url:this.base+'/',method:'PROPFIND',headers:{...this.auth,Depth:'1','Content-Type':'application/xml'},body:'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'});
    const basePath = decodeURIComponent(new URL(this.base+'/').pathname);
    return elements(xml(r.text),'response').flatMap(row => {
      if (elements(row,'collection').length) return [];
      const href = elements(row,'href')[0]?.textContent;
      if (!href) return [];
      const path = decodeURIComponent(new URL(href,this.base+'/').pathname);
      if (!path.startsWith(basePath)) return [];
      const key = path.slice(basePath.length);
      return key && !key.includes('/') ? [key] : [];
    });
  }
  async get(key:string) { return new Uint8Array((await http({url:this.base+'/'+encodeURIComponent(key),headers:this.auth})).arrayBuffer); }
  async put(key:string,bytes:Uint8Array) { await http({url:this.base+'/'+encodeURIComponent(key),method:'PUT',headers:this.auth,body:buffer(bytes),contentType:'application/octet-stream'}); }
}
class S3 implements Store {
  client: AwsClient; base: string; prefix: string;
  constructor(s:Settings) {
    if (!s.accessKey || !s.secretKey) throw new Error('请填写 S3 密钥');
    this.client = new AwsClient({accessKeyId:s.accessKey,secretAccessKey:s.secretKey,region:s.region,service:'s3'});
    this.base = httpsEndpoint(s.endpoint); this.prefix = folderSegments(s.folder).join('/')+'/';
  }
  async init() {}
  async send(url:string,method='GET',bytes?:Uint8Array) {
    const signed = await this.client.sign(url,{method,body:bytes ? buffer(bytes) : undefined});
    return http({url:signed.url,method,headers:Object.fromEntries(signed.headers.entries()),body:bytes ? buffer(bytes) : undefined});
  }
  async list() {
    const keys:string[]=[]; let token=''; const seen = new Set<string>();
    do {
      const q = new URLSearchParams({'list-type':'2',prefix:this.prefix});
      if (token) q.set('continuation-token',token);
      const doc = xml((await this.send(this.base+'/?'+q)).text);
      for (const e of elements(doc,'Key')) {
        const key = e.textContent ?? '';
        if (key.startsWith(this.prefix) && !key.slice(this.prefix.length).includes('/')) keys.push(key.slice(this.prefix.length));
      }
      const truncated = elements(doc,'IsTruncated')[0]?.textContent === 'true';
      token = truncated ? elements(doc,'NextContinuationToken')[0]?.textContent ?? '' : '';
      if (truncated && (!token || seen.has(token))) throw new Error('S3 分页响应异常');
      seen.add(token);
    } while(token);
    return keys;
  }
  url(key:string) { return this.base+'/'+(this.prefix+key).split('/').map(encodeURIComponent).join('/'); }
  async get(key:string) { return new Uint8Array((await this.send(this.url(key))).arrayBuffer); }
  async put(key:string,bytes:Uint8Array) { await this.send(this.url(key),'PUT',bytes); }
}

interface BaiduResponse { errno?: number; error_code?: number; uploadid?: string; return_type?: number; block_list?: number[]; md5?: string; list?: {server_filename:string;fs_id:number;isdir:number;dlink?:string}[]; }
class Baidu implements Store {
  ids = new Map<string,number>(); dir: string;
  constructor(private s:Settings) {
    this.dir = '/'+folderSegments(s.baiduFolder).join('/');
    if (!this.dir.startsWith('/apps/') || this.dir.split('/').length < 4 || !s.baiduToken) throw new Error('请填写百度网盘 access_token 和 /apps/应用名/同步目录');
  }
  check(data: BaiduResponse) {
    if (data.errno || data.error_code) throw new Error(`百度网盘错误 ${data.errno || data.error_code}；请检查授权是否过期及应用目录权限`);
    return data;
  }
  async api(method:string, params:Record<string,string>, post=false, resource='file'):Promise<BaiduResponse> {
    const q = new URLSearchParams({method,access_token:this.s.baiduToken,...(!post ? params : {})});
    const r = await http({url:`https://pan.baidu.com/rest/2.0/xpan/${resource}?${q}`,method:post?'POST':'GET',...(post?{body:new URLSearchParams(params).toString(),contentType:'application/x-www-form-urlencoded'}:{})});
    return this.check(r.json as BaiduResponse);
  }
  async init() { /* Directory must be created in the authorized app folder by the user. */ }
  async list() {
    this.ids.clear();
    for (let start=0;;start+=1000) {
      const data = await this.api('list',{dir:this.dir,start:String(start),limit:'1000',order:'name'});
      if (!Array.isArray(data.list)) throw new Error('百度网盘列表响应不完整');
      for (const f of data.list) if (!f.isdir) this.ids.set(f.server_filename,f.fs_id);
      if (data.list.length < 1000) break;
    }
    return [...this.ids.keys()];
  }
  async get(key:string) {
    if (!this.ids.has(key)) await this.list();
    const id = this.ids.get(key);
    if (!id) throw new Error('百度网盘缺少同步文件');
    const data = await this.api('filemetas',{fsids:JSON.stringify([id]),dlink:'1'},false,'multimedia');
    const link = data.list?.[0]?.dlink;
    if (!link) throw new Error('百度网盘未返回下载链接，请检查下载权限');
    const url = new URL(link);
    if (url.protocol !== 'https:' || !/(^|\.)(baidu\.com|baidupcs\.com)$/.test(url.hostname)) throw new Error('百度网盘下载域名异常');
    url.searchParams.set('access_token',this.s.baiduToken);
    return new Uint8Array((await http({url:url.href,headers:{'User-Agent':'pan.baidu.com'}})).arrayBuffer);
  }
  async put(key:string,bytes:Uint8Array) {
    if (this.ids.has(key)) return; // Immutable content/revision keys are safe to reuse.
    const chunks:Uint8Array[]=[];
    for(let start=0;start<bytes.length;start+=4*1024*1024) chunks.push(bytes.slice(start,start+4*1024*1024));
    if (!chunks.length) chunks.push(new Uint8Array());
    const hashes=chunks.map(b=>bytesToHex(md5(b)));
    const params={path:this.dir+'/'+key,size:String(bytes.length),isdir:'0',block_list:JSON.stringify(hashes),rtype:'0'};
    const pre=await this.api('precreate',{...params,autoinit:'1'},true);
    if(pre.return_type===2) return;
    if(!pre.uploadid || !Array.isArray(pre.block_list)) throw new Error('百度预上传响应不完整');
    for(const index of pre.block_list) {
      if (!Number.isInteger(index) || !chunks[index]) throw new Error('百度分片序号无效');
      const boundary='TriSync'+Date.now().toString(16)+index;
      const begin=encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="blob"\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const end=encode(`\r\n--${boundary}--\r\n`);
      const body=new Uint8Array(begin.length+chunks[index].length+end.length);
      body.set(begin); body.set(chunks[index],begin.length); body.set(end,begin.length+chunks[index].length);
      const q=new URLSearchParams({method:'upload',access_token:this.s.baiduToken,type:'tmpfile',path:params.path,uploadid:pre.uploadid,partseq:String(index)});
      const data=this.check((await http({url:'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?'+q,method:'POST',contentType:`multipart/form-data; boundary=${boundary}`,body:buffer(body)})).json as BaiduResponse);
      if(data.md5!==hashes[index]) throw new Error('百度上传分片校验失败');
    }
    await this.api('create',{...params,uploadid:pre.uploadid},true);
  }
}
export function createStore(s:Settings):Store {
  if(s.provider==='webdav') return new WebDAV(s);
  if(s.provider==='s3') return new S3(s);
  if(s.provider==='baidu') return new Baidu(s);
  throw new Error('未知同步服务');
}
