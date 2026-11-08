// What the learner can do BY VOICE, offered by whichever screens are open.
//
// Each screen registers the handlers it already has (the same functions its buttons call) and a function that
// describes what is on screen. The command handler merges them, so a spoken command runs existing code and no
// business logic is duplicated. Registration is a plain object (no React state): it never re-renders anything.
//
//   useVoiceActions({ next_moment: () => goNext() }, () => ({ items: [...] }))
//
// Without a provider (tests, flag off) the registry is inert.

import { createContext, useContext, useEffect, useRef } from "react";

export function createActionRegistry() {
  const entries = new Set();
  return {
    register(entry) {
      entries.add(entry);
      return () => entries.delete(entry);
    },
    handlers() {
      const all = {};
      for (const entry of entries) Object.assign(all, entry.handlers());
      return all;
    },
    context() {
      const all = {};
      for (const entry of entries) Object.assign(all, entry.context());
      return all;
    },
  };
}

const INERT = Object.freeze({ register: () => () => {}, handlers: () => ({}), context: () => ({}) });

export const VoiceActionsContext = createContext(INERT);

export function useVoiceActionsRegistry() {
  return useContext(VoiceActionsContext);
}

/** Register handlers (action id -> function(args)) and an optional context describer for this component. */
export function useVoiceActions(handlers = {}, describe = () => ({})) {
  const registry = useContext(VoiceActionsContext);
  const latest = useRef({ handlers, describe });
  useEffect(() => {
    latest.current = { handlers, describe };
  });
  useEffect(
    () => registry.register({ handlers: () => latest.current.handlers, context: () => latest.current.describe() }),
    [registry],
  );
}
