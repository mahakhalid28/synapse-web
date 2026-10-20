// A single polite live-region message, for screens that do not already have one
// (the lecture screen has its own announce() and does not use this).
//
// Clearing first, then setting after a beat, makes a repeated identical message
// ("Finished playing voice note." twice) be spoken again, and the text is
// cleared after it has been spoken so it does not sit in the reading flow.

import { useCallback, useEffect, useRef, useState } from "react";

export function useAnnouncer() {
  const [message, setMessage] = useState("");
  const timer = useRef(null);

  const announce = useCallback((text) => {
    clearTimeout(timer.current);
    setMessage("");
    timer.current = setTimeout(() => {
      setMessage(text);
      timer.current = setTimeout(() => setMessage(""), 5000);
    }, 60);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { message, announce };
}
