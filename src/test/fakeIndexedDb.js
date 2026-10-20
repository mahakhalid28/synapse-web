// A minimal in-memory stand-in for the IndexedDB factory, for tests only.
//
// IMPORTANT: this is NOT real IndexedDB. jsdom and Node have none, and no
// dependency (e.g. fake-indexeddb) may be added without approval, so tests that
// use this check the notesStore LOGIC against a faithful-but-tiny model:
//   - object stores with a keyPath, created in onupgradeneeded
//   - transactions that are atomic: writes are applied only on commit, and an
//     abort (including an un-prevented request error) discards all of them
//   - read-write transactions are serialised: while one is active, every other
//     transaction waits, and a transaction takes its snapshot only when it
//     starts running (as real IndexedDB does for overlapping scopes)
//   - add() fails with ConstraintError on an existing key; the key is read from the
//     store's keyPath (DataError when the record lacks it); records are deep-copied
//     in and out (see src/test/fakeIndexedDb.test.js)
//   - events fire asynchronously, requests run in order, a transaction commits
//     once its requests have drained
//   - fault injection (failNext, throwNext, abortNextTransaction, failOpen, ...)
// Real-browser behaviour (quota, durability, eviction, persistence across a
// restart, structured cloning of Blobs) is NOT exercised and must be checked
// by hand in Electron.

const tick = (fn) => setTimeout(fn, 0);
const domError = (name, message = name) => new DOMException(message, name);

// Stored and returned records are COPIES, as with real IndexedDB's structured clone, so a
// caller can never change stored data by mutating an object it passed in or got back.
// Plain objects and arrays are copied deeply; anything else (a Blob) is kept by reference.
function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto === Object.prototype || proto === null) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
    }
  }
  return value;
}

