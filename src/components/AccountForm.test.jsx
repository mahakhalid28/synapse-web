import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Login, Signup } from "./AccountForm";
import { login, signup } from "../lib/accountSession";
import "../test/domMatchers";

vi.mock("../lib/accountSession", () => ({ login: vi.fn(), signup: vi.fn() }));
beforeEach(() => { login.mockReset(); signup.mockReset(); });
afterEach(() => vi.restoreAllMocks());
const fill = (password = "correct password") => {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "Learner.one" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
};

describe("accessible account forms", () => {
  it.each([["login", Login], ["signup", Signup]])("%s has named landmarks, labels, descriptions and no axe violations", async (_name, Component) => {
    const { container } = render(<Component onNavigate={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(screen.getByRole("main", { name: heading.textContent })).toBeTruthy();
    expect(screen.getByRole("main").id).toBe("main-content");
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("8–128 characters. Spaces are kept exactly as entered.");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("supports password managers and keyboard visibility without altering the password", async () => {
    render(<Login onNavigate={vi.fn()} />);
    const user = userEvent.setup();
    const password = screen.getByLabelText("Password");
    expect(password.autocomplete).toBe("current-password");
    expect(screen.getByLabelText("Username").autocomplete).toBe("username");
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText("Username"));
    await user.tab();
    await user.paste("  exact password  ");
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Show password" }).getAttribute("aria-pressed")).toBe("true");
    expect(password.type).toBe("text");
    expect(password.value).toBe("  exact password  ");
  });

  it("describes invalid fields and focuses the first without sending credentials", async () => {
    render(<Signup onNavigate={vi.fn()} />);
    fireEvent.submit(screen.getByRole("form"));
    const username = screen.getByLabelText("Username");
    expect(username.getAttribute("aria-invalid")).toBe("true");
    expect(username).toHaveAccessibleDescription(/Use 3–64/);
    expect(document.activeElement).toBe(username);
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
    expect(signup).not.toHaveBeenCalled();
  });

  it("sends signup fields exactly and clears the password after success", async () => {
    signup.mockResolvedValue({ persistent: true });
    render(<Signup onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("Password").autocomplete).toBe("new-password");
    fill("  exact password  ");
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Student" } });
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(signup).toHaveBeenCalledWith("Learner.one", "  exact password  ", "Student"));
    await waitFor(() => expect(screen.getByLabelText("Password").value).toBe(""));
  });

  it("submits once and disables form navigation while pending", async () => {
    let finish;
    login.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const navigate = vi.fn();
    render(<Login onNavigate={navigate} onBack={vi.fn()} />);
    fill();
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("form").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByRole("button", { name: "Create an account" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Back to development app" }).disabled).toBe(true);
    await act(async () => finish({ persistent: true }));
    expect(screen.getByRole("button", { name: "Sign in" }).disabled).toBe(false);
  });

  it.each([
    [Object.assign(new Error("Invalid username or password."), { status: 401 }), "Invalid username or password."],
    [Object.assign(new Error("Username is unavailable."), { status: 409 }), "Username is unavailable."],
    [Object.assign(new Error("Too many attempts."), { status: 429 }), /Wait a minute/],
    [new TypeError("Failed to fetch"), /Check that the backend is running/],
  ])("focuses actionable server errors without clearing the username (%s)", async (error, expected) => {
    signup.mockRejectedValue(error);
    render(<Signup onNavigate={vi.fn()} />);
    fill();
    fireEvent.submit(screen.getByRole("form"));
    const message = await screen.findByText(expected);
    await waitFor(() => expect(document.activeElement).toBe(message));
    expect(screen.getByLabelText("Username").value).toBe("Learner.one");
    expect(message.getAttribute("role")).toBeNull();
  });

  it("enforces upper bounds but counts Unicode passwords as characters", async () => {
    render(<Signup onNavigate={vi.fn()} />);
    fill("a".repeat(129));
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "a".repeat(121) } });
    fireEvent.submit(screen.getByRole("form"));
    expect(document.activeElement).toBe(screen.getByLabelText("Password"));
    expect(signup).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Display name (optional)"), { target: { value: "Student" } });
    fill("😀".repeat(128));
    signup.mockResolvedValue({});
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(signup).toHaveBeenCalledOnce());
  });

  it("does not retain passwords after leaving and reopening a form", () => {
    const { rerender } = render(<Login key="login" onNavigate={vi.fn()} />);
    fill();
    rerender(<Signup key="signup" onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("Password").value).toBe("");
    rerender(<Login key="login2" onNavigate={vi.fn()} />);
    expect(screen.getByLabelText("Password").value).toBe("");
  });
});
