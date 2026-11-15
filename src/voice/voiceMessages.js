// Words the assistant says. English only for now: a new language adds a table here (or a file per language),
// nothing else changes. Phrases are verb phrases so one table serves both "Okay, open your bookmarks." and
// "Do you want to open your bookmarks?".

import { autoListenEnabled } from "./voicePrefs.js";

/** How to answer a question Synapse just asked: after the tone when it listens by itself, else with Space. */
export function answerHint() {
  return autoListenEnabled() ? "Answer after the tone." : "Press Space to answer.";
}

const SCREEN_NAMES = { explanation: "lecture", home: "home", subject: "subject", timeline: "timeline", bookmarks: "bookmarks", library: "library", notes: "voice notes", quiz: "practice" };

const SCREEN_DESCRIPTIONS = {
  home: "the home screen. Paste a YouTube link or search for a lecture",
  subject: "a subject's lecture list",
  explanation: "the lecture screen",
  timeline: "the timeline of moments in this lecture",
  bookmarks: "your bookmarks",
  library: "your library of explanations",
  notes: "your voice notes",
  quiz: "the practice screen",
};

export const MESSAGES = {
  heardNothing: "I didn't hear anything.",
  offline: "I can't reach the Synapse server, so voice commands aren't available right now.",
  notUnderstood: "Sorry, I didn't understand that. Say help to hear what you can ask.",
  unavailable: "That isn't available on this screen.",
  failed: "Sorry, that didn't work.",
  okay: "Okay.",
  cancelled: "Okay, cancelled.",
  nothingToConfirm: "There is nothing to confirm.",
  nothingToRepeat: "I haven't said anything yet.",
  noLecture: "Open a lecture first, then ask your question.",
  checking: "Let me check the lecture.",
  appQuestionUnknown: "I'm not sure how to do that by voice. Say help to hear what you can ask on this screen.",
  appHowTo: (phrase) => `Yes, you can do that by voice. Press Space and ask me to ${phrase}.`,
  appElsewhere: (phrase, screens) => `That works on the ${screens.map((s) => SCREEN_NAMES[s] ?? s).join(" or ")} screen. There, press Space and ask me to ${phrase}.`,
  confirmPrompt: (phrase) => autoListenEnabled()
    ? `Do you want to ${phrase}? Say yes or no after the tone.`
    : `Do you want to ${phrase}? Press Space and say yes or no.`,
};

const SPOKEN_SYMBOLS = { _: "underscore", ".": "dot", "-": "dash" };

/** "maha_22" -> "m, a, h, a, underscore, 2, 2": spelled back so the learner can check what was typed. */
export function spellOut(text) {
  return Array.from(String(text)).map((ch) => SPOKEN_SYMBOLS[ch] ?? ch).join(", ");
}

const PHRASES = {
  navigate_home: () => "go to the home screen",
  navigate_library: () => "open your library",
  navigate_bookmarks: () => "open your bookmarks",
  navigate_notes: () => "open your voice notes",
  open_timeline: () => "open the timeline",
  start_practice: () => "start the practice quiz",
  set_theme: (a) => `switch to the ${a.theme} theme`,
  search_lectures: (a) => `search for ${a.query}`,
  select_result: (a) => `choose result ${a.index}`,
  next_results_page: () => "show the next page of results",
  previous_results_page: () => "show the previous page of results",
  start_lecture: () => "start this lecture",
  explore_subject: (a) => `browse ${a.subject} lectures`,
  continue_lecture: () => "continue your last lecture",
  play_lecture: () => "play the lecture",
  pause_lecture: () => "pause the lecture",
  seek_lecture: (a) => `go ${a.direction} ${a.seconds} seconds`,
  play_explanation: () => "play the explanation",
  pause_explanation: () => "pause the explanation",
  replay_explanation: () => "replay the explanation",
  next_moment: () => "go to the next moment",
  previous_moment: () => "go to the previous moment",
  go_to_moment: (a) => `go to moment ${a.index}`,
  change_listening_speed: (a) => `make the explanation ${a.direction}`,
  toggle_voice_note: () => "use voice notes",
  toggle_bookmark: () => "change the bookmark",
  export_pdf: () => "export a PDF",
  set_presentation_mode: (a) => `switch to ${a.mode} mode`,
  change_text_size: (a) => `make the text ${a.change}`,
  toggle_high_contrast: () => "toggle high contrast",
  open_item: (a) => `open item ${a.index}`,
  play_item_audio: (a) => `play item ${a.index}`,
  remove_item: (a) => `remove item ${a.index}`,
  paste_url: () => "paste the link from your clipboard",
  skip_explanation: () => "skip the explanation",
  retry_explanation: () => "try the explanation again",
  set_visual_tab: (a) => `show the ${a.tab} view`,
  toggle_focus: () => "toggle the highlighted area",
  export_audio: () => "download the audio",
  open_settings: () => "open the settings",
  close_settings: () => "close the settings",
  where_am_i: () => "say where you are",
  filter_moments: (a) => (a.category === "all" ? "show all the moments" : `show only the ${a.category} moments`),
  open_moment: (a) => (a.index ? `open moment ${a.index} in the lecture` : "open the selected moment in the lecture"),
  read_moments: () => "read the moments",
  describe_moment: () => "say which moment is selected",
  quiz_start: (a) => `start ${a.count ? `${a.count} ` : ""}${a.mode === "assessment" ? "assessment" : "practice"} questions`,
  get_started: () => "get started",
  skip_onboarding: () => "skip the introduction",
  fill_username: (a) => (a.name
    ? `set the username to ${spellOut(a.name)}. Now type your password, then press Enter`
    : "type your username"),
  open_signup: () => "go to create an account",
  open_login: () => "go to sign in",
  quiz_answer: (a) => `choose answer ${a.index}`,
  quiz_check: () => "check your answer",
  quiz_hint: () => "give you a hint",
  quiz_read: () => "read the question",
  quiz_next: () => "go to the next question",
  quiz_previous: () => "go to the previous question",
  quiz_review: () => "open the review page",
  quiz_submit: () => "submit your answers",
  quiz_back: () => "go back to the lecture",
};

