// Storage adapters. The vault core talks to a minimal Storage-like
// interface ({ getItem, setItem, removeItem }) so it runs unchanged in the
// browser (localStorage) and in Node tests (in-memory shim).

/** In-memory Storage-like object for tests and non-browser use. */
export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _map: map,
  };
}

/** The browser's localStorage (throws outside a browser context). */
export function browserStorage() {
  if (typeof localStorage === 'undefined') throw Error('localStorage unavailable');
  return localStorage;
}
