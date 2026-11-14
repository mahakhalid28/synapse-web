import SavedCollection from "./SavedCollection";

export default function LibraryScreen({ onNavigate, onOpenExplanation }) {
  return <SavedCollection kind="library" onNavigate={onNavigate} onOpen={onOpenExplanation} />;
}
