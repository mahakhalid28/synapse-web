import { useState, useEffect } from "react";
import { getBookmarks, getLibrary } from "../storage";

export default function Sidebar({ active = "home", onNavigate = () => {} }) {
  const [bookmarkCount, setBookmarkCount] = useState(0);
  const [recentVideo, setRecentVideo]     = useState(null);

  useEffect(() => {
    setBookmarkCount(getBookmarks().length);
    const lib = getLibrary();
    if (lib.length > 0) setRecentVideo(lib[0]);
  }, [active]); // re-read when active screen changes (user may have added items)

  // "Settings" deliberately isn't a nav item here — App.jsx's screen list
  // (CLAUDE.md) never included a "settings" screen, and Navbar's gear icon
  // already provides the one working Settings entry point (appearance/
  // theme). A second, identically-labeled item here that didn't do
  // anything was a confirmed dead click, not a missing feature.
  const items = [
    { key: "home",      label: "Home",      Icon: HomeIcon },
    { key: "library",   label: "Library",   Icon: LibraryIcon },
    { key: "bookmarks", label: "Bookmarks", Icon: BookmarkIcon, count: bookmarkCount },
  ];

  return (
    <div className="w-[200px] h-full bg-surface border-r border-border-subtle px-5 py-7 flex flex-col shrink-0 font-sans">
      {/* Wordmark block */}
      <div className="pb-6 border-b border-border-subtle">
        <div className="text-[18px] font-semibold text-text-primary leading-none">
          Synapse
        </div>
      </div>

      {/* Nav items — a plain div, not a second <nav>: the parent screen
        already wraps this whole Sidebar in <nav aria-label="Main
        navigation">, so an inner, unlabeled <nav> here would register as a
        second, confusingly-identical navigation landmark nested inside the
        first for screen-reader users browsing by landmark. */}
      <div className="mt-6 flex flex-col gap-0.5">
        {items.map(({ key, label, Icon, count }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              aria-current={isActive ? "page" : undefined}
              className={"ds-nav-item " + (isActive ? "ds-nav-item-active" : "")}
            >
              {/* Always occupies the same slot (active or not) so the
                label never shifts position when the active state changes —
                only its fill color toggles. */}
              <span
                aria-hidden="true"
                className={"block w-1 h-5 rounded-full shrink-0 " + (isActive ? "bg-accent" : "bg-transparent")}
              />
              <Icon />
              <span className="flex-1 text-left">{label}</span>{" "}
              {count > 0 && (
                <span className="text-[14px] text-text-secondary bg-surface-muted px-2 py-0.5 rounded-radius-sm">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer block — recently processed */}
      <div className="mt-auto pt-6 border-t border-border-subtle">
        <div className="text-[14px] font-medium text-text-secondary mb-2">Recently processed</div>
        {recentVideo ? (
          <div className="text-[14px] leading-snug">
            <div className="truncate text-text-primary">{recentVideo.title || recentVideo.videoTitle}</div>
            <div className="text-text-muted mt-0.5">
              {new Date(recentVideo.savedAt || recentVideo.processedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric",
              })}
            </div>
          </div>
        ) : (
          <div className="text-[14px] text-text-muted leading-snug">
            No videos yet.
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Nav icons — neutral, currentColor (inherit the active-item accent
   color automatically), aria-hidden since the adjacent text label is what
   actually gets announced. Support the label; never replace it. ── */

function HomeIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M2 7.3 L8 2.5 L14 7.3" />
      <path d="M3.4 6.3 V13 a1 1 0 0 0 1 1 H11.6 a1 1 0 0 0 1-1 V6.3" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="2.8" y="2.6" width="10.4" height="3" rx="0.6" />
      <rect x="2.8" y="6.5" width="10.4" height="3" rx="0.6" />
      <rect x="2.8" y="10.4" width="10.4" height="3" rx="0.6" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M4 2.5 H12 V13.5 L8 10.8 L4 13.5 Z" />
    </svg>
  );
}