/** "Where am I?": the screen's name, how many things are listed, and where to go for more. */
export function whereAmI(screen, itemCount = 0) {
  const name = SCREEN_DESCRIPTIONS[screen] ?? "Synapse";
  const items = itemCount > 0 ? ` ${itemCount} ${itemCount === 1 ? "item is" : "items are"} listed; say a number to pick one.` : "";
  return `You are on ${name}.${items} Say help to hear what you can ask.`;
}

export function actionPhrase(action, args = {}) {
  return PHRASES[action] ? PHRASES[action](args) : action.replace(/_/g, " ");
}

const MISSING = {
  missing_index: "Which one? Say a number, like the second one.",
  missing_query: "What should I search for?",
  missing_seconds: "How many seconds?",
  missing_direction: "Which direction?",
  missing_theme: "Which theme: paper, night or sepia?",
  missing_mode: "Accessibility mode or study mode?",
  missing_subject: "Which subject?",
  missing_category: "Which kind: graphs, equations, charts, diagrams, code or tables?",
  missing_name: "What is your username? Say my username is, and then spell it letter by letter.",
};

/** Text for an unsupported / missing-detail response, from its message key. */
export function missingMessage(messageKey) {
  return MISSING[messageKey] ?? (messageKey?.startsWith("missing_") ? "I need a bit more detail." : MESSAGES.notUnderstood);
}

// ── Reading lists aloud ──────────────────────────────────────────────────────
// A few items at a time, each with the number the learner says to choose it, then how to go on.

export const LIST_PAGE_SIZE = 3;

const LIST_NOUNS = {
  home: ["result", "results"], subject: ["lecture", "lectures"], library: ["saved item", "saved items"],
  bookmarks: ["bookmark", "bookmarks"], notes: ["voice note", "voice notes"],
};
const CHOOSE_HINT = {
  home: "say choose, and its number", subject: "say choose, and its number",
  library: "say open, and its number", bookmarks: "say open, and its number", notes: "say open, and its number",
};

/** One page of a list starting at index `start`: "There are 8 results. 1: ... 2: ... 3: ... ..." */
export function listPage(screen, items, start = 0, size = LIST_PAGE_SIZE) {
  if (!items?.length) return "There is nothing listed here yet.";
  const [one, many] = LIST_NOUNS[screen] ?? ["item", "items"];
  const hint = CHOOSE_HINT[screen] ?? "say its number";
  const end = Math.min(start + size, items.length);
  const head = start === 0 ? `There ${items.length === 1 ? "is 1" : `are ${items.length}`} ${items.length === 1 ? one : many}. ` : "";
  const body = items.slice(start, end)
    .map((item, offset) => `${item.position ?? start + offset + 1}: ${String(item.label || "Untitled").replace(/[.\s]+$/, "")}.`)
    .join(" ");
  const tail = end < items.length
    ? ` To choose one, ${hint}. Or say read more.`
    : ` ${start > 0 ? "That is the end of the list. " : ""}To choose one, ${hint}.`;
  return head + body + tail;
}

