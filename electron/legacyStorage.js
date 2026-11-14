// Runs only in a hidden, network-disabled reader at the previous app URL.
// It reads old storage without upgrading, changing or deleting any records.
async function legacyDatabase() {
  const databases = await indexedDB.databases();
  if (!databases.some((entry) => entry.name === "synapse_voice_notes")) return null;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("synapse_voice_notes");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Previous voice notes could not be read."));
    request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("Previous storage must not be upgraded during import.")); };
  });
}

async function readLegacyStore(name, id) {
  const db = await legacyDatabase();
  if (!db) return id === undefined ? [] : null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(name, "readonly");
      const store = transaction.objectStore(name);
      const request = id === undefined ? store.getAll() : store.get(id);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(new Error("Previous storage could not be read."));
    });
  } finally { db.close(); }
}

window.readLegacyMetadata = async () => {
  const read = (key) => {
    const result = JSON.parse(localStorage.getItem(key) || "[]");
    if (!Array.isArray(result)) throw new Error("A previous save list is not valid. Its original copy was kept.");
    return result;
  };
  return { library: read("synapse_library"), bookmarks: read("synapse_bookmarks"), notes: await readLegacyStore("notes") };
};

window.readLegacyAudio = async (id) => {
  const entry = await readLegacyStore("audio", id);
  if (!entry?.blob || entry.blob.size > 20 * 1024 * 1024) throw new Error("Previous recording is missing or too large. Its original copy was kept.");
  return entry.blob.arrayBuffer();
};
