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
    { key: "home",      label: "Home"      },
    { key: "library",   label: "Library"   },
    { key: "bookmarks", label: "Bookmarks", count: bookmarkCount },
  ];

  return (
    <aside className="w-[200px] h-full bg-surface border-r border-border-default px-5 py-7 flex flex-col shrink-0 font-sans">
      {/* Wordmark block */}
      <div className="pb-6 border-b border-border-default">
        <div className="text-[18px] font-semibold text-text-primary leading-none">
          Synapse
        </div>
      </div>

      {/* Nav */}
      <nav className="mt-6 flex flex-col gap-0.5">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={"ds-nav-item " + (isActive ? "ds-nav-item-active" : "")}
            >
              {isActive && (
                <span aria-hidden="true" className="block w-1 h-4 rounded-full bg-accent-primary shrink-0" />
              )}
              <span className="flex-1 text-left">{item.label}</span>
              {item.count > 0 && (
                <span className="text-[13px] text-text-secondary bg-surface-muted px-2 py-0.5 rounded-full">
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer block — recently processed */}
      <div className="mt-auto pt-6 border-t border-border-default">
        <div className="text-[13px] font-medium text-text-secondary mb-2">Recently processed</div>
        {recentVideo ? (
          <div className="text-[13px] leading-snug">
            <div className="truncate text-text-primary">{recentVideo.title || recentVideo.videoTitle}</div>
            <div className="text-text-muted mt-0.5">
              {new Date(recentVideo.savedAt || recentVideo.processedAt).toLocaleDateString("en-US", {
                month: "short", day: "numeric",
              })}
            </div>
          </div>
        ) : (
          <div className="text-[13px] text-text-muted leading-snug">
            No videos yet.
          </div>
        )}
      </div>
    </aside>
  );
}
