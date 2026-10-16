// Minimal Storage-compatible adapters. Inject one so domain code never touches globals.
export const memoryStorage = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: k => void m.delete(k) };
};

// Wraps window.localStorage; falls back to memory when storage is blocked.
export const safeBrowserStorage = () => {
  const fallback = memoryStorage();
  const wrap = (fn, alt) => (...a) => { try { return fn(...a); } catch { return alt(...a); } };
  const ls = globalThis.localStorage;
  return {
    getItem: wrap(k => ls.getItem(k), k => fallback.getItem(k)),
    setItem: wrap((k, v) => ls.setItem(k, v), (k, v) => fallback.setItem(k, v)),
    removeItem: wrap(k => ls.removeItem(k), k => fallback.removeItem(k))
  };
};
