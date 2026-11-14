import SavedCollection from "./SavedCollection";

export default function BookmarksScreen({ onNavigate, onOpenBookmark }) {
  return <SavedCollection kind="bookmarks" onNavigate={onNavigate} onOpen={onOpenBookmark} />;
}
