# Personal learning storage

Implemented for the backend on this computer, with local accounts and the existing development-profile compatibility mode. There is no account UI yet; see [LOCAL_ACCOUNTS.md](LOCAL_ACCOUNTS.md). Online accounts and cross-device sync remain a later phase.

## User behaviour

- Library groups preserved explanation versions by lecture. Recents shows actual viewing during the last 30 days. Bookmarks require an explicit user action.
- Open and play seeks to the stored video timestamp, pauses video, and plays the preserved explanation. Read text stays paused. Opening a lecture or voice-note time stays paused.
- Saved-content opening never starts inference. Related intervention points are fetched from persisted backend data, with preserved points available if the shared cache has been removed.
- Voice notes are stored in backend-managed files with database metadata. The original recording container is retained. The five-minute recorder limit also has a server-side duration/size check, with 250 ms allowed for a final encoded frame; uploads are limited to 20 MB.
- Notes attach ready saved explanations from the same lecture within an inclusive +/-60 seconds of the recording-start position. No match is valid; saving a note does not generate explanations.
- IndexedDB holds drafts and failed uploads. Recover/retry them explicitly from the browser-save import panel. Successful normal uploads remove the temporary copy after acknowledgement; legacy import deliberately keeps the originals.

## Ownership and file lifetime

`src/lib/personalApi.js` owns personal API requests and restricts phase-one traffic to a loopback backend. `src/lib/backendNotes.js` implements the recorder/store and player seams. `src/storage.js` provides in-memory Sidebar/Home summaries and legacy/mock storage compatibility; new permanent saves are served by backend APIs.

Backend `saved_explanations` rows contain immutable text/context and durable media keys. Bookmark/view timestamps belong to that owner/version. `voice_notes` rows contain recording metadata and a retry operation ID. `voice_note_explanations` pins preserved context. `media_deletions` is a durable deletion outbox.

Removing a lecture from Library retains its bookmarks, recordings and preserved content. Library membership and preserved versions survive shared-cache deletion. Media is never exposed through a public static mount. Personal endpoints remain local-development-only. Account sessions authenticate registered users; the compatibility local profile itself is not authentication.

Upload retries with identical operation ID/content return the committed recording. Different content under the same ID conflicts. Crash leftovers are reconciled at backend startup after a grace period. Failed file deletions remain queued and are retried on startup and note-list access.

## Voice and accessibility

Collection and note actions use the existing voice action registry and the same functions as buttons. Catalog and examples live in backend `voice/catalog/`; `actions.generated.js` is generated with `python -m voice.catalog export-js --out synapse-web/src/voice/actions.generated.js`.

Examples include: open/play/read saved item, filter/clear filter, recent/lecture view, next/previous page, play/stop/delete note, confirm/cancel deletion, open an attached explanation, save/retry/discard a draft, import browser saves and retry loading.

Lists expose at most 60 numbered items per page. A changed positional target is rejected before confirming a removal. Voice playback commands suppress acknowledgement speech and restoration of old media. Notes playback registers with the audio registry so command capture starts quietly.

Existing focus return, keyboard controls, polite status messages, explicit delete confirmations, draft leave guards, pause ownership, and help guards are retained. Full explanation text and the recording clock are not live regions. External screen-reader speech completion cannot be detected reliably; real NVDA and hardware testing remain necessary.

## Packaged Electron

The packaged build serves its own `dist` files at `http://127.0.0.1:5174/index.html`, with browser security and context isolation enabled. The server refuses unexpected hosts, writes and paths outside `dist`. Port collision fails startup instead of attaching to another server. The backend explicitly allows this origin; `Origin: null` remains disallowed.

Previous packaged storage used `file://.../dist/index.html`. A limited preload exposes metadata/audio reads through an IPC handler restricted to the trusted main frame. A hidden, network-disabled utility reads the exact original file URL in the original session. It never upgrades, edits or deletes old storage. The visible import panel uploads one selected legacy recording at a time only after Import is requested. Browser saves on other origins/profiles still require opening the matching origin/profile; the app cannot access another browser profile.

## Operations and validation

Apply backend migration `20261113_0009` using `python -m api.setup`. Stop the API before a coordinated backup: `python -m scripts.backup_learning_storage`. Verify using `python -m scripts.backup_learning_storage --verify <directory>`. Restore both `synapse.db` and `data/` from the same verified backup with the API stopped; preserve the current files before replacement. A destructive migration downgrade is refused until personal data is exported.

Automated checks cover API ownership/origin restrictions, real recording decoding, retry identity, immutable content, context boundaries, backup verification/restore, media cleanup, migration compatibility, saved reopening without inference, pagination/voice targeting, draft recovery, packaged static serving, IPC boundaries and axe accessibility checks. These are not proof of real NVDA, a microphone, or the previous installed packaged profile.
