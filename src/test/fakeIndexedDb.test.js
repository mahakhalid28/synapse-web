// Regression tests for the test double itself. The quiz store depends on three things a simpler
// fake gets wrong: the key comes from the store's keyPath, records are copies (not shared
// references), and put() replaces. A fake that cheats here would let store bugs pass.

import { describe, it, expect } from "vitest";
import { createFakeIndexedDB } from "./fakeIndexedDb.js";

function open(fake, stores) {
  return new Promise((resolve, reject) => {
    const request = fake.factory.open("t", 1);
    request.onupgradeneeded = () => { for (const [name, keyPath] of stores) request.result.createObjectStore(name, { keyPath }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run(db, names, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let out;
    tx.oncomplete = () => resolve(out);
    tx.onabort = () => reject(tx.error || new Error("aborted"));
    out = work(tx);
  });
}

describe("fake IndexedDB: keyPath", () => {
  it("keys records by the store's own keyPath, not by a field called id", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["byName", "name"]]);
    await run(db, ["byName"], "readwrite", (tx) => { tx.objectStore("byName").add({ name: "a", id: "decoy", v: 1 }); });
    const record = await new Promise((resolve) => {
      const tx = db.transaction(["byName"], "readonly");
      const r = tx.objectStore("byName").get("a");
      r.onsuccess = () => resolve(r.result);
    });
    expect(record).toEqual({ name: "a", id: "decoy", v: 1 });
    const missing = await new Promise((resolve) => {
      const tx = db.transaction(["byName"], "readonly");
      const r = tx.objectStore("byName").get("decoy");
      r.onsuccess = () => resolve(r.result);
    });
    expect(missing).toBeUndefined();
  });

  it("rejects a record that lacks the key with DataError, synchronously, as a browser does", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    const tx = db.transaction(["s"], "readwrite");
    for (const value of [{}, { id: null }, null, "text"]) {
      expect(() => tx.objectStore("s").add(value)).toThrowError(expect.objectContaining({ name: "DataError" }));
      expect(() => tx.objectStore("s").put(value)).toThrowError(expect.objectContaining({ name: "DataError" }));
    }
    tx.abort();
  });

  it("add() rejects a duplicate under a custom keyPath too", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["byName", "name"]]);
    await run(db, ["byName"], "readwrite", (tx) => { tx.objectStore("byName").add({ name: "a" }); });
    await expect(run(db, ["byName"], "readwrite", (tx) => { tx.objectStore("byName").add({ name: "a" }); }))
      .rejects.toMatchObject({ name: "ConstraintError" });
  });
});

describe("fake IndexedDB: put and copies", () => {
  it("put() replaces an existing record and add() still refuses to", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add({ id: "x", v: 1 }); });
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").put({ id: "x", v: 2 }); });
    expect(fake.records("t", "s")).toEqual([{ id: "x", v: 2 }]);
    await expect(run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add({ id: "x", v: 3 }); }))
      .rejects.toMatchObject({ name: "ConstraintError" });
    expect(fake.records("t", "s")).toEqual([{ id: "x", v: 2 }]);
  });

  it("stores a deep copy: changing the object afterwards does not change the stored record", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    const value = { id: "x", nested: { list: [1, 2, { deep: true }] } };
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add(value); });
    value.nested.list.push(99);
    value.nested.list[2].deep = false;
    expect(fake.records("t", "s")[0].nested.list).toEqual([1, 2, { deep: true }]);
  });

  it("returns copies: changing a read result does not change the stored record", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add({ id: "x", nested: { n: 1 } }); });
    const read = await new Promise((resolve) => {
      const tx = db.transaction(["s"], "readonly");
      const r = tx.objectStore("s").get("x");
      r.onsuccess = () => resolve(r.result);
    });
    read.nested.n = 2;
    const all = await new Promise((resolve) => {
      const tx = db.transaction(["s"], "readonly");
      const r = tx.objectStore("s").getAll();
      r.onsuccess = () => resolve(r.result);
    });
    all[0].nested.n = 3;
    expect(fake.records("t", "s")[0].nested.n).toBe(1);
  });

  it("keeps non-plain values such as Blobs by reference (Voice Notes stores audio this way)", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["audio", "id"]]);
    const blob = new Blob(["bytes"], { type: "audio/webm" });
    await run(db, ["audio"], "readwrite", (tx) => { tx.objectStore("audio").add({ id: "n", blob }); });
    expect(fake.records("t", "audio")[0].blob).toBe(blob);
  });

  it("an aborted transaction discards a put() as well", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add({ id: "x", v: 1 }); });
    await expect(run(db, ["s"], "readwrite", (tx) => {
      tx.objectStore("s").put({ id: "x", v: 2 });
      tx.objectStore("s").add({ id: "x", v: 3 }); // fails -> the whole transaction aborts
    })).rejects.toBeTruthy();
    expect(fake.records("t", "s")).toEqual([{ id: "x", v: 1 }]);
  });
});

describe("fake IndexedDB: chained requests (needed for read-then-write)", () => {
  it("a request issued inside a success callback joins the same transaction", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["a", "id"], ["b", "id"]]);
    await run(db, ["a", "b"], "readwrite", (tx) => {
      tx.objectStore("a").add({ id: 1 });
      const get = tx.objectStore("a").get(1);
      get.onsuccess = () => { tx.objectStore("b").add({ id: "from-callback", saw: Boolean(get.result) }); };
    });
    expect(fake.records("t", "b")).toEqual([{ id: "from-callback", saw: true }]);
  });

  it("two-level nesting works and a failed inner write rolls back the outer one", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["a", "id"], ["b", "id"]]);
    await expect(run(db, ["a", "b"], "readwrite", (tx) => {
      const first = tx.objectStore("a").get("none");
      first.onsuccess = () => {
        tx.objectStore("a").add({ id: "outer" });
        const second = tx.objectStore("b").get("none");
        second.onsuccess = () => { tx.objectStore("b").add({ id: "dup" }); tx.objectStore("b").add({ id: "dup" }); };
      };
    })).rejects.toMatchObject({ name: "ConstraintError" });
    expect(fake.records("t", "a")).toEqual([]);
    expect(fake.records("t", "b")).toEqual([]);
  });

  it("overlapping read-write transactions are serialised", async () => {
    const fake = createFakeIndexedDB();
    const db = await open(fake, [["s", "id"]]);
    await run(db, ["s"], "readwrite", (tx) => { tx.objectStore("s").add({ id: "c", n: 0 }); });
    const bump = () => run(db, ["s"], "readwrite", (tx) => {
      const get = tx.objectStore("s").get("c");
      get.onsuccess = () => { tx.objectStore("s").put({ id: "c", n: get.result.n + 1 }); };
    });
    await Promise.all([bump(), bump(), bump()]);
    expect(fake.records("t", "s")[0].n).toBe(3);
  });
});
