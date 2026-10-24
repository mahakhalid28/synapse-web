import { useState, useEffect, useRef } from "react";
import Sidebar from "./Sidebar";
import CategoryIcon from "./CategoryIcon";
import { getLibrary, removeFromLibrary } from "../storage";

export default function LibraryScreen({
  onNavigate = () => {},
  onOpenExplanation = () => {},
}) {
  const [library, setLibrary] = useState([]);
  const [search, setSearch] = useState("");
  const h1Ref = useRef(null);
  const [removedMessage, setRemovedMessage] = useState("");

  useEffect(() => {
    setLibrary(getLibrary());
  }, []);

  const query = search.toLowerCase().trim();
  const visible = query
    ? library.filter(
        (item) =>
          (item.title || "").toLowerCase().includes(query) ||
          (item.videoTitle || "").toLowerCase().includes(query) ||
          (item.category || "").toLowerCase().includes(query),
      )
    : library;

  // Where focus goes once the removed card (and its focused Remove button)
  // has unmounted: the neighbouring card's Remove button, so the learner
  // keeps their place in the list; the heading only when nothing is left.
  const pendingFocusRef = useRef(null);
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    if (target === "heading") h1Ref.current?.focus();
    else document.getElementById(`lib-remove-${target}`)?.focus();
  }, [library]);

  const handleRemove = (id) => {
    const removed = library.find((item) => item.id === id);
    const at = visible.findIndex((item) => item.id === id);
    const neighbour = visible[at + 1] ?? visible[at - 1];
    pendingFocusRef.current = neighbour ? neighbour.id : "heading";
    removeFromLibrary(id);
    const remaining = getLibrary();
    setLibrary(remaining);
    setRemovedMessage(
      `Removed ${removed?.title || "explanation"} from your library. ${
        remaining.length === 0
          ? "Your library is now empty."
          : `${remaining.length} left.`
      }`,
    );
  };

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="library" onNavigate={onNavigate} />
      </nav>

      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto outline-none">
        <div className="max-w-[680px] px-10 py-12">
          {/* ── Header ── */}
          <h1
            ref={h1Ref}
            tabIndex={-1}
            className="text-[32px] font-bold text-text-primary mb-6 outline-none"
          >
            My Library
          </h1>
          <div role="status" aria-live="polite" className="sr-only">
            {removedMessage}
          </div>

          {/* ── Search ── */}
          <div className="mb-8">
            <label htmlFor="library-search" className="block text-[14px] font-medium text-text-secondary mb-2">
              Filter by topic or video title
            </label>
            <div className="ds-field">
              <span aria-hidden="true" className="text-text-muted shrink-0">
                <SearchIcon />
              </span>
              <input
                id="library-search"
                type="text"
                placeholder="Filter by topic or video title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="flex-1 bg-transparent text-[16px] text-text-primary placeholder:text-text-muted outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="text-text-muted hover:text-text-primary text-lg leading-none shrink-0 focus-ring rounded-radius-sm"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {/* ── Section label — a real h2 (not a styled div), closing a
          pre-existing h1→h3 heading-order gap surfaced by this phase's axe
          scan (ExplanationCard's title is an h3; nothing filled the h2
          slot before). */}
          {library.length > 0 && (
            <div className="flex items-center gap-3 mb-5">
              <h2 className="text-[14px] font-medium text-text-primary">
                Recent Explanations
              </h2>
              <span className="ds-chip">
                {library.length}
              </span>
            </div>
          )}

          {/* ── List ── */}
          {library.length === 0 ? (
            <EmptyState />
          ) : visible.length === 0 ? (
            <p className="text-[14px] text-text-muted mt-2">
              No results for &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <div className="space-y-3">
              {visible.map((item) => (
                <ExplanationCard
                  key={item.id}
                  item={item}
                  onReadText={() =>
                    onOpenExplanation({ ...item, autoPlay: false })
                  }
                  onPlayAudio={() =>
                    onOpenExplanation({ ...item, autoPlay: true })
                  }
                  onRemove={() => handleRemove(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── Compact horizontal card ─────────────────────────────────────────────── */

function ExplanationCard({ item, onReadText, onPlayAudio, onRemove }) {
  const thumbnailUrl =
    item.videoThumbnail ||
    (item.videoId ? `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg` : null);
  const dateStr = item.savedAt
    ? new Date(item.savedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <article
      aria-labelledby={`lib-title-${item.id}`}
      className="flex gap-4 p-4 bg-surface border border-border-subtle rounded-radius-md hover:border-border-strong transition-colors group"
    >
      {/* Thumbnail — small, fixed width */}
      <div className="w-[120px] shrink-0 aspect-video rounded-radius-md overflow-hidden bg-gradient-to-br from-[#3B4870] to-[#8B6B4A] relative">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )}
        {/* Timestamp chip */}
        <div className="absolute bottom-1 right-1 font-mono tabular-nums text-[14px] bg-black/75 text-white px-1.5 py-0.5 rounded-sm">
          {item.timestamp}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Category + date */}
        <div className="flex items-center gap-1.5 mb-1 text-[14px]">
          <CategoryIcon category={item.category} className="text-text-muted" />
          <span className="font-medium text-text-secondary">
            {capitalize(item.category)}
          </span>
          <span className="text-border-strong">·</span>
          <span className="text-text-muted">
            {dateStr}
          </span>
          {/* Remove button — visible on hover AND keyboard focus (never
          hover-only), with a real accessible name since "×" alone isn't
          announced usefully. */}
          <button
            id={`lib-remove-${item.id}`}
            onClick={onRemove}
            aria-label={`Remove ${item.title} from library`}
            className="ml-auto text-text-muted hover:text-text-primary text-[14px] leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity focus-ring rounded-radius-sm"
          >
            ×
          </button>
        </div>

        {/* Title */}
        <h3
          id={`lib-title-${item.id}`}
          className="text-[15px] font-semibold text-text-primary leading-snug line-clamp-2 mb-1"
        >
          {item.title}
        </h3>

        {/* Video title */}
        <p className="text-[14px] text-text-muted truncate mb-3">
          {item.videoTitle}
        </p>

        {/* Buttons — neither is "the" primary action for every row in a
        list, so both stay off the filled-accent treatment (avoids a
        column of competing accent buttons); Play audio gets the
        accent-outline variant the spec reserves for Listen-like actions. */}
        <div className="flex gap-2 mt-auto">
          <button
            onClick={onReadText}
            aria-label={`Read text: ${item.title}${item.videoTitle ? `, from ${item.videoTitle}` : ""}`}
            className="ds-btn-secondary"
          >
            <DocIcon />
            Read text
          </button>
          <button
            onClick={onPlayAudio}
            aria-label={`Play audio: ${item.title}${item.videoTitle ? `, from ${item.videoTitle}` : ""}`}
            className="ds-btn-accent-outline"
          >
            <PlayIcon />
            Play audio
          </button>
        </div>
      </div>
    </article>
  );
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-muted flex items-center justify-center mb-4">
        <span aria-hidden="true" className="text-text-muted text-lg">▶</span>
      </div>
      <p className="text-[14px] text-text-muted max-w-[260px] leading-relaxed">
        Open any lecture and the explanations you view will be saved here
        automatically.
      </p>
    </div>
  );
}

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/* ── Icons — all decorative/aria-hidden; the buttons/fields that use them ── */
/* ── carry their own visible text label or accessible name.             ── */

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="6.5" cy="6.5" r="4.5" />
      <line x1="10" y1="10" x2="14" y2="14" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2h6l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
      <polyline points="10,2 10,5 13,5" />
      <line x1="5" y1="9" x2="11" y2="9" />
      <line x1="5" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="7" />
      <polygon
        points="6.5,5.5 11.5,8 6.5,10.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
