// Voice on the first-launch and account screens: Welcome (mode, get started, skip) and sign in / create
// account (username by voice, password typed). Handlers are called through the real action registry, as the
// Talk control does.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { VoiceActionsContext, createActionRegistry } from "./voiceActions";
import { Login, Signup } from "../components/AccountForm";
import Welcome from "../components/Welcome";
import { actionPhrase, spellOut, helpText } from "./voiceMessages";
import "../test/domMatchers.js";

const h = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock("../lib/accountSession", () => ({ login: h.login, signup: h.signup }));

function withRegistry(element) {
  const registry = createActionRegistry();
  const utils = render(<VoiceActionsContext.Provider value={registry}>{element}</VoiceActionsContext.Provider>);
  return { ...utils, registry };
}

beforeEach(() => {
  localStorage.clear();
  h.login.mockReset();
  h.signup.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("sign in by voice", () => {
  it("types the spoken username, moves to the password field, and never fills the password", async () => {
    const { registry } = withRegistry(<Login onNavigate={vi.fn()} />);
    expect(Object.keys(registry.handlers()).sort()).toEqual(["fill_username", "open_signup"]);
    await act(async () => { registry.handlers().fill_username({ name: "maha22" }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.getByLabelText("Username").value).toBe("maha22");
    const password = screen.getByLabelText("Password");
    expect(password.value).toBe("");
    expect(document.activeElement).toBe(password);
  });

  it("goes to create an account, and back to sign in from there", () => {
    const onNavigate = vi.fn();
    const login = withRegistry(<Login onNavigate={onNavigate} />);
    login.registry.handlers().open_signup();
    expect(onNavigate).toHaveBeenLastCalledWith("signup");
    login.unmount();
    const signup = withRegistry(<Signup onNavigate={onNavigate} />);
    expect(Object.keys(signup.registry.handlers()).sort()).toEqual(["fill_username", "open_login"]);
    signup.registry.handlers().open_login();
    expect(onNavigate).toHaveBeenLastCalledWith("login");
  });

  it("announces what to fix, so the learner hears it without a screen reader", async () => {
    vi.useFakeTimers();
    withRegistry(<Login onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(screen.getAllByRole("status").map((el) => el.textContent).join(" "))
      .toMatch(/Use 3–64 letters.*Use a password between 8 and 128 characters/);
  });

  it("offers no voice actions while signing in is in progress", async () => {
    let finish;
    h.login.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { registry } = withRegistry(<Login onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "maha22" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    expect(Object.keys(registry.handlers())).toEqual([]);
    await act(async () => { finish(); });
  });
});

describe("Welcome by voice", () => {
  it("chooses the mode and gets started with the same handlers as the buttons", () => {
    const onDone = vi.fn();
    const { registry } = withRegistry(<Welcome onDone={onDone} />);
    act(() => { registry.handlers().set_presentation_mode({ mode: "study" }); });
    expect(screen.getByRole("button", { name: /study/i })).toHaveAttribute("aria-pressed", "true");
    act(() => { registry.handlers().get_started(); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("can skip the introduction, and refuses an unknown mode", () => {
    const onDone = vi.fn();
    const { registry } = withRegistry(<Welcome onDone={onDone} />);
    expect(() => registry.handlers().set_presentation_mode({ mode: "cinema" })).toThrow();
    act(() => { registry.handlers().skip_onboarding(); });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("what the voice says", () => {
  it("spells the username back so a mishearing is caught", () => {
    expect(spellOut("maha_22")).toBe("m, a, h, a, underscore, 2, 2");
    expect(actionPhrase("fill_username", { name: "a.b-c" }))
      .toBe("set the username to a, dot, b, dash, c. Now type your password, then press Enter");
  });

  it("states the quiz mode and count that were set up", () => {
    expect(actionPhrase("quiz_start", {})).toBe("start practice questions");
    expect(actionPhrase("quiz_start", { mode: "assessment", count: 8 })).toBe("start 8 assessment questions");
  });

  it("has help for the new screens, and it never asks for the password by voice", () => {
    for (const name of ["welcome", "login", "signup", "quiz"]) expect(helpText(name)).toMatch(/^You can say/);
    expect(helpText("login")).toMatch(/type your password/);
  });
});