export function createFakeIndexedDB() {
  const databases = new Map(); // name -> { version, stores: Map<storeName, { keyPath, records: Map }> }
  const connections = new Set();
  const faults = [];
  const log = { opens: 0, transactions: [], closedTransactionStarts: 0 };
  const lock = { holder: null }; // the active read-write transaction
  let openFault = null;
  let openThrows = null;
  let abortNext = false;
  let deadOnOpen = 0;

  function takeFault(store, op, sync) {
    const i = faults.findIndex((f) => f.store === store && f.op === op && Boolean(f.sync) === sync);
    return i === -1 ? null : faults.splice(i, 1)[0];
  }

  function makeTransaction(db, names, mode) {
    const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null };
    let work = null; // store name -> working copy of its records; taken when the transaction starts
    let pending = 0;
    let done = false;

    const release = () => { if (lock.holder === tx) lock.holder = null; };

    // A transaction may start only when no OTHER read-write transaction is active.
    const start = () => {
      if (work) return true;
      if (lock.holder && lock.holder !== tx) return false;
      if (mode === "readwrite") lock.holder = tx;
      work = new Map(names.map((n) => [n, new Map(db.stores.get(n).records)]));
      return true;
    };

    const abort = (error) => {
      if (done) return;
      done = true;
      release();
      tx.error = error || null;
      tick(() => {
        tx.onerror?.({ target: tx });
        tx.onabort?.({ target: tx });
      });
    };
    tx.abort = () => abort(null);

    const maybeCommit = () => {
      tick(() => {
        if (done || pending > 0) return;
        done = true;
        if (work && mode === "readwrite") for (const n of names) db.stores.get(n).records = work.get(n);
        release();
        tx.oncomplete?.({ target: tx });
      });
    };

    tx.objectStore = (name) => {
      if (!names.includes(name)) throw domError("NotFoundError", `Store ${name} is not part of this transaction`);
      const request = (op, run) => {
        const syncFault = takeFault(name, op, true);
        if (syncFault) throw domError(syncFault.error); // e.g. DataCloneError thrown by add()

        const req = { result: undefined, error: null, onsuccess: null, onerror: null };
        pending++;
        const execute = () => {
          if (done) { pending--; return; }
          if (!start()) { tick(execute); return; } // wait for the active read-write transaction
          pending--;
          try {
            const injected = takeFault(name, op, false);
            if (injected) throw domError(injected.error);
            if (mode === "readonly" && op !== "get" && op !== "getAll") throw domError("ReadOnlyError");
            req.result = run(work.get(name));
          } catch (err) {
            req.error = err;
            let prevented = false;
            req.onerror?.({ target: req, preventDefault: () => { prevented = true; } });
            if (!prevented) abort(err);
            return;
          }
          req.onsuccess?.({ target: req });
          maybeCommit();
        };
        tick(execute);
        return req;
      };
      // The key comes from the store's own keyPath, as in real IndexedDB. A value without
      // that key throws DataError from add()/put() itself (synchronously), as the browser does.
      const keyOf = (value) => {
        const keyPath = db.stores.get(name).keyPath;
        const key = value !== null && typeof value === "object" ? value[keyPath] : undefined;
        if (key === undefined || key === null) throw domError("DataError", `The record has no "${keyPath}" key`);
        return key;
      };
      return {
        add: (value) => {
          const key = keyOf(value);
          return request("add", (records) => {
            if (records.has(key)) throw domError("ConstraintError", `Key ${key} already exists`);
            records.set(key, clone(value));
            return key;
          });
        },
        // Voice Notes never uses it (put() would overwrite silently); the quiz store does, for revision-checked updates.
        put: (value) => {
          const key = keyOf(value);
          return request("put", (records) => { records.set(key, clone(value)); return key; });
        },
        get: (key) => request("get", (records) => clone(records.get(key))),
        getAll: () => request("getAll", (records) => [...records.values()].map(clone)),
        delete: (key) => request("delete", (records) => { records.delete(key); }),
      };
    };

    if (abortNext) {
      abortNext = false;
      tick(() => abort(null)); // aborted by the "browser" with no error, before any request runs
    }
    maybeCommit();
    return tx;
  }

  function makeConnection(db, dead) {
    const conn = {
      _closed: dead,
      onversionchange: null,
      onclose: null,
      objectStoreNames: { contains: (n) => db.stores.has(n) },
      createObjectStore: (name, { keyPath }) => { db.stores.set(name, { keyPath, records: new Map() }); },
      transaction: (names, mode, options) => {
        if (conn._closed) {
          log.closedTransactionStarts++;
          throw domError("InvalidStateError", "The database connection is closing");
        }
        const list = Array.isArray(names) ? names : [names];
        log.transactions.push({ stores: [...list], mode, durability: options && options.durability });
        return makeTransaction(db, list, mode);
      },
      close: () => { conn._closed = true; connections.delete(conn); },
    };
    connections.add(conn);
    return conn;
  }

  const factory = {
    open(name, version) {
      if (openThrows) { const e = openThrows; openThrows = null; throw e; }
      log.opens++;
      const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      tick(() => {
        if (openFault) {
          request.error = domError(openFault);
          openFault = null;
          request.onerror?.({ target: request });
          return;
        }
        let db = databases.get(name);
        if (!db) { db = { version: 0, stores: new Map() }; databases.set(name, db); }
        if (db.version > version) {
          request.error = domError("VersionError");
          request.onerror?.({ target: request });
          return;
        }
        const dead = deadOnOpen > 0;
        if (dead) deadOnOpen--;
        request.result = makeConnection(db, dead);
        if (db.version < version) {
          db.version = version;
          request.onupgradeneeded?.({ target: request });
        }
        request.onsuccess?.({ target: request });
      });
      return request;
    },
  };

  return {
    factory,
    log,
    // Fault injection ---------------------------------------------------------
    failNext: ({ store, op, error = "QuotaExceededError" }) => { faults.push({ store, op, error, sync: false }); },
    // The request-creating call itself throws (e.g. DataCloneError from add()).
    throwNext: ({ store, op, error = "DataCloneError" }) => { faults.push({ store, op, error, sync: true }); },
    // The next transaction is aborted with no error attached.
    abortNextTransaction: () => { abortNext = true; },
    // The next `count` connections handed out are already closed.
    deadOnOpen: (count = 1) => { deadOnOpen = count; },
    failOpen: (error = "UnknownError") => { openFault = error; },
    throwOnOpen: (error) => { openThrows = error; },
    // The browser closes connections (e.g. storage cleared / another tab upgraded).
    closeConnections: () => { for (const c of [...connections]) { c._closed = true; connections.delete(c); c.onclose?.(); } },
    // Closed WITHOUT onclose firing, so the store still holds the dead connection.
    closeConnectionsSilently: () => { for (const c of [...connections]) { c._closed = true; connections.delete(c); } },
    simulateVersionChange: () => { for (const c of [...connections]) c.onversionchange?.({}); },
    // Inspection --------------------------------------------------------------
    version: (name) => databases.get(name)?.version,
    storeNames: (name) => [...(databases.get(name)?.stores.keys() ?? [])],
    keyPath: (name, store) => databases.get(name)?.stores.get(store)?.keyPath,
    records: (name, store) => [...(databases.get(name)?.stores.get(store)?.records.values() ?? [])],
    openConnections: () => connections.size,
  };
}