const HELP = {
  home: "You can say: search for lectures on physics, read the results, choose the second one, start the lecture, open my bookmarks, or switch to night mode.",
  explanation:
    "You can say: play or pause the lecture, listen to the explanation, next moment, go back thirty seconds, bookmark this, read faster, how many explanations are ready, or ask a question about the lecture.",
  welcome: "You can say: accessibility mode, study mode, get started, or skip the introduction.",
  login: "You can say: my username is, and then spell it. Then type your password and press Enter. You can also say create an account.",
  signup: "You can say: my username is, and then spell it. Then type a password of at least 8 characters and press Enter. You can also say I already have an account.",
  quiz: "You can say: start an assessment with eight questions, give me practice questions, option two, check my answer, read the question, or next question.",
  default: "You can say: go home, open my library, open my bookmarks, or switch to night mode.",
};

export function helpText(screen) {
  if (screen === "home" || screen === "subject") return HELP.home;
  return HELP[screen] ?? HELP.default;
}

// ── Screen introductions ─────────────────────────────────────────────────────
// Spoken when a screen opens, so a learner who cannot see it knows where they are and what to say next,
// without a screen reader. `first` is the full version for a first visit; later visits get the short one.
// Counts come from the items the screen registered for voice; 0 means "unknown or empty", so it is not said.

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const SCREEN_INTROS = {
  welcome: {
    first: () => "Welcome to Synapse. First, choose how you want to learn. Accessibility mode hides the video and keeps the lecture audio. Study mode shows the video. Press Space and say accessibility mode or study mode, then say get started. You can press Space to talk to me on every screen.",
    short: () => "Welcome to Synapse. Press Space and say accessibility mode or study mode, then get started.",
  },
  login: {
    first: () => "Sign in to Synapse. Press Space and say my username is, and then spell it. Then type your password and press Enter. Your password is never taken by voice. To make a new account, say create an account.",
    short: () => "Sign in. Press Space and say your username, then type your password and press Enter.",
  },
  signup: {
    first: () => "Create a Synapse account. Press Space and say my username is, and then spell it. Then type a password of at least 8 characters and press Enter. Your password is never taken by voice. If you already have an account, say I already have an account.",
    short: () => "Create account. Say your username, then type a password and press Enter.",
  },
  restoring: {
    first: () => "Checking your saved session. Please wait.",
    short: () => "Checking your saved session.",
  },
  home: {
    first: () => "Home. Synapse turns lecture videos into spoken explanations. Press Space and say search for a topic, like search for photosynthesis, or say paste the link to use a copied YouTube link. Say help at any time to hear what you can say.",
    short: () => "Home. Press Space and say search, or help.",
  },
  subject: {
    first: (n) => `Subject lectures.${n ? ` ${count(n, "lecture is", "lectures are")} listed.` : ""} Press Space and say read the results, or choose the first one, then start learning. Or say go home.`,
    short: (n) => `Subject lectures.${n ? ` ${count(n, "lecture", "lectures")}.` : ""}`,
  },
  explanation: {
    first: () => "Lecture screen. The lecture pauses at each important moment and offers a spoken explanation. Press Space and say play the lecture, pause, explain this part, or help.",
    short: () => "Lecture screen.",
  },
  timeline: {
    first: (n) => `Timeline of this lecture's moments.${n ? ` ${count(n, "moment is", "moments are")} listed.` : ""} Press Space and say read the list, or go to moment two.`,
    short: (n) => `Timeline.${n ? ` ${count(n, "moment", "moments")}.` : ""}`,
  },
  bookmarks: {
    first: (n) => `Bookmarks, the explanations you saved.${n ? ` ${count(n, "bookmark is", "bookmarks are")} listed. Press Space and say read my saved items, or open the first one.` : " Press Space and say go home to find a lecture."}`,
    short: (n) => `Bookmarks.${n ? ` ${count(n, "bookmark", "bookmarks")}.` : ""}`,
  },
  library: {
    first: (n) => `Library, the explanations you listened to before.${n ? ` ${count(n, "item is", "items are")} listed. Press Space and say read my saved items, or play the audio of the first item.` : " Press Space and say go home to find a lecture."}`,
    short: (n) => `Library.${n ? ` ${count(n, "item", "items")}.` : ""}`,
  },
  notes: {
    first: (n) => `Voice notes, the recordings you made during lectures.${n ? ` ${count(n, "note is", "notes are")} listed. Press Space and say what is in this list, or open the first one.` : " You have not recorded any yet; on the lecture screen, say record a voice note."}`,
    short: (n) => `Voice notes.${n ? ` ${count(n, "note", "notes")}.` : ""}`,
  },
  quiz: {
    first: () => "Practice questions for this lecture. Press Space and say start the practice questions, or say a mode and a number, like start an assessment with eight questions. Then say option two to answer, check my answer, or read the question.",
    short: () => "Practice questions.",
  },
};

/** What to say when `screen` opens, or "" for a screen without an introduction. */
export function screenIntro(screen, { first = true, itemCount = 0 } = {}) {
  const intro = SCREEN_INTROS[screen];
  if (!intro) return "";
  return (first ? intro.first : intro.short)(itemCount);
}
