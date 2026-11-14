// The shortcut table (lib/shortcuts.js) against what the app actually does.
//   1. The table on its own: shape, no duplicate keys, no clash with Electron's menu mnemonics.
//   2. The EXISTING behaviour is frozen: the old on-page labels and the old spoken text are written out
//      below and must still come out of the table unchanged.
//   3. Drift: the keys the lecture screen really reacts to are exactly the keys in the table, and the
//      other places that name a key (aria-keyshortcuts, the on-page list, the Alt+K speech) agree.
//   4. Alt+S: Home's search shortcut matches its row.
// The lecture screen runs for real with a fake player, fake audio and a stub voice-notes panel.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Explanation from "../components/Explanation";
import Home from "../components/Home";
import {
  HOME_SHORTCUT_ROWS,
  LECTURE_ACTION_IDS,
  LECTURE_SHORTCUT_ROWS,
  LECTURE_SHORTCUTS_SPOKEN,
  keysForAction,
  lectureActionForCode,
  rowKeys,
  rowSpokenKeys,
  spokenKey,
} from "./shortcuts.js";

const h = vi.hoisted(() => {
  const players = [];
  class FakePlayer {
    constructor(_el, opts) {
      this.opts = opts;
      this.state = -1;
      this.pauseVideo = vi.fn(() => { this.state = 2; });
      this.playVideo = vi.fn(() => { this.state = 1; });
      this.seekTo = vi.fn();
      this.cueVideoById = vi.fn();
      this.getCurrentTime = vi.fn(() => 0);
      this.getPlayerState = vi.fn(() => this.state);
      this.destroy = vi.fn();
      players.push(this);
      setTimeout(() => opts.events.onReady({ target: this }), 0);
    }
  }
  class FakeAudio {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      this.currentTime = 0;
      this.duration = 10;
      this.playbackRate = 1;
      this.paused = true;
      this.play = vi.fn(() => { this.paused = false; return Promise.resolve(); });
      this.pause = vi.fn(() => { this.paused = true; });
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    removeEventListener() {}
  }
  return { players, FakePlayer, FakeAudio, control: null };
});

vi.mock("../lib/youtubeIframeApi", () => ({
  loadYouTubeIframeAPI: () => Promise.resolve({ Player: h.FakePlayer }),
}));

