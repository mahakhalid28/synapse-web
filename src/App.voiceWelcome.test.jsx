import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App.jsx";
import { ONBOARDING_COMPLETED_KEY } from "./lib/onboardingPrefs.js";

const h = vi.hoisted(() => ({ talkShortcut: vi.fn() }));

vi.mock("./voice/VoiceControl", async () => {
  const React = await import("react");
  return {
    default: function VoiceControlStub() {
      React.useEffect(() => {
        const onKeyDown = (event) => {
          if (event.altKey && event.code === "KeyT") h.talkShortcut();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, []);
      return <button type="button">Talk</button>;
    },
  };
});

describe("Welcome voice-control gating", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    h.talkShortcut.mockClear();
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "true");
    vi.stubEnv("VITE_VOICE_CONTROL_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not mount Talk or its Alt+T behavior until Welcome is completed", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: /welcome to synapse/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Talk" })).toBeNull();
    fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true });
    expect(h.talkShortcut).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "Talk" })).toBeTruthy();

    fireEvent.keyDown(window, { code: "KeyT", key: "t", altKey: true });
    expect(h.talkShortcut).toHaveBeenCalledTimes(1);
  });
});
