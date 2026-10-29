import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted (Fontsource) so the primary UI/reading typeface never depends
// on network access — only the weights actually used by the type scale
// (400/500/600/700) are imported, not the full family. --font-sans/
// --font-mono in index.css are the single place these get wired into the
// rest of the app; nothing else should reference a font name directly.
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/500.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "@fontsource/atkinson-hyperlegible-mono/400.css";
import "@fontsource/atkinson-hyperlegible-mono/500.css";
import "./index.css";
import App from "./App.jsx";
import VoiceAudioProvider from "./voice/VoiceAudioProvider.jsx";

// Apply saved theme before first render to avoid flash
const savedTheme = localStorage.getItem("synapse_theme") || "paper";
document.documentElement.setAttribute("data-theme", savedTheme);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <VoiceAudioProvider>
      <App />
    </VoiceAudioProvider>
  </StrictMode>,
);
