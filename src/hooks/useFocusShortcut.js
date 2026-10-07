import { useEffect } from "react";

// Alt+<letter> jumps focus to a field (used for "search a lecture" on Home and
// the subject pages). Falls back to e.key when e.code is empty, as some
// synthetic / assistive-tech key events leave it blank.
export default function useFocusShortcut(inputRef, letter = "s") {
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const pressed = e.code ? e.code.replace(/^Key/, "").toLowerCase() : e.key?.toLowerCase();
      if (pressed !== letter) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [inputRef, letter]);
}
