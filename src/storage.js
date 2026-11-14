// localStorage keys
const BOOKMARKS_KEY = "synapse_bookmarks";
const LIBRARY_KEY   = "synapse_library";
import { accountOwner, ACCOUNT_CHANGED, LOCAL_PROFILE_ID } from "./lib/accountSession";
let personalLibrary = null;
let personalBookmarks = null;

// In-memory summaries only. Backend collections are the durable authority.
export function updatePersonalSummary(lectures, bookmarks) {
  personalLibrary = lectures.map((lecture) => ({ ...lecture, ...(lecture.explanations[0] || {}) }));
  personalBookmarks = bookmarks;
  notify();
}

// Fired after every write so on-screen summaries (the Sidebar's bookmark count
// and "Recently processed") never keep showing numbers that are no longer true.
export const STORAGE_CHANGED_EVENT = "synapse-storage-changed";
const notify = () => window.dispatchEvent(new Event(STORAGE_CHANGED_EVENT));

/* ── Bookmarks ───────────────────────────────────────────────────────────── */

export function getBookmarks() {
  if (personalBookmarks !== null) return personalBookmarks;
  try { if (accountOwner() !== LOCAL_PROFILE_ID) return []; } catch { return []; }
  try { return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]"); }
  catch { return []; }
}

export function saveBookmark(bookmark) {
  const list = getBookmarks().filter((b) => b.id !== bookmark.id);
  list.unshift({ ...bookmark, savedAt: bookmark.savedAt ?? Date.now() });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  notify();
}

export function removeBookmark(id) {
  const list = getBookmarks().filter((b) => b.id !== id);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list));
  notify();
}

export function isBookmarked(id) {
  return getBookmarks().some((b) => b.id === id);
}

/* ── Library ─────────────────────────────────────────────────────────────── */

export function getLibrary() {
  if (personalLibrary !== null) return personalLibrary;
  try { if (accountOwner() !== LOCAL_PROFILE_ID) return []; } catch { return []; }
  try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || "[]"); }
  catch { return []; }
}

export function saveToLibrary(item) {
  const list = getLibrary().filter((e) => e.id !== item.id);
  list.unshift({ ...item, savedAt: item.savedAt ?? Date.now() });
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
  notify();
}

export function removeFromLibrary(id) {
  const list = getLibrary().filter((e) => e.id !== id);
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
  notify();
}

window.addEventListener(ACCOUNT_CHANGED, () => {
  personalLibrary = [];
  personalBookmarks = [];
  notify();
});
