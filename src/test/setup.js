import { afterEach, expect, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);
// Existing study-screen tests explicitly exercise the local development flow.
// Authentication tests unmock this module to exercise the built-app policy.
vi.mock("../lib/accountPolicy", () => ({ developmentAccess: () => true }));
afterEach(() => {
  cleanup();
  globalThis.sessionStorage?.clear();
});
