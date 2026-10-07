import { useState, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import CategoryIcon from "./CategoryIcon";
import { getBookmarks, removeBookmark } from "../storage";

export default function BookmarksScreen({
  onNavigate     = () => {},
  onOpenBookmark = () => {},
}) {
  const [bookmarks, setBookmarks] = useState([]);
  const h1Ref = useRef(null);
  const [removedMessage, setRemovedMessage] = useState("");

  useEffect(() => { setBookmarks(getBookmarks()); }, []);

  const handleRemove = (id) => {
    const removed = bookmarks.find((bm) => bm.id === id);
    removeBookmark(id);
    setBookmarks(getBookmarks());
    // The focused Remove button is about to unmount — land on the heading
    // instead of <body>, and say what happened.
    setRemovedMessage(`Removed ${removed?.title || "bookmark"}.`);
    h1Ref.current?.focus();
  };

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="bookmarks" onNavigate={onNavigate} />
      </nav>

      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
        <div className="max-w-[700px] px-12 py-12">

          <div aria-hidden="true" className="text-[14px] font-medium text-text-secondary mb-3">Bookmarks</div>
          <h1
            ref={h1Ref}
            tabIndex={-1}
            className="text-[32px] font-bold text-text-primary mb-2 outline-none"
          >
            Your saved explanations.
          </h1>
          <div role="status" aria-live="polite" className="sr-only">
            {removedMessage}
          </div>
          <p className="text-[15px] text-text-secondary mb-10">
            {bookmarks.length === 0
              ? "Nothing saved yet. Bookmark any explanation while reading it."
              : `${bookmarks.length} explanation${bookmarks.length === 1 ? "" : "s"} saved.`}
          </p>

          {bookmarks.length === 0 ? (
            <EmptyState
              icon="❏"
              message="Open any explanation and click Bookmark to save it here."
            />
          ) : (
            <div className="space-y-3">
              {bookmarks.map((bm) => (
                <BookmarkCard
                  key={bm.id}
                  bookmark={bm}
                  onOpen={() => onOpenBookmark(bm)}
                  onRemove={() => handleRemove(bm.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── Bookmark card ───────────────────────────────────────────────────────── */

function BookmarkCard({ bookmark, onOpen, onRemove }) {
  const date = new Date(bookmark.savedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <article
      aria-labelledby={`bm-title-${bookmark.id}`}
      className="flex items-start gap-4 p-5 bg-surface border border-border-subtle rounded-radius-md hover:border-border-strong transition-colors"
    >

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1.5 text-[14px]">
          <CategoryIcon category={bookmark.category} className="text-text-muted" />
          <span className="text-text-secondary">
            {capitalize(bookmark.category)}
          </span>
          <span className="text-border-strong">·</span>
          <span className="font-mono tabular-nums text-text-muted">
            {bookmark.timestamp}
          </span>
          <span className="text-border-strong">·</span>
          <span className="text-text-muted truncate">
            {bookmark.videoTitle}
          </span>
        </div>

        <h2
          id={`bm-title-${bookmark.id}`}
          className="text-[17px] font-semibold text-text-primary leading-snug mb-1"
        >
          {bookmark.title}
        </h2>

        {bookmark.explanation?.subtitle && (
          <div className="text-[14px] text-text-secondary leading-relaxed line-clamp-2">
            {bookmark.explanation.subtitle}
          </div>
        )}

        <div className="text-[14px] text-text-muted mt-2">
          Saved {date} · {bookmark.mode} depth
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col items-end gap-2 shrink-0">
        <button
          onClick={onOpen}
          aria-label={`Open ${bookmark.title}`}
          className="ds-btn-secondary"
        >
          Open <span aria-hidden="true">→</span>
        </button>
        <button
          onClick={onRemove}
          aria-label={`Remove ${bookmark.title} from bookmarks`}
          className="ds-btn-text"
        >
          Remove
        </button>
      </div>
    </article>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

function EmptyState({ icon, message }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-muted flex items-center justify-center mb-4">
        <span aria-hidden="true" className="text-text-muted text-lg">{icon}</span>
      </div>
      <p className="text-[14px] text-text-muted max-w-[260px] leading-relaxed">
        {message}
      </p>
    </div>
  );
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}
