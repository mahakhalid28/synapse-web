import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import Welcome from "./Welcome";
import "../test/domMatchers.js";

const MODE_KEY = "synapse_presentation_mode";
const DONE_KEY = "synapse_onboarding_completed";

// Records every key written, and can make chosen keys (or "*" for all) throw.
function watchWrites({ failKeys = [] } = {}) {
  const original = Storage.prototype.setItem;
  const written = [];
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
    written.push(key);
    if (failKeys.includes(key) || failKeys.includes("*")) throw new Error("QuotaExceededError");
    return original.call(this, key, value);
  });
  return written;
}

// The approved wording, written out literally (not read from the app), so a change to it fails here.
const ACCESSIBILITY_DESCRIPTION =
  "Listen to the lecture and follow AI explanations of important diagrams, equations, and charts. The video stays hidden while you navigate lecture moments and focus on the explanations using accessible controls.";
const STUDY_DESCRIPTION =
  "Watch the lecture while Synapse pauses at important visual content and explains it. Adjust text size and contrast, explore structured views when available, and use the full lecture timeline.";

const SAVE_FAILED =
  "Couldn't save your choice. You can switch modes on the lecture screen. Press Continue to go on.";

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Welcome: what is on the screen", () => {
  it("has the approved heading, introduction and mode question", () => {
    render(<Welcome />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome to Synapse" })).toBeTruthy();
    expect(screen.getByText(
      "Synapse plays a YouTube lecture and pauses at diagrams, equations and charts to explain them. You can listen, read or watch.",
    )).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "How do you want to follow lectures?" })).toBeTruthy();
    expect(screen.getByText("You can switch at any time on the lecture screen. Nothing plays until you choose a lecture.")).toBeTruthy();
    expect(screen.getByText("Already use Synapse? You can skip this.")).toBeTruthy();
  });

  it("offers the two existing modes as a labelled group of pressed-state buttons, each with its description", () => {
    render(<Welcome />);
    const group = screen.getByRole("group", { name: "How do you want to follow lectures?" });
    const accessibility = within(group).getByRole("button", { name: "Accessibility mode" });
    const study = within(group).getByRole("button", { name: "Study mode" });
    expect(accessibility).toHaveAccessibleDescription(ACCESSIBILITY_DESCRIPTION);
    expect(study).toHaveAccessibleDescription(STUDY_DESCRIPTION);
  });

  it("has Get started and Skip for now, and no Help button unless Help is provided", async () => {
    const { rerender } = render(<Welcome />);
    expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Skip for now" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "How Synapse works" })).toBeNull();
    const onOpenHelp = vi.fn();
    rerender(<Welcome onOpenHelp={onOpenHelp} />);
    await userEvent.click(screen.getByRole("button", { name: "How Synapse works" }));
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("is a main landmark that the skip link can target, with the heading as its name", () => {
    render(<Welcome />);
    const main = screen.getByRole("main", { name: "Welcome to Synapse" });
    expect(main.id).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<Welcome onOpenHelp={() => {}} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("Welcome: each mode's name, state and description reach a screen reader", () => {
  const MODES = [
    ["Accessibility mode", ACCESSIBILITY_DESCRIPTION],
    ["Study mode", STUDY_DESCRIPTION],
  ];

  it("shows the exact approved wording on the page, as plain visible text", () => {
    render(<Welcome />);
    for (const [, description] of MODES) {
      const text = screen.getByText(description);
      expect(text.tagName).toBe("P");
      expect(text.className).not.toMatch(/sr-only|hidden/);
      expect(text.closest("[aria-hidden='true']")).toBeNull();
    }
  });

  it("ties each description to its own button through aria-describedby, and to no other", () => {
    render(<Welcome />);
    const ids = [];
    for (const [name, description] of MODES) {
      const button = screen.getByRole("button", { name });
      const id = button.getAttribute("aria-describedby");
      expect(id, name).toBeTruthy();
      expect(id.split(/\s+/)).toHaveLength(1); // exactly one description, not both
      const target = document.getElementById(id);
      expect(target.textContent, name).toBe(description);
      expect(button.contains(target), `${name}: kept out of the button's own name`).toBe(false);
      ids.push(id);
    }
    expect(new Set(ids).size).toBe(2);
  });

  it("the accessible name is only the mode's name, whatever the description says", () => {
    render(<Welcome />);
    for (const [name] of MODES) expect(screen.getByRole("button", { name })).toHaveAccessibleName(name);
  });

  it("name, pressed state and description are all there for both modes, and the state follows the choice", async () => {
    render(<Welcome />);
    const read = (name) => {
      const button = screen.getByRole("button", { name });
      return { pressed: button.getAttribute("aria-pressed"), description: button.getAttribute("aria-describedby") };
    };
    const before = { a: read("Accessibility mode"), s: read("Study mode") };
    expect([before.a.pressed, before.s.pressed]).toEqual(["true", "false"]);

    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    const after = { a: read("Accessibility mode"), s: read("Study mode") };
    expect([after.a.pressed, after.s.pressed]).toEqual(["false", "true"]);
    // choosing a mode never moves or changes its description
    expect(after.a.description).toBe(before.a.description);
    expect(after.s.description).toBe(before.s.description);
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAccessibleDescription(STUDY_DESCRIPTION);
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAccessibleDescription(ACCESSIBILITY_DESCRIPTION);
  });

  it("the selection mark is hidden from assistive technology, so the name stays clean when selected", () => {
    render(<Welcome />);
    const button = screen.getByRole("button", { name: "Accessibility mode" });
    expect(button.textContent).toContain("✓");
    const mark = [...button.querySelectorAll("span")].find((s) => s.textContent.includes("✓"));
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(button).toHaveAccessibleName("Accessibility mode");
  });

  it("the descriptions are not announced when Welcome opens: no live region holds them, and none is set", () => {
    render(<Welcome />);
    expect(screen.getByRole("status").textContent).toBe("");
    for (const [, description] of MODES) {
      const text = screen.getByText(description);
      expect(text.closest("[aria-live], [role='status'], [role='alert'], [role='log']")).toBeNull();
    }
    expect(document.activeElement).toBe(document.body); // and no focus move that would read one
  });

  it("each mode button can be reached and chosen by keyboard, and keeps its visible focus style", async () => {
    render(<Welcome />);
    const user = userEvent.setup();
    await user.tab();
    const accessibility = screen.getByRole("button", { name: "Accessibility mode" });
    expect(document.activeElement).toBe(accessibility);
    await user.tab();
    const study = screen.getByRole("button", { name: "Study mode" });
    expect(document.activeElement).toBe(study);
    for (const button of [accessibility, study]) expect(button.className).toContain("focus-ring");

    await user.keyboard("{Enter}");
    expect(study).toHaveAttribute("aria-pressed", "true");
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(accessibility);
    await user.keyboard(" ");
    expect(accessibility).toHaveAttribute("aria-pressed", "true");
    expect(study).toHaveAttribute("aria-pressed", "false");
  });
});

describe("Welcome: nothing happens by itself", () => {
  it("takes no focus, and its live region starts empty", () => {
    render(<Welcome />);
    expect(document.activeElement).toBe(document.body);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("starts no audio and no speech", () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    const audio = vi.fn();
    const speak = vi.fn();
    vi.stubGlobal("Audio", audio);
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    render(<Welcome />);
    expect(play).not.toHaveBeenCalled();
    expect(audio).not.toHaveBeenCalled();
    expect(speak).not.toHaveBeenCalled();
  });

  it("writes nothing until a button is pressed", () => {
    const written = watchWrites();
    render(<Welcome />);
    expect(written).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("tab order from the page start: the two modes, Get started, Skip for now", async () => {
    render(<Welcome />);
    const user = userEvent.setup();
    const order = [];
    for (let i = 0; i < 4; i++) {
      await user.tab();
      order.push(document.activeElement.textContent.replace("✓ ", ""));
    }
    expect(order).toEqual(["Accessibility mode", "Study mode", "Get started", "Skip for now"]);
  });
});

describe("Welcome: the mode choice", () => {
  it("starts on Accessibility mode, the existing default, when nothing is saved", () => {
    render(<Welcome />);
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts on the saved mode when one is saved", () => {
    localStorage.setItem(MODE_KEY, "study");
    render(<Welcome />);
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores a saved value that is not a mode", () => {
    localStorage.setItem(MODE_KEY, "visual");
    render(<Welcome />);
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("moves the pressed state when the other mode is chosen, and writes nothing yet", async () => {
    const written = watchWrites();
    render(<Welcome />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    expect(screen.getByRole("button", { name: "Study mode" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Accessibility mode" })).toHaveAttribute("aria-pressed", "false");
    expect(written).toEqual([]);
  });
});

describe("Welcome: Get started", () => {
  it("saves the chosen mode and the completion flag, then leaves", async () => {
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("saves the default when nothing was saved and nothing was changed", async () => {
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(localStorage.getItem(MODE_KEY)).toBe("accessibility");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite a mode that is already saved and unchanged", async () => {
    localStorage.setItem(MODE_KEY, "study");
    const written = watchWrites();
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(written).toEqual([DONE_KEY]);
    expect(localStorage.getItem(MODE_KEY)).toBe("study");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("changes a saved mode only when the learner chose the other one", async () => {
    localStorage.setItem(MODE_KEY, "study");
    render(<Welcome onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Accessibility mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(localStorage.getItem(MODE_KEY)).toBe("accessibility");
  });

  it("touches no other key: not the lecture intro, the guide, the theme or the quiz settings", async () => {
    const written = watchWrites();
    render(<Welcome onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect([...written].sort()).toEqual([DONE_KEY, MODE_KEY].sort());
  });
});

describe("Welcome: Skip for now", () => {
  it("saves only the completion flag, never a mode, then leaves", async () => {
    const written = watchWrites();
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(written).toEqual([DONE_KEY]);
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("still leaves when nothing can be saved at all", async () => {
    watchWrites({ failKeys: ["*"] });
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });
});

describe("Welcome: when the choice cannot be saved", () => {
  it("stays, says so on the page and in the live region, and offers Continue", async () => {
    watchWrites({ failKeys: [MODE_KEY] });
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));

    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getAllByText(SAVE_FAILED).length).toBeGreaterThanOrEqual(1);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(SAVE_FAILED));
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });

  it("Continue leaves without trying to save again", async () => {
    const written = watchWrites({ failKeys: [MODE_KEY] });
    const onDone = vi.fn();
    render(<Welcome onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    const attempts = written.filter((k) => k === MODE_KEY).length;
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(written.filter((k) => k === MODE_KEY).length).toBe(attempts);
  });

  it("the completion flag is still saved even though the mode was not", async () => {
    watchWrites({ failKeys: [MODE_KEY] });
    render(<Welcome onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Study mode" }));
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(localStorage.getItem(DONE_KEY)).toBe("1");
    expect(localStorage.getItem(MODE_KEY)).toBeNull();
  });

  it("has no accessibility violations in this state", async () => {
    watchWrites({ failKeys: [MODE_KEY] });
    const { container } = render(<Welcome onDone={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(await axe(container)).toHaveNoViolations();
  });
});
