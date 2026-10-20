// The global Voice Notes screen, tested with the notes list and delete injected.
// Real storage and real audio are not involved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import NotesScreen from "./NotesScreen";
import { groupByLecture, noteTitle } from "../lib/voiceNoteText.js";
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

const NOTES = () => [
  makeNote({ id: "a1", videoId: "vidAAAAAAAA", videoTitle: "The Animal Cell", createdAt: 300, lectureSeconds: 201.4 }),
  makeNote({ id: "b1", videoId: "vidBBBBBBBB", videoTitle: "Newton's Laws", createdAt: 500, lectureSeconds: 62, label: "Check the units" }),
  makeNote({ id: "a2", videoId: "vidAAAAAAAA", videoTitle: "The Animal Cell", createdAt: 100, lectureSeconds: 30 }),
];

function setup(over = {}) {
  const props = {
    onNavigate: vi.fn(),
    onOpenNote: vi.fn(),
    listAll: vi.fn(async () => over.notes ?? NOTES()),
    deleteNote: vi.fn(async () => true),
    playerOptions: {
      loadAudio: vi.fn(async () => new Blob(["x"])),
      createAudio: vi.fn(() => ({ play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null })),
    },
    ...over.props,
  };
  const utils = render(<NotesScreen {...props} />);
  return { ...utils, props };
}

describe("groupByLecture / noteTitle", () => {
  it("orders lectures by their newest note and notes newest first inside each", () => {
    const groups = groupByLecture(NOTES());
    expect(groups.map((g) => g.videoId)).toEqual(["vidBBBBBBBB", "vidAAAAAAAA"]);
    expect(groups[1].notes.map((n) => n.id)).toEqual(["a1", "a2"]);
    expect(groups[0].title).toBe("Newton's Laws");
  });

  it("never leaves a lecture without a name", () => {
    const [g] = groupByLecture([makeNote({ videoTitle: "" }), makeNote({ id: "n2", videoTitle: "   " })]);
    expect(g.title).toBe("Lecture 5ugDJhmmkFM");
  });

  it("uses a later note's title if the newest note has none", () => {
    const [g] = groupByLecture([makeNote({ id: "n1", createdAt: 9, videoTitle: "" }), makeNote({ id: "n2", createdAt: 1, videoTitle: "Real title" })]);
    expect(g.title).toBe("Real title");
  });

  it("noteTitle prefers the label, else the lecture time", () => {
    expect(noteTitle(makeNote({ label: "Mine" }))).toBe("Mine");
    expect(noteTitle(makeNote({ label: "", lectureSeconds: 3725 }))).toBe("Voice note at 1:02:05");
  });
});

