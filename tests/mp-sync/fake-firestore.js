// 友達対戦のテスト用：本物の Firestore の代わり。読み書きはすべてテストのプログラム（run.mjs）に渡し、そこで数える
const listeners = new Map(); let lid = 0;
window.__fsDeliver = (id, p) => { const cb = listeners.get(id); if (cb) cb(mk(p)); };
function mk(p) { return { exists: () => p !== null, data: () => (p === null ? undefined : JSON.parse(JSON.stringify(p))) }; }
export function getFirestore() { return {}; }
export function doc(db, col, id) { return { path: col + '/' + id }; }
export function serverTimestamp() { return { __ts: 1 }; }
export function arrayUnion(...v) { return { __au: v }; }
export async function getDoc(ref) { return mk(await window.__fs({ op: 'get', path: ref.path })); }
export async function setDoc(ref, data) { await window.__fs({ op: 'set', path: ref.path, data }); }
export async function updateDoc(ref, data) { await window.__fs({ op: 'update', path: ref.path, data }); }
export async function deleteDoc(ref) { await window.__fs({ op: 'delete', path: ref.path }); }
export function onSnapshot(ref, cb) { const id = ++lid; listeners.set(id, cb); window.__fs({ op: 'listen', path: ref.path, lid: id }); return () => { listeners.delete(id); window.__fs({ op: 'unlisten', lid: id }); }; }
export async function runTransaction(db, fn) {
  const ups = [];
  const tx = { get: async (ref) => mk(await window.__fs({ op: 'get', path: ref.path, tag: 'tx' })), update: (ref, data) => ups.push({ ref, data }) };
  const r = await fn(tx);
  for (const u of ups) await window.__fs({ op: 'update', path: u.ref.path, data: u.data, tag: 'tx' });
  return r;
}