vi.mock("../api", () => ({
  getInterventionPoints: vi.fn(async () => ({
    videoTitle: "The Animal Cell",
    duration: "19:13",
    author: "A. Teacher",
    points: [
      { id: "p1", category: "diagram", timestamp: "0:10", title: "First diagram" },
      { id: "p2", category: "graph", timestamp: "0:50", title: "Second graph" },
    ],
  })),
  getExplanation: vi.fn(async (pointId) => ({ pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." })),
  getTTSExplanation: vi.fn(async () => ({ text_explanation: "x", audio_file_path: "blob:tts", output_mode: "standard" })),
  getExplanationPreparationStatus: vi.fn(async () => ({
    items: [
      { intervention_id: "p1", timestamp: 10, status: "ready", error_code: null, attempt_count: 1 },
      { intervention_id: "p2", timestamp: 50, status: "ready", error_code: null, attempt_count: 1 },
    ],
  })),
  getPreparedExplanation: vi.fn(async (pointId) => ({
    explanation: { pointId, subtitle: "A subtitle", paragraphs: ["Paragraph one."], keyInsight: "A key insight." },
    audio: { audio_file_path: "blob:tts", audio_error: null },
  })),
  retryExplanationPreparation: vi.fn(),
}));

vi.mock("../components/VoiceNotes", () => ({
  default: function VoiceNotesStub(props) {
    useEffect(() => {
      props.controlRef.current = h.control;
      return () => { props.controlRef.current = null; };
    });
    return <div data-testid="voice-notes-stub" />;
  },
}));

// ── what the app showed and said BEFORE the shared table existed, written out literally ──────────
const LEGACY_ROWS = [
  ["Alt+P", "Play, pause or resume the lecture"],
  ["Alt+L", "Listen to or pause the explanation audio"],
  ["Alt+N", "Next moment"],
  ["Alt+B", "Previous moment"],
  ["Alt+R", "Read: jump to the start of the explanation"],
  ["Alt+. / Alt+,", "Listen faster / slower"],
  ["Alt+M", "Start or stop a voice note"],
  ["Alt+K", "Hear this list"],
];
const LEGACY_SPOKEN =
  "Keyboard shortcuts. " +
  LEGACY_ROWS.map(([k, d]) =>
    `${k.replace("Alt+. / Alt+,", "Alt plus period, or Alt plus comma").replace("+", " plus ")}: ${d}.`,
  ).join(" ");

const ALL_ROWS = [...LECTURE_SHORTCUT_ROWS, ...HOME_SHORTCUT_ROWS];
const ALL_ACTIONS = ALL_ROWS.flatMap((row) => row.actions);

describe("the table on its own", () => {
  it("has no duplicate action ids, codes or keys", () => {
    for (const field of ["id", "code", "key"]) {
      const values = ALL_ACTIONS.map((a) => a[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("each key matches its code (Alt+<letter> <-> Key<LETTER>, Alt+. <-> Period, Alt+, <-> Comma)", () => {
    const expectedCode = { ".": "Period", ",": "Comma" };
    for (const { key, code } of ALL_ACTIONS) {
      expect(key).toMatch(/^Alt\+(?:[A-Z]|\.|,)$/);
      const rest = key.slice(4);
      expect(code, key).toBe(expectedCode[rest] ?? `Key${rest}`);
    }
  });

  it("avoids Electron's default menu mnemonics (F, E, V, W, H)", () => {
    for (const { key } of ALL_ACTIONS) expect("FEVWH").not.toContain(key.slice(4));
  });

  it("looks an action up by code, and nothing else", () => {
    expect(lectureActionForCode("KeyP")).toBe("playPause");
    expect(lectureActionForCode("Comma")).toBe("slower");
    expect(lectureActionForCode("KeyS")).toBeNull(); // Alt+S belongs to Home, not the lecture screen
    expect(lectureActionForCode("KeyZ")).toBeNull();
    expect(lectureActionForCode("")).toBeNull();
    expect(lectureActionForCode("constructor")).toBeNull();
    expect(lectureActionForCode(undefined)).toBeNull();
  });

  it("names a key for copy to use", () => {
    expect(keysForAction("playPause")).toBe("Alt+P");
    expect(keysForAction("faster")).toBe("Alt+.");
    expect(keysForAction("search")).toBe("Alt+S");
    expect(keysForAction("nope")).toBeUndefined();
  });

  it("speaks keys the way the old list did", () => {
    expect(spokenKey("Alt+P")).toBe("Alt plus P");
    expect(spokenKey("Alt+.")).toBe("Alt plus period");
    expect(spokenKey("Alt+,")).toBe("Alt plus comma");
  });
});

describe("existing behaviour is unchanged", () => {
  it("shows the same eight rows with the same words, in the same order", () => {
    expect(LECTURE_SHORTCUT_ROWS.map((row) => [rowKeys(row), row.description])).toEqual(LEGACY_ROWS);
  });

  it("speaks exactly the text Alt+K spoke before", () => {
    expect(LECTURE_SHORTCUTS_SPOKEN).toBe(LEGACY_SPOKEN);
    expect(rowSpokenKeys(LECTURE_SHORTCUT_ROWS[5])).toBe("Alt plus period, or Alt plus comma");
  });

  it("has an action for each of the nine keys the lecture handler had", () => {
    expect(LECTURE_ACTION_IDS).toEqual([
      "playPause", "listen", "next", "previous", "read", "faster", "slower", "voiceNote", "hearShortcuts",
    ]);
  });
});

// ── the real lecture screen ───────────────────────────────────────────────────────────────────────

const settle = (ms = 1000) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

async function openLecture() {
  const utils = render(<Explanation jobId="job-1" videoId="5ugDJhmmkFM" mode="standard" onNavigate={() => {}} />);
  await settle();
  return { ...utils, player: h.players[0] };
}

// fireEvent returns false when the event's default was prevented, which is what a handled shortcut does.
const handled = (code, key, init = {}) =>
  fireEvent.keyDown(window, { code, key, altKey: true, ...init }) === false;

const keyForCode = (code) =>
  code.startsWith("Key") ? code.slice(3).toLowerCase() : { Period: ".", Comma: "," }[code] ?? "x";

describe("the lecture screen reacts to exactly the keys in the table", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.players.length = 0;
    h.control = { toggle: vi.fn(), lectureStarted: vi.fn(() => false), requestLeave: vi.fn((go) => go()) };
    vi.stubGlobal("Audio", h.FakeAudio);
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const PROBE_CODES = [
    ...Array.from({ length: 26 }, (_, i) => `Key${String.fromCharCode(65 + i)}`),
    "Period", "Comma", "Slash", "Semicolon", "Digit1", "Space", "Enter", "ArrowLeft", "Escape",
  ];

  it("handles every key in the table, and no other key", async () => {
    await openLecture();
    const actedOn = PROBE_CODES.filter((code) => handled(code, keyForCode(code)));
    await settle(100);
    const tableCodes = LECTURE_SHORTCUT_ROWS.flatMap((row) => row.actions.map((a) => a.code));
    expect([...actedOn].sort()).toEqual([...tableCodes].sort());
  });

  it("does not handle Alt+S on the lecture screen (that one belongs to Home)", async () => {
    await openLecture();
    expect(handled("KeyS", "s")).toBe(false);
  });

  it("still recognises a key by its typed letter when the code is empty (some assistive-technology events)", async () => {
    await openLecture();
    for (const row of LECTURE_SHORTCUT_ROWS) {
      for (const action of row.actions) {
        expect(handled("", action.key.slice(4).toLowerCase()), action.key).toBe(true);
      }
    }
    expect(handled("", "z")).toBe(false);
  });

  it("ignores a key pressed with Ctrl, Meta or Shift as well", async () => {
    await openLecture();
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(handled("KeyP", "p", extra), JSON.stringify(extra)).toBe(false);
    }
  });

  it("ignores a key typed into a text box", async () => {
    await openLecture();
    const box = document.createElement("textarea");
    document.body.appendChild(box);
    box.focus();
    expect(fireEvent.keyDown(box, { code: "KeyP", key: "p", altKey: true })).toBe(true); // not prevented
    box.remove();
  });

  it("each key reaches the action the table names for it", async () => {
    const { player } = await openLecture();
    handled("KeyP", "p"); // playPause
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    handled("KeyM", "m"); // voiceNote
    expect(h.control.toggle).toHaveBeenCalledTimes(1);
    handled("KeyL", "l"); // listen
    await settle(10);
    expect(h.players[0]).toBe(player);
  });

  it("Alt+K reads exactly the shared spoken list", async () => {
    await openLecture();
    await settle(6000); // let the existing "Lecture ready" message clear
    handled("KeyK", "k");
    await settle(100);
    const spoken = screen.getAllByRole("status").map((el) => el.textContent);
    expect(spoken).toContain(LEGACY_SPOKEN);
    expect(spoken).toContain(LECTURE_SHORTCUTS_SPOKEN);
  });

  it("the on-page list shows the table's rows, in order", async () => {
    await openLecture();
    const section = screen.getByRole("heading", { level: 2, name: "Keyboard shortcuts" }).closest("section");
    const shown = within(section).getAllByRole("listitem").map((li) => li.textContent);
    expect(shown).toEqual(LEGACY_ROWS.map(([keys, what]) => `${keys} — ${what}`));
  });

  it("every aria-keyshortcuts on the screen names a key in the table", async () => {
    await openLecture();
    const known = new Set(ALL_ACTIONS.map((a) => a.key));
    const tokens = [...document.querySelectorAll("[aria-keyshortcuts]")].flatMap((el) =>
      el.getAttribute("aria-keyshortcuts").split(/\s+/),
    );
    for (const expected of ["Alt+P", "Alt+L", "Alt+N", "Alt+.", "Alt+,"]) expect(tokens).toContain(expected);
    for (const token of tokens) expect(known.has(token), token).toBe(true);
  });
});

describe("Alt+S on Home matches its row", () => {
  it("its row is Alt+S / KeyS, and pressing it moves focus into the search field", () => {
    const [row] = HOME_SHORTCUT_ROWS;
    expect(rowKeys(row)).toBe("Alt+S");
    const { code } = row.actions[0];
    render(<Home />);
    const input = screen.getByLabelText("Lecture link or search");
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(window, { code, key: "s", altKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("also works while typing in the field, as the docs say", () => {
    render(<Home />);
    const input = screen.getByLabelText("Lecture link or search");
    screen.getByRole("button", { name: "Mathematics" }).focus();
    fireEvent.keyDown(input, { code: "KeyS", key: "s", altKey: true });
    expect(document.activeElement).toBe(input);
  });

  it("Home's own intro sentence names the same key", () => {
    render(<Home />);
    expect(screen.getByText(/press\s+Alt plus S at any time/)).toBeTruthy();
    expect(spokenKey(HOME_SHORTCUT_ROWS[0].actions[0].key)).toBe("Alt plus S");
  });
});
