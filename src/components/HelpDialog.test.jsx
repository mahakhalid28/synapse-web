// The Help dialog on its own: focus, keyboard, labelling. jsdom does not implement `inert`, so what
// inert does is NOT tested here (see App.help.test.jsx for the attribute, and the Electron checks for
// the real effect). Focus trapping is explicit logic in the component, so it is testable here.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import HelpDialog from "./HelpDialog";
import "../test/domMatchers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderDialog(props = {}) {
  const onClose = vi.fn();
  const utils = render(
    <div>
      <button type="button">Outside the dialog</button>
      <HelpDialog onClose={onClose} {...props} />
    </div>,
  );
  return { ...utils, onClose };
}

const dialog = () => screen.getByRole("dialog");

describe("what it is", () => {
  it("is a modal dialog named 'How Synapse works'", () => {
    renderDialog();
    expect(dialog()).toHaveAttribute("aria-modal", "true");
    // The project's name helper does not follow aria-labelledby, so check the link itself.
    const labelId = dialog().getAttribute("aria-labelledby");
    expect(document.getElementById(labelId).textContent).toBe("How Synapse works");
    expect(screen.getByRole("heading", { level: 2, name: "How Synapse works" }).id).toBe(labelId);
  });

  it("is described by the notice when there is one, and by nothing when there is not", () => {
    const { unmount } = renderDialog({ notice: "Lecture paused while Help is open." });
    expect(dialog()).toHaveAccessibleDescription("Lecture paused while Help is open.");
    unmount();
    renderDialog();
    expect(dialog().hasAttribute("aria-describedby")).toBe(false);
  });

  it("has the section headings, and Practice only when that feature is on", () => {
    vi.stubEnv("VITE_QUIZ_ENABLED", "0");
    const { unmount } = renderDialog();
    const headings = within(dialog()).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "What Synapse does",
      "Two ways to follow a lecture",
      "Starting a lecture",
      "Keyboard shortcuts",
      "During a lecture",
      "Voice notes",
      "Appearance",
      "Your data",
    ]);
    unmount();
    vi.stubEnv("VITE_QUIZ_ENABLED", "1");
    renderDialog();
    expect(within(dialog()).getByRole("heading", { level: 3, name: "Practice questions" })).toBeTruthy();
  });

  it("lists every keyboard shortcut from the shared table, by screen", () => {
    renderDialog();
    const section = screen.getByRole("heading", { level: 3, name: "Keyboard shortcuts" }).closest("section");
    expect(within(section).getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual([
      "Home and subject pages",
      "Lecture screen",
    ]);
    const lists = within(section).getAllByRole("list");
    expect(lists).toHaveLength(2);
    expect(within(lists[0]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Alt+S — Jump to the lecture link or search field",
    ]);
    expect(within(lists[1]).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Alt+P — Play, pause or resume the lecture",
      "Alt+L — Listen to or pause the explanation audio",
      "Alt+N — Next moment",
      "Alt+B — Previous moment",
      "Alt+R — Read: jump to the start of the explanation",
      "Alt+. / Alt+, — Listen faster / slower",
      "Alt+M — Start or stop a voice note",
      "Alt+K — Hear this list",
    ]);
    expect(within(section).getByText(/ignored while you type in a text box/)).toBeTruthy();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderDialog({ notice: "Lecture and explanation audio paused while Help is open." });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("starts no audio and no speech", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const audio = vi.fn();
    const speak = vi.fn();
    vi.stubGlobal("Audio", audio);
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    renderDialog();
    expect(play).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });
});

describe("focus", () => {
  it("goes to the title when it opens", () => {
    renderDialog();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "How Synapse works" }));
  });

  it("Tab from the title reaches Close, then the scrollable contents, then wraps to Close", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Help contents" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("Shift+Tab from the title or from Close wraps to the last stop, never outside", async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Help contents" }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Help contents" }));
  });

  it("never lets focus rest on something outside the dialog", () => {
    renderDialog();
    screen.getByRole("button", { name: "Outside the dialog" }).focus();
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it("a Tab pressed when focus has fallen to the page body re-enters at Close", async () => {
    renderDialog();
    document.activeElement.blur();
    expect(document.activeElement).toBe(document.body);
    await userEvent.setup().tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close" }));
  });
});

describe("closing", () => {
  it("the Close button closes it", async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes it, once", async () => {
    const { onClose } = renderDialog();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape closes it even when focus has fallen to the page body", async () => {
    const { onClose } = renderDialog();
    document.activeElement.blur();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("other keys do not close it", async () => {
    const { onClose } = renderDialog();
    await userEvent.setup().keyboard("abc{Enter} ");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stops listening once it is gone", async () => {
    const { onClose, unmount } = renderDialog();
    unmount();
    await userEvent.setup().keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
