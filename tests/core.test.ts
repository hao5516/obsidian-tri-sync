import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, hash, heads, Local, parseRevision, revision, safePath, State, Store, synchronize } from '../src/core';
class MemoryStore implements Store {
  files=new Map<string,Uint8Array>(); failRevision=false;
  async init() {}
  async list() {return [...this.files.keys()];}
  async get(k:string) {const b=this.files.get(k);if(!b)throw Error('missing');return b.slice();}
  async put(k:string,b:Uint8Array) {if(this.failRevision&&k.startsWith('r-'))throw Error('offline');this.files.set(k,b.slice());}
}
class MemoryLocal implements Local {
  files=new Map<string,Uint8Array>(); copies=new Map<string,Uint8Array>(); state:State={}; race=false;
  constructor(text?:string){if(text!==undefined)this.files.set('笔记.md',encode(text));}
  async list(){return [...this.files.keys()];}
  async read(p:string){return this.files.get(p)?.slice()??null;}
  async preserve(p:string,b:Uint8Array){this.copies.set(p,b.slice());}
  async replace(p:string,b:Uint8Array,expected:string|null){
    if(this.race){this.files.set(p,encode('editing'));return false;}
    const old=this.files.get(p);if((old?hash(old):null)!==expected)return false;
    this.files.set(p,b.slice());return true;
  }
  value(){return new TextDecoder().decode(this.files.get('笔记.md'));}
}
const run=(s:Store,l:MemoryLocal,max=1024*1024)=>synchronize(s,l,l.state,async()=>{},max);
test('三端首次上传、下载和增量更新',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('v1'),b=new MemoryLocal(),c=new MemoryLocal();
 assert.equal((await run(s,a)).uploaded,1);await run(s,b);await run(s,c);
 assert.equal(b.value(),'v1');assert.equal(c.value(),'v1');
 b.files.set('笔记.md',encode('v2'));await run(s,b);await run(s,a);await run(s,c);
 assert.equal(a.value(),'v2');assert.equal(c.value(),'v2');
 const before=s.files.size;await run(s,a);assert.equal(s.files.size,before);
});
test('离线并发修改收敛且双方内容都保留',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('initial'),b=new MemoryLocal();await run(s,a);await run(s,b);
 a.files.set('笔记.md',encode('left'));b.files.set('笔记.md',encode('right'));
 await run(s,a);await run(s,b);await run(s,a);
 assert.equal(a.value(),b.value());
 const kept=[a.value(),...Array.from(a.copies.values(),b=>new TextDecoder().decode(b))];
 assert.ok(kept.includes('left'));assert.ok(kept.includes('right'));
 a.files.set('笔记.md',encode('merged'));await run(s,a);await run(s,b);
 assert.equal(b.value(),'merged');
});
test('首次同步同名异内容保留冲突',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('A'),b=new MemoryLocal('B');await run(s,a);
 assert.equal((await run(s,b)).conflicts,1);await run(s,a);assert.equal(a.value(),b.value());
});
test('内容上传成功但版本发布失败可以重试',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('data');s.failRevision=true;
 await assert.rejects(run(s,a),/offline/);assert.deepEqual(a.state,{});
 s.failRevision=false;await run(s,a);const b=new MemoryLocal();await run(s,b);assert.equal(b.value(),'data');
});
test('下载内容损坏不覆盖本地文件',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('v1'),b=new MemoryLocal();await run(s,a);await run(s,b);
 a.files.set('笔记.md',encode('v2'));await run(s,a);s.files.set('b-'+hash(encode('v2')),encode('corrupt'));
 await assert.rejects(run(s,b),/校验失败/);assert.equal(b.value(),'v1');
});
test('同步中编辑时不覆盖新内容、不提前保存基线',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('v1'),b=new MemoryLocal();await run(s,a);await run(s,b);
 const old=JSON.stringify(b.state);a.files.set('笔记.md',encode('v2'));await run(s,a);b.race=true;
 assert.equal((await run(s,b)).skipped,1);assert.equal(b.value(),'editing');assert.equal(JSON.stringify(b.state),old);
});
test('本地删除不上传、不复活已删除文件',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('v1'),b=new MemoryLocal();await run(s,a);await run(s,b);
 a.files.delete('笔记.md');await run(s,a);await run(s,b);assert.equal(a.files.size,0);assert.equal(b.value(),'v1');
});
test('跨平台路径、隐藏配置和路径穿越被拒绝',()=>{
 for(const p of ['../a','a/../b','/etc/a','.obsidian/data','a\\b','a:ads','NUL.md','CON','x.','_TriSync/a','_trisync/a','_TriSync','a\u00a0b.md'])assert.equal(safePath(p),false,p);
 assert.equal(safePath('项目/你好.md'),true);
});
test('损坏或伪造的版本记录被拒绝',()=>{
 const r=revision('a.md',hash(encode('ok')),[]);assert.equal(parseRevision(encode(JSON.stringify(r)),`r-${r.id}.json`).id,r.id);
 assert.throws(()=>parseRevision(encode(JSON.stringify({...r,path:'../x'})),`r-${r.id}.json`));
});
test('大小写重名在任何写入前停止',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal();a.files.set('A.md',encode('a'));a.files.set('a.md',encode('b'));
 await assert.rejects(run(s,a),/同名路径/);assert.equal(s.files.size,0);
});
test('过大的文件跳过',async()=>{const s=new MemoryStore(),a=new MemoryLocal('large');assert.equal((await run(s,a,2)).skipped,1);assert.equal(s.files.size,0);});
test('丢失远端历史时停止',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('v1');await run(s,a);a.files.set('笔记.md',encode('v2'));await run(s,a);
 const entries=[...s.files.entries()].filter(([k])=>k.startsWith('r-'));
 s.files.delete(entries[0][0]);await assert.rejects(run(s,new MemoryLocal()),/历史不完整/);
});
test('版本头与时钟和列表顺序无关',()=>{
 const a=revision('a.md',hash(encode('a')),[]),b=revision('a.md',hash(encode('b')),[a.id]);
 assert.deepEqual(heads([b,a]),[b]);
});
test('手动选择冲突版本内容可形成新的合并版本',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('a'),b=new MemoryLocal('b');await run(s,a);await run(s,b);await run(s,a);
 const alternative=a.value()==='a'?'b':'a';a.files.set('笔记.md',encode(alternative));
 await run(s,a);await run(s,b);assert.equal(b.value(),alternative);assert.equal((await run(s,b)).conflicts,0);
});
test('特殊文件名不会污染基线对象原型',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal();a.files.set('__proto__',encode('data'));await run(s,a);
 assert.ok(Object.prototype.hasOwnProperty.call(a.state,'__proto__'));assert.equal(Object.getPrototypeOf(a.state),Object.prototype);
});
test('插件停用后不再发布版本或更改本地基线',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('new');let stopped=false;
 const put=s.put.bind(s);s.put=async(key,bytes)=>{await put(key,bytes);stopped=true;};
 await assert.rejects(synchronize(s,a,a.state,async()=>{},1024,()=>{if(stopped)throw Error('stopped');}),/stopped/);
 assert.equal([...s.files.keys()].filter(k=>k.startsWith('r-')).length,0);assert.deepEqual(a.state,{});
});
test('进度事件与跳过原因能够解释同步结果',async()=>{
 const s=new MemoryStore(),a=new MemoryLocal('large');const phases:string[]=[];
 const r=await synchronize(s,a,a.state,async()=>{},2,()=>{},p=>phases.push(p.phase));
 assert.deepEqual(r.issues,[{path:'笔记.md',reason:'超过单文件大小上限'}]);
 assert.equal(phases[0],'connecting');assert.equal(phases.at(-1),'files');
});
