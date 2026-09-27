import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { RequestUrlParam } from 'obsidian';
import { md5 } from '@noble/hashes/legacy';
import { bytesToHex } from '@noble/hashes/utils';

test('百度网盘协议：分片、下载及错误信息',async()=>{
 const outfile=resolve('dist/test-stores.mjs');
 await build({entryPoints:['src/stores.ts'],bundle:true,platform:'browser',format:'esm',outfile,alias:{obsidian:resolve('tests/obsidian-mock.ts')}});
 const {createStore,defaults}=await import(pathToFileURL(outfile).href);
 const calls:RequestUrlParam[]=[];
 const bytes=new TextEncoder().encode('百度笔记'); const digest=bytesToHex(md5(bytes));
 const runtime=globalThis as unknown as {triSyncRequest:(p:RequestUrlParam)=>Promise<unknown>};
 runtime.triSyncRequest=async p=>{
   calls.push(p); const u=new URL(p.url); const method=u.searchParams.get('method');
   let json:unknown={errno:0};
   if(method==='list') json={errno:0,list:[{server_filename:'old',fs_id:7,isdir:0}]};
   if(method==='precreate') {const body=new URLSearchParams(p.body as string);assert.equal(body.get('size'),String(bytes.length));assert.deepEqual(JSON.parse(body.get('block_list')!),[digest]);json={errno:0,uploadid:'upload-1',block_list:[0],return_type:1};}
   if(method==='upload') {assert.equal(u.searchParams.get('partseq'),'0');assert.match(p.contentType!,/multipart/);assert.ok(new TextDecoder().decode(p.body as ArrayBuffer).includes('百度笔记'));json={md5:digest};}
   if(method==='create') assert.equal(new URLSearchParams(p.body as string).get('uploadid'),'upload-1');
   if(method==='filemetas') json={errno:0,list:[{dlink:'https://d.pcs.baidu.com/file/example'}]};
   return {status:200,json,arrayBuffer:bytes.buffer,text:JSON.stringify(json)};
 };
 const s=createStore({...defaults,provider:'baidu',baiduToken:'secret-token',baiduFolder:'/apps/test/sync'});
 await s.init();assert.deepEqual(await s.list(),['old']);await s.put('new',bytes);assert.deepEqual(await s.get('old'),bytes);
 assert.deepEqual(calls.map(c=>new URL(c.url).searchParams.get('method')),['list','precreate','upload','create','filemetas',null]);
 assert.equal(calls.at(-1)!.headers!['User-Agent'],'pan.baidu.com');
 runtime.triSyncRequest=async()=>({status:200,json:{errno:110}});
 await assert.rejects(s.list(),/110/);
 runtime.triSyncRequest=async()=>{throw Error('https://private/?access_token=secret-token');};
 await assert.rejects(s.list(),error=>!String(error).includes('secret-token'));
});

test('传输配置拒绝非 HTTPS 和越界目录',async()=>{
 const {createStore,defaults}=await import(pathToFileURL(resolve('dist/test-stores.mjs')).href);
 assert.throws(()=>createStore({...defaults,endpoint:'http://example.com'}),/HTTPS/);
 assert.throws(()=>createStore({...defaults,endpoint:'https://example.com',folder:'../bad'}),/无效/);
 assert.throws(()=>createStore({...defaults,provider:'baidu',baiduToken:'x',baiduFolder:'/outside/sync'}),/apps/);
});

test('WebDAV 创建目录、UTF-8 Basic 授权及二进制读写',async()=>{
 const {createStore,defaults}=await import(pathToFileURL(resolve('dist/test-stores.mjs')).href);
 const runtime=globalThis as unknown as {triSyncRequest:(p:RequestUrlParam)=>Promise<unknown>};
 const calls:RequestUrlParam[]=[];const bytes=new Uint8Array([0,1,255]);
 runtime.triSyncRequest=async p=>{calls.push(p);return {status:p.method==='MKCOL'?405:200,arrayBuffer:bytes.buffer};};
 const store=createStore({...defaults,endpoint:'https://example.com/dav',folder:'笔记/同步',username:'用户',password:'secret'});
 await store.init();await store.put('b-file',bytes);assert.deepEqual(await store.get('b-file'),bytes);
 assert.equal(calls.filter(p=>p.method==='MKCOL').length,2);
 assert.match(calls[2].url,/%E7%AC%94%E8%AE%B0/);
 const auth=calls[2].headers!.Authorization;
 assert.equal(new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6)),c=>c.charCodeAt(0))),'用户:secret');
 assert.deepEqual(new Uint8Array(calls[2].body as ArrayBuffer),bytes);
 runtime.triSyncRequest=async()=>({status:401});
 await assert.rejects(store.get('b-file'),/401/);
});

test('S3 使用 SigV4 对实际传输的二进制正文签名',async()=>{
 const {createStore,defaults}=await import(pathToFileURL(resolve('dist/test-stores.mjs')).href);
 const runtime=globalThis as unknown as {triSyncRequest:(p:RequestUrlParam)=>Promise<unknown>};
 const calls:RequestUrlParam[]=[];const bytes=new Uint8Array([0,255,8]);
 runtime.triSyncRequest=async p=>{calls.push(p);return {status:200,arrayBuffer:bytes.buffer};};
 const store=createStore({...defaults,provider:'s3',endpoint:'https://bucket.s3.example.com',folder:'笔记',accessKey:'test-key',secretKey:'test-secret',region:'test-region'});
 await store.put('b-file',bytes);assert.deepEqual(await store.get('b-file'),bytes);
 assert.match(calls[0].headers!.authorization,/AWS4-HMAC-SHA256/);
 assert.match(calls[0].headers!.authorization,/test-region\/s3\/aws4_request/);
 assert.match(calls[0].url,/%E7%AC%94%E8%AE%B0/);
 assert.deepEqual(new Uint8Array(calls[0].body as ArrayBuffer),bytes);
});

test('百度目录超过一页时读取所有对象',async()=>{
 const {createStore,defaults}=await import(pathToFileURL(resolve('dist/test-stores.mjs')).href);
 const runtime=globalThis as unknown as {triSyncRequest:(p:RequestUrlParam)=>Promise<unknown>};
 const starts:string[]=[];
 runtime.triSyncRequest=async p=>{
   const start=new URL(p.url).searchParams.get('start')!;starts.push(start);
   return {status:200,json:{errno:0,list:start==='0'?Array.from({length:1000},(_,i)=>({server_filename:'file-'+i,fs_id:i+1,isdir:0})):[{server_filename:'last',fs_id:1001,isdir:0}]}};
 };
 const store=createStore({...defaults,provider:'baidu',baiduToken:'test',baiduFolder:'/apps/test/sync'});
 assert.equal((await store.list()).length,1001);assert.deepEqual(starts,['0','1000']);
});
