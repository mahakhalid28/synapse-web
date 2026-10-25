import { describe, it, expect } from "vitest";
import {
  GUIDE_DISMISSED,
  GUIDE_GOT_IT,
  GUIDE_OPEN_HELP,
  GUIDE_TITLE,
  HELP_BLOCKED_RECORDING,
  MODE_COPY,
  MODE_ORDER,
  WELCOME_MODE_DESCRIPTIONS,
  getGuideSteps,
  getHelpSections,
  helpClosedNotice,
  helpOpenNotice,
} from "./onboardingText.js";
import { HOME_SHORTCUT_ROWS, LECTURE_SHORTCUT_ROWS, rowKeys } from "./shortcuts.js";

describe("the two modes keep the names the lecture screen already uses", () => {
  it("Accessibility mode and Study mode, in that order", () => {
    expect(MODE_ORDER).toEqual(["accessibility", "study"]);
    expect(MODE_COPY.accessibility.label).toBe("Accessibility mode");
    expect(MODE_COPY.study.label).toBe("Study mode");
  });
});

describe("Welcome's mode descriptions", () => {
  it("are the approved wording, for exactly the two modes", () => {
    expect(Object.keys(WELCOME_MODE_DESCRIPTIONS)).toEqual(MODE_ORDER);
    expect(WELCOME_MODE_DESCRIPTIONS.accessibility).toBe(
      "Listen to the lecture and follow AI explanations of important diagrams, equations, and charts. The video stays hidden while you navigate lecture moments and focus on the explanations using accessible controls.",
    );
    expect(WELCOME_MODE_DESCRIPTIONS.study).toBe(
      "Watch the lecture while Synapse pauses at important visual content and explains it. Adjust text size and contrast, explore structured views when available, and use the full lecture timeline.",
    );
  });

  it("do not change what Help says: Help still uses the shorter MODE_COPY descriptions", () => {
    expect(MODE_COPY.accessibility.description).toBe(
      "The video is hidden but its audio still plays. Focus moves to each explanation, and every moment is listed.",
    );
    expect(MODE_COPY.study.description).toBe(
      "The video is shown. Adds text size and contrast controls (not saved), a structured view where available, and the full timeline.",
    );
    const modes = getHelpSections().find((s) => s.id === "modes");
    expect(modes.paragraphs.join(" ")).not.toContain("Listen to the lecture and follow AI explanations");
  });
});

describe("what Help says when it opens", () => {
  it("says nothing when it changed nothing", () => {
    expect(helpOpenNotice()).toBe("");
    expect(helpOpenNotice({ paused: null, stoppedNote: false })).toBe("");
  });

  it("names what was paused", () => {
    expect(helpOpenNotice({ paused: "lecture" })).toBe("Lecture paused while Help is open.");
    expect(helpOpenNotice({ paused: "both" })).toBe("Lecture and explanation audio paused while Help is open.");
  });

  it("names a voice note that was stopped, alone or after a pause", () => {
    expect(helpOpenNotice({ stoppedNote: true })).toBe("Voice note stopped while Help is open.");
    expect(helpOpenNotice({ paused: "lecture", stoppedNote: true })).toBe(
      "Lecture paused while Help is open. Voice note stopped while Help is open.",
    );
  });
});

describe("what is announced when Help closes", () => {
  it("nothing, unless Help had paused or stopped something", () => {
    expect(helpClosedNotice()).toBe("");
    expect(helpClosedNotice({ paused: null, stoppedNote: false })).toBe("");
  });

  it("says playback is still paused, never that it resumed", () => {
    for (const paused of ["lecture", "both"]) {
      const text = helpClosedNotice({ paused });
      expect(text).toBe("Help closed. Playback is still paused.");
      expect(text).not.toMatch(/resum|play(ing)?\b(?! is)/i);
    }
  });

  it("says a stopped voice note stayed stopped", () => {
    expect(helpClosedNotice({ stoppedNote: true })).toBe("Help closed. Voice note stopped.");
    expect(helpClosedNotice({ paused: "both", stoppedNote: true })).toBe(
      "Help closed. Playback is still paused. Voice note stopped.",
    );
  });
});