describe("Voice notes screen", () => {
  it("has the page heading, the shared sidebar with this page marked current, and a summary", async () => {
    setup();
    expect(await screen.findByRole("heading", { level: 1, name: "Your voice notes." })).toBeInTheDocument();
    const current = screen.getByRole("button", { name: "Voice notes", current: "page" });
    expect(current).toBeInTheDocument();
    expect(screen.getByText(/3 voice notes in 2 lectures/)).toBeInTheDocument();
    expect(screen.getByText(/stored on this computer only/)).toBeInTheDocument();
  });

  it("groups notes under one heading per lecture, newest lecture first", async () => {
    setup();
    await screen.findByRole("heading", { level: 2, name: "Newton's Laws" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Newton's Laws", "The Animal Cell"]);
    const cell = screen.getByRole("heading", { name: "The Animal Cell" }).closest("section");
    expect(within(cell).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens a note in its lecture with the whole note", async () => {
    const { props } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Open at 1:02, Check the units" }));
    expect(props.onOpenNote).toHaveBeenCalledTimes(1);
    expect(props.onOpenNote.mock.calls[0][0]).toMatchObject({ id: "b1", videoId: "vidBBBBBBBB", lectureSeconds: 62 });
  });

  it("the sidebar navigates", async () => {
    const { props } = setup();
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Bookmarks" }));
    expect(props.onNavigate).toHaveBeenCalledWith("bookmarks");
  });

  it("explains the empty state and where to record", async () => {
    setup({ notes: [] });
    expect(await screen.findByText(/Nothing recorded yet\. Open a lecture and press Alt\+M/)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows a loading message, then the notes", async () => {
    let finish;
    setup({ props: { listAll: vi.fn(() => new Promise((resolve) => { finish = () => resolve(NOTES()); })) } });
    expect(screen.getByText("Loading your voice notes…")).toBeInTheDocument();
    finish();
    expect(await screen.findByText(/3 voice notes/)).toBeInTheDocument();
  });

  it("explains a load failure and can try again", async () => {
    let fail = true;
    setup({
      props: {
        listAll: vi.fn(async () => {
          if (fail) throw new Error("Voice notes can't be stored here: this environment has no IndexedDB.");
          return NOTES();
        }),
      },
    });
    expect(await screen.findByText(/no IndexedDB/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(/3 voice notes/)).toBeInTheDocument();
  });

  it("plays a note without needing a lecture", async () => {
    const { props } = setup();
    const play = await screen.findByRole("button", { name: "Play Check the units" });
    fireEvent.click(play);
    await waitFor(() => expect(props.playerOptions.createAudio).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Play Check the units" })).toHaveAttribute("aria-pressed", "true");
  });

  describe("deleting", () => {
    it("asks first; nothing is deleted until confirmed", async () => {
      const { props } = setup();
      fireEvent.click(await screen.findByRole("button", { name: "Delete Check the units" }));
      expect(screen.getByRole("group", { name: "Confirm deleting Check the units" })).toBeInTheDocument();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
      expect(props.deleteNote).not.toHaveBeenCalled();
    });

    it("removes the note, announces it in a polite live region, and keeps focus in the same lecture", async () => {
      const { props } = setup();
      fireEvent.click(await screen.findByRole("button", { name: "Delete Voice note at 3:21" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));

      await waitFor(() => expect(props.deleteNote).toHaveBeenCalledWith("a1"));
      await waitFor(() => expect(screen.queryByText("Voice note at 3:21")).toBeNull());
      expect(await screen.findByText("Deleted Voice note at 3:21. 2 left.")).toBeInTheDocument();
      expect(screen.getByText("Deleted Voice note at 3:21. 2 left.").closest("[aria-live='polite']")).not.toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Voice note at 0:30" })));
    });

    it("deleting a lecture's last note moves focus to the page heading", async () => {
      setup();
      fireEvent.click(await screen.findByRole("button", { name: "Delete Check the units" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
      await waitFor(() => expect(screen.queryByRole("heading", { name: "Newton's Laws" })).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })));
    });

    it("keeps the note and says why when the delete fails", async () => {
      const { props } = setup({ props: { deleteNote: vi.fn(async () => { throw new Error("Could not delete the voice note."); }) } });
      fireEvent.click(await screen.findByRole("button", { name: "Delete Check the units" }));
      fireEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
      expect(await screen.findByText("Could not delete Check the units. Could not delete the voice note.")).toBeInTheDocument();
      expect(props.deleteNote).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete Check the units" })));
    });
  });

  it("has no accessibility violations (axe), with notes and with a confirmation open", async () => {
    const { container } = setup();
    await screen.findByRole("heading", { level: 2, name: "Newton's Laws" });
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole("button", { name: "Delete Check the units" }));
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no accessibility violations when empty or failed", async () => {
    const empty = setup({ notes: [] });
    await screen.findByText(/Nothing recorded yet/);
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();

    const failed = setup({ props: { listAll: vi.fn(async () => { throw new Error("boom"); }) } });
    await screen.findByText("boom");
    expect(await axe(failed.container)).toHaveNoViolations();
  });
});
