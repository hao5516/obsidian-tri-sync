import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export const hash = (b: Uint8Array): string => bytesToHex(sha256(b));
export const encode = (s: string): Uint8Array => new TextEncoder().encode(s);
export interface Store { init(): Promise<void>; list(): Promise<string[]>; get(key: string): Promise<Uint8Array>; put(key: string, bytes: Uint8Array): Promise<void>; }
export interface Local {
  list(): Promise<string[]>; read(path: string): Promise<Uint8Array | null>;
  replace(path: string, bytes: Uint8Array, expected: string | null): Promise<boolean>;
  preserve(path: string, bytes: Uint8Array): Promise<void>;
}
export interface Revision { version: 1; id: string; path: string; hash: string; parents: string[]; }
export interface Baseline { hash: string; heads: string[]; }
export type State = Record<string, Baseline>;
export const validId = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
export function safePath(path: string): boolean {
  return path.length > 0 && path.length < 1000 && path.split('/').every(p =>
    !!p && p !== '.' && p !== '..' && !p.startsWith('.') && !/[\\:*?"<>|\x00-\x1f]/.test(p) && !/[ .]$/.test(p) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)) && !path.startsWith('_TriSync/');
}
export function revision(path: string, digest: string, parents: string[]): Revision {
  const payload = { version: 1 as const, path, hash: digest, parents: [...new Set(parents)].sort() };
  return { ...payload, id: hash(encode(JSON.stringify(payload))) };
}
export function parseRevision(bytes: Uint8Array, key: string): Revision {
  const r = JSON.parse(new TextDecoder().decode(bytes)) as Revision;
  if (r.version !== 1 || typeof r.path !== 'string' || !safePath(r.path) || !validId(r.hash) || !Array.isArray(r.parents) || !r.parents.every(validId) || revision(r.path, r.hash, r.parents).id !== r.id || key !== `r-${r.id}.json`) throw new Error('远端版本记录损坏，已停止同步');
  return r;
}
export function heads(revisions: Revision[]): Revision[] {
  const parents = new Set(revisions.flatMap(r => r.parents));
  return revisions.filter(r => !parents.has(r.id)).sort((a,b) => a.id.localeCompare(b.id));
}
export interface Result { uploaded: number; downloaded: number; conflicts: number; skipped: number; }

// Append-only revisions avoid a shared mutable index and last-writer-wins data loss.
// A revision is published only after its content object is durable.
export async function synchronize(store: Store, local: Local, state: State, save: () => Promise<void>, maxBytes: number): Promise<Result> {
  const result: Result = { uploaded: 0, downloaded: 0, conflicts: 0, skipped: 0 };
  await store.init();
  const keys = await store.list();
  const all = new Map<string, Revision>();
  const groups = new Map<string, Revision[]>();
  for (const key of keys.filter(k => /^r-[a-f0-9]{64}\.json$/.test(k))) {
    const r = parseRevision(await store.get(key), key);
    all.set(r.id, r);
    const group = groups.get(r.path) ?? []; group.push(r); groups.set(r.path, group);
  }
  // An incomplete remote listing must never turn a superseded revision into a head.
  for (const r of all.values()) for (const parent of r.parents) {
    if (!all.has(parent) || all.get(parent)!.path !== r.path) throw new Error('远端历史不完整，请重试；不要手动删除远端同步文件');
  }
  const paths = [...new Set([...(await local.list()), ...groups.keys()])].sort();
  const folded = new Set<string>();
  for (const path of paths) {
    const key = path.normalize('NFC').toLowerCase();
    if (folded.has(key)) throw new Error('存在大小写或 Unicode 同名路径，无法安全跨平台同步');
    folded.add(key);
  }
  const getBlob = async (digest: string): Promise<Uint8Array> => {
    const bytes = await store.get(`b-${digest}`);
    if (bytes.length > maxBytes) throw new Error('远端文件超过大小上限');
    if (hash(bytes) !== digest) throw new Error('下载校验失败，原文件未覆盖');
    return bytes;
  };
  for (const path of paths) {
    if (!safePath(path)) { result.skipped++; continue; }
    const bytes = await local.read(path);
    if (bytes && bytes.length > maxBytes) { result.skipped++; continue; }
    const digest = bytes ? hash(bytes) : null;
    const baseline = Object.prototype.hasOwnProperty.call(state, path) ? state[path] : undefined;
    const group = groups.get(path) ?? [];
    // Missing baseline parents indicate a reset/incomplete remote. Stop rather than fork silently.
    if (baseline?.heads.some(id => !all.has(id))) throw new Error('远端缺少本机已同步的历史，请检查同步目录');
    let current = heads(group);
    if (bytes && digest && digest !== baseline?.hash && (baseline || !current.some(r => r.hash === digest))) {
      const r = revision(path, digest, baseline?.heads ?? []);
      await store.put(`b-${digest}`, bytes);
      await store.put(`r-${r.id}.json`, encode(JSON.stringify(r)));
      group.push(r); all.set(r.id, r); current = heads(group); result.uploaded++;
    }
    if (!current.length) continue;
    const winner = current[current.length - 1];
    // Every competing content survives as a deterministic, visible conflict copy.
    for (const alternate of current.filter(r => r.hash !== winner.hash)) {
      await local.preserve(`_TriSync/conflicts/${alternate.id}/${path}`, await getBlob(alternate.hash));
      result.conflicts++;
    }
    // Keep a local deletion local. This version intentionally does not publish tombstones.
    if (!bytes && baseline) { result.skipped++; continue; }
    if (digest !== winner.hash) {
      const incoming = await getBlob(winner.hash);
      if (bytes && digest) await local.preserve(`_TriSync/backups/${digest}/${path}`, bytes);
      if (!await local.replace(path, incoming, digest)) { result.skipped++; continue; }
      result.downloaded++;
    }
    Object.defineProperty(state, path, { value: { hash: winner.hash, heads: current.map(r => r.id) }, enumerable: true, configurable: true, writable: true });
    await save();
  }
  return result;
}
