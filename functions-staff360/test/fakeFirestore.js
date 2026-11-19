/* Minimal in-memory stand-in for the firebase-admin Firestore surface that
 * handlers.js uses. Paths are plain strings; documents are deep-cloned. */
'use strict';
let autoId = 0;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function setPath(obj, dotted, val) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}
function deepMerge(a, b) {
  const out = clone(a) || {};
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], b[k]);
    else out[k] = clone(b[k]);
  }
  return out;
}

function createFake() {
  const store = new Map();
  const db = {};
  const snap = (path) => {
    const d = store.get(path);
    const id = path.split('/').pop();
    return { id, exists: d !== undefined, data: () => clone(d), ref: docRef(path) };
  };
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snap(path),
      set: async (data, opts) => { store.set(path, opts && opts.merge ? deepMerge(store.get(path), data) : clone(data)); },
      update: async (patch) => {
        if (!store.has(path)) throw new Error('NOT_FOUND ' + path);
        const cur = clone(store.get(path));
        for (const k of Object.keys(patch)) setPath(cur, k, clone(patch[k]));
        store.set(path, cur);
      },
      delete: async () => { store.delete(path); },
      collection: (c) => query(`${path}/${c}`, [], null, null),
    };
  }
  function query(coll, filters, order, lim) {
    return {
      where: (f, op, v) => query(coll, filters.concat([[f, op, v]]), order, lim),
      orderBy: (f, dir) => query(coll, filters, [f, dir || 'asc'], lim),
      limit: (n) => query(coll, filters, order, n),
      doc: (id) => docRef(`${coll}/${id || 'auto' + (++autoId)}`),
      add: async (data) => { const r = docRef(`${coll}/auto${++autoId}`); await r.set(data); return r; },
      get: async () => {
        const depth = coll.split('/').length + 1;
        let docs = [];
        for (const [p, d] of store) {
          if (p.startsWith(coll + '/') && p.split('/').length === depth) docs.push(snap(p));
        }
        docs = docs.filter((s) => filters.every(([f, op, v]) => {
          const x = s.data()[f];
          if (op === '==') return x === v;
          if (op === '>=') return x >= v;
          if (op === '<=') return x <= v;
          throw new Error('op ' + op);
        }));
        if (order) docs.sort((a, b) => (a.data()[order[0]] > b.data()[order[0]] ? 1 : -1) * (order[1] === 'desc' ? -1 : 1));
        if (lim) docs = docs.slice(0, lim);
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
  }
  db.doc = (p) => docRef(p);
  db.collection = (p) => query(p, [], null, null);
  db.runTransaction = async (fn) => {
    const tx = {
      get: (ref) => ref.get(),
      set: (ref, d, o) => { tx._ops.push(() => ref.set(d, o)); },
      update: (ref, d) => { tx._ops.push(() => ref.update(d)); },
      _ops: [],
    };
    const r = await fn(tx);
    for (const op of tx._ops) await op();
    return r;
  };
  db._store = store;
  db._seed = (path, data) => store.set(path, clone(data));
  return db;
}

module.exports = { createFake };
