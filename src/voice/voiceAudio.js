// How the global voice control reaches the audio of whichever screen is open.
//
// The lecture screen owns the YouTube player, the explanation audio and the pause ownership, so it offers a
// "port" with four small operations. The voice control never touches the player or the audio element
// itself; it only asks the port. On screens with no port (Home, Library, ...) nothing of Synapse's is
// playing, so there is nothing to pause or restore.
//
// A port is { getSnapshot, pause, restore, isNoteBusy }:
//   getSnapshot()  { lecture, explanation, pauseOwner } as described in voiceTurn.decideRestore
//   pause()        pause the lecture and the explanation audio and hand the pause to the learner
//   restore(plan)  put back what decideRestore() said (plan.lecture, plan.explanation, plan.pauseOwner)
//   stopNote()     optional: stop a recording voice note; true when it did (Alt+T then ends the note)
//   isNoteBusy()   true while a voice note is being recorded (the microphone is taken)
//
// The registry is a plain object (no React state) so registering never re-renders anything.

import { createContext, useContext, useEffect, useRef } from "react";

export function createVoiceAudioRegistry() {
  let port = null;
  let turnActive = false;
  return {
    getPort: () => port,
    register(next) { port = next; },
    unregister(current) { if (port === current) port = null; },
    isTurnActive: () => turnActive,
    setTurnActive(active) { turnActive = active === true; },
  };
}

// Without a provider (tests, or the flag off) the registry is inert: no port, no active turn.
const INERT = Object.freeze({
  getPort: () => null,
  register() {},
  unregister() {},
  isTurnActive: () => false,
  setTurnActive() {},
});

export const VoiceAudioContext = createContext(INERT);

export function useVoiceAudio() {
  return useContext(VoiceAudioContext);
}

/**
 * Called by the lecture screen. `methods` is re-read on every call, so it may close over fresh state; the
 * port registered with the registry is created once per mount, which is also how the voice control can tell
 * that the screen it started on is gone.
 */
export function useVoiceAudioPort(methods) {
  const registry = useVoiceAudio();
  const latest = useRef(methods);
  useEffect(() => {
    latest.current = methods;
  });
  useEffect(() => {
    const port = {
      getSnapshot: () => latest.current.getSnapshot(),
      pause: () => latest.current.pause(),
      restore: (plan) => latest.current.restore(plan),
      isNoteBusy: () => latest.current.isNoteBusy?.() === true,
    };
    registry.register(port);
    return () => registry.unregister(port);
  }, [registry]);
}
