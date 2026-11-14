import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "./Sidebar";
import PersonalImport from "./PersonalImport";
import { bookmarkSaved, getSavedLibrary, getSavedList, PERSONAL_CHANGED, personalRequest, notifyPersonal } from "../lib/personalApi";
import { useVoiceActions } from "../voice/voiceActions";

export default function SavedCollection({ kind, onNavigate, onOpen }) {
  const [rows, setRows] = useState([]);
  const [phase, setPhase] = useState("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState(false);
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState(null);
  const heading = useRef(null);
  const cancel = useRef(null);
  const busy = useRef(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++generation.current;
    setPhase("loading");
    try {
      const result = kind === "library" && !recent
        ? (await getSavedLibrary()).flatMap((lecture) => lecture.explanations.length ? lecture.explanations : [{ ...lecture, id: `lecture-${lecture.videoId}`, title: "Open lecture", mode: "standard" }])
        : await getSavedList(kind === "bookmarks" ? "bookmarks" : "recent");
      if (token !== generation.current) return;
      setRows(result);
      setPhase("ready");
    } catch (error) { if (token === generation.current) { setPhase("error"); setMessage(error.message); } }
  }, [kind, recent]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile this screen with an external backend collection
    void refresh();
    const reload = () => { void refresh(); };
    window.addEventListener(PERSONAL_CHANGED, reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- this ref is a request generation, deliberately invalidated on unmount
    return () => { generation.current++; window.removeEventListener(PERSONAL_CHANGED, reload); };
  }, [refresh]);
  useEffect(() => { if (confirming) cancel.current?.focus(); }, [confirming]);
  const filtered = rows.filter((row) => `${row.videoTitle} ${row.title} ${row.mode}`.toLowerCase().includes(query.toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / 60) - 1);
  const activePage = Math.min(page, lastPage);
  const visible = filtered.slice(activePage * 60, activePage * 60 + 60);
  const at = (index) => {
    const item = visible[index - 1];
    if (!item || phase !== "ready") throw new Error("No such saved item on this page.");
    return item;
  };
  const open = (item, autoPlay = Boolean(item.savedVersionId)) => onOpen({ ...item, autoPlay });
  const remove = async (item) => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (kind === "bookmarks") await bookmarkSaved(item.id, false);
      else await personalRequest(`library/${encodeURIComponent(item.videoId)}`, { method: "DELETE" });
      setConfirming(null);
      setMessage(kind === "bookmarks" ? "Bookmark removed." : "Lecture removed from Library. Bookmarks and recordings were kept.");
      await refresh();
      heading.current?.focus();
      notifyPersonal();
    } catch (error) { setMessage(error.message); }
    finally { busy.current = false; }
  };
  useVoiceActions({
    ...(phase === "ready" ? {
      open_item: ({ index }) => open(at(index)),
      play_item_audio: ({ index }) => open(at(index), true),
      read_saved_item: ({ index }) => open(at(index), false),
      remove_item: ({ index }) => remove(at(index)),
    } : {}),
    filter_saved_items: ({ query: text }) => { setQuery(text); setPage(0); },
    clear_saved_filter: () => { setQuery(""); setPage(0); },
    next_saved_page: () => setPage(Math.min(activePage + 1, lastPage)),
    previous_saved_page: () => setPage(Math.max(activePage - 1, 0)),
    retry_saved_load: refresh,
    ...(confirming ? {
      confirm_saved_removal: () => remove(confirming),
      cancel_saved_removal: () => { setConfirming(null); heading.current?.focus(); },
      confirm_yes: () => remove(confirming),
      confirm_no: () => { setConfirming(null); heading.current?.focus(); },
    } : {}),
    ...(kind === "library" ? { set_saved_view: ({ view }) => { setRecent(view === "recent"); setPage(0); } } : {}),
  }, () => ({ pendingConfirmation: confirming ? "confirm_saved_removal" : null,
    confirmationRef: confirming?.id || null,
    items: phase === "ready" ? visible.map((item, index) => ({ ref: item.id, kind: kind === "library" ? "library_item" : "bookmark", label: `${item.videoTitle}: ${item.title}, ${item.mode}`, position: index + 1 })) : [] }));
  let previousVideo = null;
  return <div className="flex h-full bg-background font-sans">
    <nav aria-label="Main navigation"><Sidebar active={kind} onNavigate={onNavigate} /></nav>
    <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-10">
      <h1 ref={heading} tabIndex={-1} className="text-[32px] font-bold">{kind === "library" ? "My Library" : "Bookmarks"}</h1>
      <p role="status" aria-live="polite">{phase === "loading" ? "Loading saved content…" : message || `${filtered.length} saved items. Page ${activePage + 1} of ${lastPage + 1}.`}</p>
      <PersonalImport onImported={refresh} onStatus={setMessage} />
      {kind === "library" && <div role="group" aria-label="Library view" className="flex gap-3 my-3">
        <button className="ds-btn-secondary" aria-pressed={!recent} onClick={() => { setRecent(false); setPage(0); }}>Saved lectures</button>
        <button className="ds-btn-secondary" aria-pressed={recent} onClick={() => { setRecent(true); setPage(0); }}>Recent explanations</button>
      </div>}
      <label className="block">Filter saved items<input className="ds-field w-full my-3" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
      {phase === "error" && <button className="ds-btn-secondary" onClick={refresh}>Retry loading</button>}
      {phase === "ready" && !visible.length && <p>No saved items match this view.</p>}
      {phase === "ready" && visible.map((item, index) => {
        const groupHeading = item.videoId !== previousVideo;
        previousVideo = item.videoId;
        return <div key={item.id}>
          {groupHeading && <h2 className="text-[22px] font-semibold mt-5">{item.videoTitle}</h2>}
          <article aria-label={`${index + 1}. ${item.title}`} className="border border-border-default rounded-radius-md p-4 my-3">
            <h3 className="font-semibold">{index + 1}. {item.title}</h3>
            <p>{item.timestamp} · {item.mode} depth</p>
            {item.savedAt && <p>Saved {new Date(item.savedAt).toLocaleString()}</p>}
            <div className="flex flex-wrap gap-3 mt-2">
              <button className="ds-btn-secondary" aria-label={`${item.savedVersionId ? "Open and play explanation" : "Open lecture"}: ${item.title}, ${item.mode} depth, ${item.videoTitle}`} onClick={() => open(item)}>{item.savedVersionId ? "Open and play explanation" : "Open lecture"}</button>
              {item.savedVersionId && <button className="ds-btn-secondary" aria-label={`Read text: ${item.title}, ${item.mode} depth, ${item.videoTitle}`} onClick={() => open(item, false)}>Read text</button>}
              <button className="ds-btn-text" aria-label={kind === "library" ? `Remove lecture: ${item.videoTitle}` : `Remove bookmark: ${item.title}, ${item.mode} depth`} onClick={() => setConfirming(item)}>{kind === "library" ? "Remove lecture" : "Remove bookmark"}</button>
            </div>
          </article>
        </div>;
      })}
      {confirming && <div role="group" aria-label="Confirm removal" className="p-4 border border-border-default">
        <p>Remove {kind === "library" ? confirming.videoTitle : confirming.title}?</p>
        <button ref={cancel} className="ds-btn-secondary" onClick={() => { setConfirming(null); heading.current?.focus(); }}>Cancel</button>
        <button className="ds-btn-text" onClick={() => remove(confirming)}>Yes, remove</button>
      </div>}
      <nav aria-label="Saved items pages" className="flex gap-3 mt-5">
        <button className="ds-btn-secondary" disabled={!activePage} onClick={() => setPage(activePage - 1)}>Previous page</button>
        <span>Page {activePage + 1} of {lastPage + 1}</span>
        <button className="ds-btn-secondary" disabled={activePage === lastPage} onClick={() => setPage(activePage + 1)}>Next page</button>
      </nav>
    </main>
  </div>;
}
