// Words the assistant says. English only for now: a new language adds a table here (or a file per language),
// nothing else changes. Phrases are verb phrases so one table serves both "Okay, open your bookmarks." and
// "Do you want to open your bookmarks?".

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
  appHowTo: (phrase) => `Yes, you can do that by voice. Press Alt+T and ask me to ${phrase}.`,
  appElsewhere: (phrase, screens) => `That works on the ${screens.map((s) => SCREEN_NAMES[s] ?? s).join(" or ")} screen. There, press Alt+T and ask me to ${phrase}.`,
};

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
  quiz_start: () => "start the practice questions",
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
};

/** Text for an unsupported / missing-detail response, from its message key. */
export function missingMessage(messageKey) {
  return MISSING[messageKey] ?? (messageKey?.startsWith("missing_") ? "I need a bit more detail." : MESSAGES.notUnderstood);
}

const HELP = {
  home: "You can say: search for lectures on physics, choose the second one, start the lecture, open my bookmarks, or switch to night mode.",
  explanation:
    "You can say: play or pause the lecture, listen to the explanation, next moment, go back thirty seconds, bookmark this, read faster, or ask a question about the lecture.",
  default: "You can say: go home, open my library, open my bookmarks, or switch to night mode.",
};

export function helpText(screen) {
  if (screen === "home" || screen === "subject") return HELP.home;
  return HELP[screen] ?? HELP.default;
}
