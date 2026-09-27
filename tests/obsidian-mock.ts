import type { RequestUrlParam } from 'obsidian';
export const requestUrl=(params:RequestUrlParam)=>{
  const runtime=globalThis as unknown as {triSyncRequest:(params:RequestUrlParam)=>Promise<unknown>};
  return runtime.triSyncRequest(params);
};
