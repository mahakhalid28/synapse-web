import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import SavedCollection from "./SavedCollection";
import { getSavedLibrary, getSavedList, personalRequest } from "../lib/personalApi";
import { createActionRegistry, VoiceActionsContext } from "../voice/voiceActions";

vi.mock("./PersonalImport", () => ({ default: () => null }));
vi.mock("./Sidebar", () => ({ default: () => <span>Navigation</span> }));
vi.mock("../lib/personalApi", () => ({ getSavedLibrary: vi.fn(), getSavedList: vi.fn(), bookmarkSaved: vi.fn(),
  personalRequest: vi.fn(), notifyPersonal: vi.fn(), PERSONAL_CHANGED: "personal-changed" }));
const item = (id, mode = "standard") => ({ id, savedVersionId: id, videoId: "abcdefghijk", videoTitle: "Lecture",
  title: `Explanation ${id}`, mode, timestamp: "1:00" });
beforeEach(() => { vi.clearAllMocks(); getSavedLibrary.mockResolvedValue([{ videoId: "abcdefghijk", explanations: [item("one"), item("two", "detailed")] }]); personalRequest.mockResolvedValue(null); });

describe("backend saved collections", () => {
  it("groups modes under a lecture and offers play plus paused text reading", async () => {
    const open = vi.fn();
    const { container } = render(<SavedCollection kind="library" onOpen={open} />);
    await screen.findByText("1. Explanation one");
    fireEvent.click(screen.getAllByRole("button", { name: /^Open and play explanation:/ })[0]);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ savedVersionId: "one", autoPlay: true }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Read text:/ })[1]);
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ savedVersionId: "two", mode: "detailed", autoPlay: false }));
    expect((await axe(container)).violations).toEqual([]);
  });
  it("reports loading failure and retries without showing a false empty library", async () => {
    getSavedLibrary.mockRejectedValueOnce(new Error("Server offline"));
    render(<SavedCollection kind="library" />);
    await screen.findByText("Server offline");
    expect(screen.queryByText("No saved items match this view.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
    await screen.findByText("1. Explanation one");
  });
  it("keeps visible numbering and voice targets aligned across pages", async () => {
    getSavedList.mockResolvedValue(Array.from({ length: 61 }, (_, index) => item(String(index))));
    const registry = createActionRegistry();
    const open = vi.fn();
    render(<VoiceActionsContext.Provider value={registry}><SavedCollection kind="bookmarks" onOpen={open} /></VoiceActionsContext.Provider>);
    await screen.findByText("1. Explanation 0");
    expect(registry.context().items).toHaveLength(60);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("1. Explanation 60");
    registry.handlers().open_item({ index: 1 });
    expect(open).toHaveBeenLastCalledWith(expect.objectContaining({ id: "60" }));
  });
  it("only removes a lecture after confirmation, keeping other personal saves", async () => {
    render(<SavedCollection kind="library" />);
    await screen.findByText("1. Explanation one");
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove lecture:/ })[0]);
    expect(personalRequest).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    await waitFor(() => expect(personalRequest).toHaveBeenCalledWith("library/abcdefghijk", { method: "DELETE" }));
    await screen.findByText(/Bookmarks and recordings were kept/);
  });
});