describe("Help sections", () => {
  it("are in the approved reading order, without Practice by default", () => {
    expect(getHelpSections().map((s) => s.heading)).toEqual([
      "What Synapse does",
      "Two ways to follow a lecture",
      "Starting a lecture",
      "Keyboard shortcuts",
      "During a lecture",
      "Voice notes",
      "Appearance",
      "Your data",
    ]);
  });

  it("add Practice questions only when that feature is on", () => {
    const headings = getHelpSections({ practice: true }).map((s) => s.heading);
    expect(headings).toContain("Practice questions");
    expect(headings.indexOf("Practice questions")).toBe(headings.indexOf("Voice notes") + 1);
    expect(getHelpSections({ practice: false }).map((s) => s.heading)).not.toContain("Practice questions");
  });

  it("describe the modes with the same strings Welcome uses", () => {
    const modes = getHelpSections().find((s) => s.id === "modes");
    expect(modes.paragraphs).toContain(`Accessibility mode: ${MODE_COPY.accessibility.description}`);
    expect(modes.paragraphs).toContain(`Study mode: ${MODE_COPY.study.description}`);
  });

  it("list the keyboard shortcuts straight from the shared table, grouped by screen", () => {
    const section = getHelpSections().find((s) => s.id === "shortcuts");
    expect(section.groups.map((g) => g.heading)).toEqual(["Home and subject pages", "Lecture screen"]);
    expect(section.groups[0].items).toEqual(
      HOME_SHORTCUT_ROWS.map((row) => ({ keys: rowKeys(row), description: row.description })),
    );
    expect(section.groups[1].items).toEqual(
      LECTURE_SHORTCUT_ROWS.map((row) => ({ keys: rowKeys(row), description: row.description })),
    );
    expect(section.groups[1].items).toHaveLength(8);
    expect(section.paragraphs).toEqual([
      "On the lecture screen, shortcuts are ignored while you type in a text box such as the Ask box.",
    ]);
  });
});

describe("the first-lecture guide copy", () => {
  it("has the approved title and button labels", () => {
    expect(GUIDE_TITLE).toBe("How this lecture works");
    expect(GUIDE_GOT_IT).toBe("Got it");
    expect(GUIDE_OPEN_HELP).toBe("Open Help");
    expect(GUIDE_DISMISSED).toBe("Guide hidden. Help has the same information.");
  });

  it("is three steps in each mode, and only the first differs", () => {
    const accessibility = getGuideSteps("accessibility");
    const study = getGuideSteps("study");
    expect(accessibility).toHaveLength(3);
    expect(study).toHaveLength(3);
    expect(accessibility[0]).toBe("Press Play lecture (Alt+P) to begin.");
    expect(study[0]).toBe("Press play on the video, or Alt+P, to begin.");
    expect(accessibility.slice(1)).toEqual(study.slice(1));
    expect(accessibility[1]).toContain("The explanation audio may start by itself when it is ready.");
    expect(accessibility[1]).toContain("(Alt+L)");
    expect(accessibility[2]).toBe("Press Alt+K to hear all keyboard shortcuts.");
  });

  it("treats anything but 'study' as Accessibility mode, the existing default", () => {
    expect(getGuideSteps()).toEqual(getGuideSteps("accessibility"));
  });
});

describe("no copy retypes a key that the shortcut table does not have", () => {
  it("every Alt+key in the Help and guide text is a real shortcut", () => {
    const known = new Set(
      [...LECTURE_SHORTCUT_ROWS, ...HOME_SHORTCUT_ROWS].flatMap((row) => row.actions.map((a) => a.key)),
    );
    const sections = getHelpSections({ practice: true });
    const text = [
      ...sections.flatMap((s) => s.paragraphs),
      ...getGuideSteps("accessibility"),
      ...getGuideSteps("study"),
      HELP_BLOCKED_RECORDING,
    ].join(" ");
    const mentioned = text.match(/Alt\+[A-Za-z.,]/g) ?? [];
    expect(mentioned.length).toBeGreaterThan(0);
    for (const key of mentioned) expect(known.has(key), key).toBe(true);
  });
});
