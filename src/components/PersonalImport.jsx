import { useCallback, useEffect, useState } from "react";
import { captureAccount, assertAccount, currentAccount, LOCAL_PROFILE_ID } from "../lib/accountSession";
import * as localNotes from "../lib/notesStore";
import { uploadLocalNote } from "../lib/backendNotes";
import { bookmarkSaved, normalMode, notifyPersonal, personalRequest, preserveExplanation, trackLecture } from "../lib/personalApi";
import { apiUrl } from "../lib/apiConfig";
import { useVoiceActions } from "../voice/voiceActions";

export default function PersonalImport({ onImported = () => {}, onStatus = null }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(null);
  const canReadLegacy = currentAccount().user?.id === LOCAL_PROFILE_ID;
  const legacy = useCallback(() => {
    if (!canReadLegacy) return { library: [], bookmarks: [] };
    const read = (key) => {
      try { const list = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(list) ? list : []; }
      catch { return []; }
    };
    return { library: read("synapse_library"), bookmarks: read("synapse_bookmarks") };
  }, [canReadLegacy]);
  useEffect(() => {
    let alive = true;
    Promise.all([
      localNotes.listAllNotes().catch(() => []),
      (canReadLegacy ? window.synapseLegacyStorage?.list()?.catch((error) => ({ error: error.message })) : null) || Promise.resolve(null),
    ]).then(([notes, previous]) => {
      if (!alive) return;
      const old = legacy();
      setCount(notes.length + old.library.length + old.bookmarks.length +
        (previous?.notes?.length || 0) + (previous?.library?.length || 0) + (previous?.bookmarks?.length || 0) + (previous?.error ? 1 : 0));
      if (previous?.error) { setMessage(previous.error); onStatus?.(previous.error); }
    });
    return () => { alive = false; };
  }, [onStatus, canReadLegacy, legacy]);

  const importAll = async () => {
    if (busy) return;
    setBusy(true);
    const account = captureAccount();
    let saved = 0;
    const errors = [];
    try {
      let previousPackage = null;
      try { previousPackage = await (canReadLegacy ? window.synapseLegacyStorage?.list() : null); }
      catch (error) { errors.push(error.message); }
      const notes = await localNotes.listAllNotes().catch(() => []);
      for (const note of notes) {
        try { const audio = await localNotes.getNoteAudio(note.id); assertAccount(account); await uploadLocalNote({ ...note, ownerId: account.user.id }, audio); saved++; }
        catch (error) { errors.push(error.message); }
      }
      for (const note of previousPackage?.notes || []) {
        try {
          const bytes = await window.synapseLegacyStorage.audio(note.id);
          assertAccount(account);
          await uploadLocalNote({ ...note, ownerId: account.user.id }, new Blob([bytes], { type: note.mimeType }));
          saved++;
        } catch (error) { errors.push(error.message); }
      }
      const old = legacy();
      old.library.push(...(previousPackage?.library || []));
      old.bookmarks.push(...(previousPackage?.bookmarks || []));
      for (const [items, isBookmark] of [[old.library, false], [old.bookmarks, true]]) {
        for (const item of items) {
          try {
            const response = await fetch(apiUrl(`/video/intervention/${encodeURIComponent(item.pointId)}/explanation?output_mode=${normalMode(item.mode)}`));
            if (!response.ok) throw new Error("An original explanation is unavailable. Its browser copy is retained.");
            const source = await response.json();
            const text = source.text_explanation || "";
            const fragments = [...(item.explanation?.paragraphs || []), item.explanation?.keyInsight].filter(Boolean);
            if (!source.explanation_id || fragments.some((part) => !text.replace(/\s+/g, " ").includes(part.replace(/\s+/g, " ")))) {
              throw new Error("An original explanation has changed. Its browser copy is retained.");
            }
            assertAccount(account);
            const entry = await preserveExplanation(source.explanation_id);
            assertAccount(account);
            await trackLecture(item.videoId);
            assertAccount(account);
            if (isBookmark) await bookmarkSaved(entry.id, true);
            else await personalRequest(`saved-explanations/${entry.id}/viewed`, { method: "PUT" });
            saved++;
          } catch (error) { errors.push(error.message); }
        }
      }
      const resultMessage = `${saved} entries saved or already present. Original browser copies were kept.${errors.length ? ` ${errors.length} could not be imported. ${errors[0]}` : ""}`;
      setMessage(resultMessage);
      onStatus?.(resultMessage);
      notifyPersonal();
      onImported();
    } finally { setBusy(false); }
  };
  useVoiceActions(!busy && count > 0 ? { import_local_saves: importAll } : {});
  if (!count) return null;
  return <section aria-label="Recover browser saves" className="mb-5 p-4 border border-border-default rounded-radius-md">
    <h2 className="text-[18px] font-semibold">Browser saves and recording drafts</h2>
    <p>{count} browser entries can be imported into Synapse storage on this computer. Existing copies will be kept. Failed uploads can be retried here.</p>
    <button className="ds-btn-secondary mt-2" disabled={busy} onClick={importAll}>{busy ? "Importing…" : "Import or retry browser saves"}</button>
    <p role={onStatus ? undefined : "status"} aria-live={onStatus ? undefined : "polite"} aria-hidden={onStatus ? true : undefined}>{message}</p>
  </section>;
}
