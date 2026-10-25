// Wording for onboarding. Plain text only, no JSX (same idea as quizText.js).
// Shortcut keys are never retyped here: they come from lib/shortcuts.js.
//
// MODE_COPY holds the names of the two EXISTING presentation modes and the short descriptions the Help
// dialog shows. WELCOME_MODE_DESCRIPTIONS (below) are the longer descriptions shown on the Welcome
// screen only; Help is unchanged by them. Each clause of both was checked against Explanation.jsx:
// Accessibility mode hides the video (audio keeps playing), moves focus to the explanation and lists
// every moment; Study mode shows the video and adds text size and contrast controls (not saved between
// sessions), a structured view only where a moment has one, and the full timeline.

import { HOME_SHORTCUT_ROWS, LECTURE_SHORTCUT_ROWS, keysForAction, rowKeys } from "./shortcuts.js";

export const MODE_COPY = {
  accessibility: {
    label: "Accessibility mode",
    description:
      "The video is hidden but its audio still plays. Focus moves to each explanation, and every moment is listed.",
  },
  study: {
    label: "Study mode",
    description:
      "The video is shown. Adds text size and contrast controls (not saved), a structured view where available, and the full timeline.",
  },
};

export const MODE_ORDER = ["accessibility", "study"];

// Shown under each mode button on Welcome and read as that button's description (aria-describedby).
// Verified against the implementation: the video is hidden but plays in Accessibility mode, moments are
// listed and navigable, focus moves to each explanation; Study mode shows the video and has the
// Text size and High contrast controls, a Structured View tab only for moments that have one, and
// "View full timeline".
export const WELCOME_MODE_DESCRIPTIONS = {
  accessibility:
    "Listen to the lecture and follow AI explanations of important diagrams, equations, and charts. The video stays hidden while you navigate lecture moments and focus on the explanations using accessible controls.",
  study:
    "Watch the lecture while Synapse pauses at important visual content and explains it. Adjust text size and contrast, explore structured views when available, and use the full lecture timeline.",
};

export const WELCOME_TITLE = "Welcome to Synapse";
export const WELCOME_INTRO =
  "Synapse plays a YouTube lecture and pauses at diagrams, equations and charts to explain them. You can listen, read or watch.";
export const WELCOME_MODE_HEADING = "How do you want to follow lectures?";
export const WELCOME_SWITCH_NOTE =
  "You can switch at any time on the lecture screen. Nothing plays until you choose a lecture.";
export const WELCOME_EXISTING_NOTE = "Already use Synapse? You can skip this.";
export const WELCOME_GET_STARTED = "Get started";
export const WELCOME_CONTINUE = "Continue";
export const WELCOME_SKIP = "Skip for now";
export const WELCOME_HELP = "How Synapse works";

// Spoken and shown when the chosen mode could not be written to storage. It does not say which mode
// lectures will use, because that depends on what was saved before.
export const WELCOME_SAVE_FAILED =
  "Couldn't save your choice. You can switch modes on the lecture screen. Press Continue to go on.";

// ── Help ─────────────────────────────────────────────────────────────────────

export const HELP_TITLE = "How Synapse works";
export const HELP_CLOSE = "Close";

// Said (on the screen that stayed put) when Help is refused because a voice note is being recorded.
export const HELP_BLOCKED_RECORDING =
  `Help isn't available while you record a voice note. Stop with ${keysForAction("voiceNote")} or the Stop recording button, then open Help.`;

/**
 * What Help did to playback when it opened. Shown inside the dialog and read as its description,
 * because the screen behind a modal dialog is inert and its live regions are not announced.
 *   paused:      null | "lecture" | "both" (lecture and explanation audio)
 *   stoppedNote: a voice note was playing and was stopped
 * Returns "" when Help changed nothing.
 */
export function helpOpenNotice({ paused = null, stoppedNote = false } = {}) {
  const parts = [];
  if (paused === "both") parts.push("Lecture and explanation audio paused while Help is open.");
  else if (paused === "lecture") parts.push("Lecture paused while Help is open.");
  if (stoppedNote) parts.push("Voice note stopped while Help is open.");
  return parts.join(" ");
}

