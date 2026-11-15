import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import App from "./App.jsx";
import { ONBOARDING_COMPLETED_KEY } from "./lib/onboardingPrefs.js";

const h = vi.hoisted(() => ({ screens: [] }));

// The Talk control is stubbed: these tests check where App mounts it and which screen it is told it is on.
vi.mock("./voice/VoiceControl", () => ({
  default: function VoiceControlStub({ screen: name }) {
    h.screens.push(name);
    return <button type="button" data-screen={name}>Talk</button>;
  },
}));

describe("Welcome voice control", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    h.screens.length = 0;
    vi.stubEnv("VITE_ONBOARDING_ENABLED", "true");
    vi.stubEnv("VITE_VOICE_CONTROL_ENABLED", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers Talk on Welcome, so a blind learner can choose a mode and get started by voice", () => {
    render(<App />);

    expect(screen.getByRole("heading", { level: 1, name: /welcome to synapse/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Talk" }).dataset.screen).toBe("welcome");

    fireEvent.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe("1");
    expect(screen.getByRole("button", { name: "Talk" }).dataset.screen).toBe("home");
  });
});
