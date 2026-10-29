import { useState } from "react";
import { VoiceAudioContext, createVoiceAudioRegistry } from "./voiceAudio.js";
import { VoiceActionsContext, createActionRegistry } from "./voiceActions.js";

// Two registries for the whole app: the audio port (what is playing, pause / restore) and the voice actions
// (what each screen can do). Wraps the navbar, where the talk control lives, and the screens.
export default function VoiceAudioProvider({ children }) {
  const [audio] = useState(createVoiceAudioRegistry);
  const [actions] = useState(createActionRegistry);
  return (
    <VoiceAudioContext.Provider value={audio}>
      <VoiceActionsContext.Provider value={actions}>{children}</VoiceActionsContext.Provider>
    </VoiceAudioContext.Provider>
  );
}