/** The announcement when Help closes, only if it had paused or stopped something. "" otherwise. */
export function helpClosedNotice({ paused = null, stoppedNote = false } = {}) {
  const parts = [];
  if (paused) parts.push("Playback is still paused.");
  if (stoppedNote) parts.push("Voice note stopped.");
  return parts.length ? `Help closed. ${parts.join(" ")}` : "";
}

/** The Help sections in reading order. Practice questions appear only when that feature is on. */
export function getHelpSections({ practice = false } = {}) {
  const sections = [
    {
      id: "what",
      heading: "What Synapse does",
      paragraphs: [
        "Synapse plays a YouTube lecture and pauses at diagrams, equations and charts to explain them in text and audio.",
      ],
    },
    {
      id: "modes",
      heading: "Two ways to follow a lecture",
      paragraphs: [
        ...MODE_ORDER.map((mode) => `${MODE_COPY[mode].label}: ${MODE_COPY[mode].description}`),
        "Switch any time with the Presentation mode buttons on the lecture screen.",
      ],
    },
    {
      id: "start",
      heading: "Starting a lecture",
      paragraphs: ["On Home, paste a YouTube link or search, then choose a result."],
    },
    {
      id: "shortcuts",
      heading: "Keyboard shortcuts",
      groups: [
        { heading: "Home and subject pages", rows: HOME_SHORTCUT_ROWS },
        { heading: "Lecture screen", rows: LECTURE_SHORTCUT_ROWS },
      ].map((group) => ({
        heading: group.heading,
        items: group.rows.map((row) => ({ keys: rowKeys(row), description: row.description })),
      })),
      paragraphs: [
        "On the lecture screen, shortcuts are ignored while you type in a text box such as the Ask box.",
      ],
    },
    {
      id: "during",
      heading: "During a lecture",
      paragraphs: [
        `When the lecture pauses, the explanation audio may start by itself if it is ready. After it finishes, the lecture resumes by itself. Press the Listen button (${keysForAction("listen")}) to pause or replay it.`,
      ],
    },
    {
      id: "notes",
      heading: "Voice notes",
      paragraphs: [
        `${keysForAction("voiceNote")} records a note at the current moment. The lecture pauses and stays paused. Notes stay on this computer.`,
      ],
    },
  ];
  if (practice) {
    sections.push({
      id: "practice",
      heading: "Practice questions",
      paragraphs: ["Choose Practice this lecture below the explanation."],
    });
  }
  sections.push(
    {
      id: "appearance",
      heading: "Appearance",
      paragraphs: ["Open Settings (the gear) to switch between Paper, Night and Sepia."],
    },
    {
      id: "data",
      heading: "Your data",
      paragraphs: [
        "Library, bookmarks, voice notes and settings are stored on this computer. Lecture links you start and questions you ask are sent to the Synapse server. Voice notes never leave this computer.",
      ],
    },
  );
  return sections;
}

// ── First-lecture guide card ─────────────────────────────────────────────────

export const GUIDE_TITLE = "How this lecture works";
export const GUIDE_GOT_IT = "Got it";
export const GUIDE_OPEN_HELP = "Open Help";
export const GUIDE_DISMISSED = "Guide hidden. Help has the same information.";

/** The three steps of the card. Only the first differs by mode: the video is hidden in Accessibility mode. */
export function getGuideSteps(mode) {
  const play = keysForAction("playPause");
  return [
    mode === "study"
      ? `Press play on the video, or ${play}, to begin.`
      : `Press Play lecture (${play}) to begin.`,
    `Synapse pauses at each diagram, equation or chart and shows the explanation. The explanation audio may start by itself when it is ready. Press the Listen button (${keysForAction("listen")}) to pause or replay it.`,
    `Press ${keysForAction("hearShortcuts")} to hear all keyboard shortcuts.`,
  ];
}
