// The Voice notes screen's side of Help: stop a note that is playing (or still loading) when Help
// opens, say so when it closes, never restart it. The notes list and audio are injected fakes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import NotesScreen from "./NotesScreen";
import { makeNote } from "../test/recorderFakes.js";
import "../test/domMatchers.js";

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:fake/1");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

let guard;
const registerHelpGuard = vi.fn((g) => {
  guard = g;
  return () => { if (guard === g) guard = null; };
});

function setup({ loadAudio } = {}) {
  guard = null;
  registerHelpGuard.mockClear();
  const audios = [];
  const props = {
    onNavigate: vi.fn(),
    onOpenNote: vi.fn(),
    listAll: vi.fn(async () => [makeNote({ id: "a1", videoId: "vidAAAAAAAA", videoTitle: "The Animal Cell", lectureSeconds: 201.4 })]),
    deleteNote: vi.fn(async () => true),
    registerHelpGuard,
    playerOptions: {
      loadAudio: loadAudio ?? vi.fn(async () => new Blob(["x"])),
      createAudio: vi.fn(() => {
        const a = { play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null };
        audios.push(a);
        return a;
      }),
    },
  };
  const utils = render(<NotesScreen {...props} />);
  return { ...utils, props, audios };
}

const playButton = () => screen.findByRole("button", { name: "Play Voice note at 3:21" });
const openHelp = () => {
  let result;
  act(() => { result = guard.beforeHelp(); });
  return result;
};
const closeHelp = () => act(() => { guard.afterHelp(); });

describe("registration", () => {
  it("registers a guard on mount and removes it on unmount", async () => {
    const { unmount } = setup();
    await playButton();
    expect(registerHelpGuard).toHaveBeenCalledTimes(1);
    expect(guard).not.toBeNull();
    unmount();
    expect(guard).toBeNull();
  });

  it("works without one (screen used on its own)", async () => {
    guard = null;
    render(<NotesScreen listAll={async () => []} />);
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    expect(guard).toBeNull();
  });
});

describe("Help with nothing playing", () => {
  it("changes nothing and says nothing, before or after", async () => {
    setup();
    await playButton();
    expect(openHelp()).toEqual({ blocked: false, notice: "" });
    closeHelp();
    await new Promise((r) => setTimeout(r, 120));
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("Help while a note is playing", () => {
  it("stops it, reports it in the dialog notice, and announces it on close without restarting it", async () => {
    const { audios } = setup();
    fireEvent.click(await playButton());
    await waitFor(() => expect(audios).toHaveLength(1));
    expect(audios[0].play).toHaveBeenCalledTimes(1);

    expect(openHelp()).toEqual({ blocked: false, notice: "Voice note stopped while Help is open." });
    expect(audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Play Voice note at 3:21" })).toHaveAttribute("aria-pressed", "false");

    closeHelp();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Help closed. Voice note stopped."));
    expect(audios).toHaveLength(1);
    expect(audios[0].play).toHaveBeenCalledTimes(1);
  });

  it("stops a note that is still loading; it never starts afterwards", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { audios } = setup({ loadAudio: vi.fn(() => gate) });
    fireEvent.click(await playButton());
    expect(audios).toHaveLength(0);

    expect(openHelp().notice).toBe("Voice note stopped while Help is open.");
    release(new Blob(["x"]));
    await new Promise((r) => setTimeout(r, 120));
    expect(audios).toHaveLength(0);
  });

  it("a second Help after a stop starts clean: no stale notice from the first", async () => {
    const { audios } = setup();
    fireEvent.click(await playButton());
    await waitFor(() => expect(audios).toHaveLength(1));
    openHelp();
    closeHelp();
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Help closed"));
    expect(openHelp()).toEqual({ blocked: false, notice: "" });
    closeHelp();
  });
});
