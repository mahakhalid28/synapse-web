import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import AskLecture from "./AskLecture";
import { ERROR_MESSAGES } from "../lib/askApi";

const VIDEO = "aircAruvnKk";
const UUID = "3f2b8c1e-5d4a-4e7b-9a10-2c6d8e9f0a1b";

const reply = (status, body) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });

const ANSWERED = {
  status: "answered",
  scope: "lecture",
  answer_text: "The instructor explained gradient descent.",
  sources: [
    { start_seconds: 200, end_seconds: 245, intervention_id: null },
    { start_seconds: 3725, end_seconds: 3725, intervention_id: null },
  ],
};

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const body = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

function setup(props = {}) {
  const onSeek = vi.fn();
  const onSelectMoment = vi.fn();
  const utils = render(
    <AskLecture
      videoId={VIDEO}
      getCurrentTime={() => 187.5}
      activeInterventionId={null}
      onSeek={onSeek}
      onSelectMoment={onSelectMoment}
      knownMomentIds={[]}
      {...props}
    />,
  );
  return { onSeek, onSelectMoment, ...utils };
}

const toggle = () => screen.getByRole("button", { name: /ask a question about this lecture|hide question box/i });
const input = () => screen.getByLabelText("Your question about this lecture");
const askBtn = () => screen.getByRole("button", { name: /^ask$/i });

async function openAndAsk(user, text = "What is gradient descent?") {
  await user.click(toggle());
  await user.type(input(), text);
  await user.keyboard("{Enter}");
}

describe("disclosure", () => {
  it("is a button with aria-expanded/aria-controls and opening does not move focus", async () => {
    const user = userEvent.setup();
    setup();
    const t = toggle();
    expect(t.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(t.getAttribute("aria-controls"));
    expect(panel.hidden).toBe(true);
    await user.click(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(document.activeElement).toBe(t);
  });

  it("uses a real label and a plain text input (so Explanation's Alt-shortcut handler skips it)", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(toggle());
    expect(input().tagName).toBe("INPUT");
    expect(input().type).toBe("text");
    expect(input().maxLength).toBe(500);
  });
});

describe("results", () => {
  it("answered: heading Answer is focused, text shown, sources are buttons that seek", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    const { onSeek } = setup();
    await openAndAsk(user);

    const heading = await screen.findByRole("heading", { name: "Answer" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(ANSWERED.answer_text)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Where in the lecture" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Jump to 3:20 to 4:05" }));
    expect(onSeek).toHaveBeenCalledWith(200);
    await user.click(screen.getByRole("button", { name: "Jump to 1:02:05" }));
    expect(onSeek).toHaveBeenLastCalledWith(3725);
  });

  it("answered: the result lives in a polite live region", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    setup();
    await openAndAsk(user);
    const heading = await screen.findByRole("heading", { name: "Answer" });
    expect(heading.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("source with a known intervention_id opens that moment via onSelectMoment", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(
      reply(200, {
        ...ANSWERED,
        scope: "lecture_with_moment",
        sources: [{ start_seconds: 90, end_seconds: 90, intervention_id: UUID }],
      }),
    );
    const { onSeek, onSelectMoment } = setup({ knownMomentIds: [UUID] });
    await openAndAsk(user);
    await user.click(
      await screen.findByRole("button", { name: "Jump to the moment you were viewing" }),
    );
    expect(onSelectMoment).toHaveBeenCalledWith(UUID);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("source with an unknown intervention_id falls back to a plain seek", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(
      reply(200, {
        ...ANSWERED,
        sources: [{ start_seconds: 90, end_seconds: 90, intervention_id: UUID }],
      }),
    );
    const { onSeek, onSelectMoment } = setup({ knownMomentIds: [] });
    await openAndAsk(user);
    await user.click(await screen.findByRole("button", { name: "Jump to 1:30" }));
    expect(onSeek).toHaveBeenCalledWith(90);
    expect(onSelectMoment).not.toHaveBeenCalled();
  });

  it.each([
    ["insufficient_context", "I couldn't find that"],
    ["not_in_lecture", "Not covered in this lecture"],
  ])("%s: own heading, explanation shown, no sources, not styled as an answer", async (status, title) => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(
      reply(200, { status, scope: "lecture", answer_text: "Nothing on that here.", sources: [] }),
    );
    setup();
    await openAndAsk(user);
    expect(await screen.findByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByText("Nothing on that here.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Answer" })).toBeNull();
    expect(screen.queryByText("Where in the lecture")).toBeNull();
    expect(screen.queryByRole("button", { name: /jump to/i })).toBeNull();
  });

  it("renders answer_text literally, never as HTML", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(
      reply(200, { ...ANSWERED, answer_text: "Use <b>x</b> squared" }),
    );
    const { container } = setup();
    await openAndAsk(user);
    expect(await screen.findByText("Use <b>x</b> squared")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
  });

  it("keeps the last result until a new question is submitted, then replaces it", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    setup();
    await openAndAsk(user);
    await screen.findByRole("heading", { name: "Answer" });
    await user.click(toggle()); // close
    await user.click(toggle()); // reopen
    expect(screen.getByText(ANSWERED.answer_text)).toBeTruthy();

    let resolve;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    await user.click(askBtn());
    expect(screen.queryByText(ANSWERED.answer_text)).toBeNull();
    resolve(await reply(200, { ...ANSWERED, answer_text: "Second answer." }));
    expect(await screen.findByText("Second answer.")).toBeTruthy();
  });
});

describe("request contents", () => {
  it("sends the playback time and a real intervention id when available", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    setup({ activeInterventionId: UUID });
    await openAndAsk(user, "  hello  ");
    await screen.findByRole("heading", { name: "Answer" });
    expect(body()).toEqual({
      video_id: VIDEO,
      question: "hello",
      current_time_seconds: 187.5,
      intervention_id: UUID,
    });
  });

  it.each([
    ["mock-style id", "p1"],
    ["no active moment", null],
  ])("omits intervention_id for %s", async (_label, id) => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    setup({ activeInterventionId: id });
    await openAndAsk(user);
    await screen.findByRole("heading", { name: "Answer" });
    expect("intervention_id" in body()).toBe(false);
  });

  it.each([
    ["NaN", () => NaN],
    ["undefined", () => undefined],
    ["a throwing player", () => { throw new Error("not ready"); }],
  ])("omits current_time_seconds when the player reports %s", async (_l, getCurrentTime) => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    setup({ getCurrentTime });
    await openAndAsk(user);
    await screen.findByRole("heading", { name: "Answer" });
    expect("current_time_seconds" in body()).toBe(false);
  });
});

describe("validation and submit guards", () => {
  it("blocks empty and whitespace-only questions without calling the server", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(toggle());
    expect(askBtn().getAttribute("aria-disabled")).toBe("true");
    await user.click(askBtn());
    expect(screen.getByRole("alert").textContent).toMatch(/type a question/i);
    await user.type(input(), "   ");
    await user.keyboard("{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks questions over 500 characters and says how many to remove", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(toggle());
    fireEvent.change(input(), { target: { value: "a".repeat(501) } });
    expect(askBtn().getAttribute("aria-disabled")).toBe("true");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(/1 characters too many/)).toBeTruthy();
    await user.click(askBtn());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a live character count", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(toggle());
    await user.type(input(), "abc");
    expect(screen.getByText("3 of 500 characters")).toBeTruthy();
  });

  it("ignores double submits and marks the button busy while loading", async () => {
    const user = userEvent.setup();
    let resolve;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    setup();
    await openAndAsk(user);
    expect(askBtn().getAttribute("aria-busy")).toBe("true");
    expect(askBtn().getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("status").textContent).toBe("Looking for the answer...");
    await user.click(askBtn());
    await user.click(askBtn());
    await user.keyboard("{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolve(await reply(200, ANSWERED));
    await screen.findByRole("heading", { name: "Answer" });
    expect(askBtn().getAttribute("aria-busy")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

describe("errors", () => {
  it.each([
    [429, ERROR_MESSAGES.busy, true],
    [503, ERROR_MESSAGES.unavailable, true],
    [504, ERROR_MESSAGES.unavailable, true],
    [500, ERROR_MESSAGES.server, false],
    [502, ERROR_MESSAGES.server, false],
    [404, ERROR_MESSAGES.videoNotFound, false],
    [422, ERROR_MESSAGES.invalid, false],
  ])("HTTP %i: friendly message in role=alert, question kept, retry=%s", async (status, message, retry) => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(status, { detail: "SECRET internal text" }));
    setup();
    await openAndAsk(user, "my question");
    const alert = await screen.findByText(message, { exact: false });
    expect(alert.closest("[role='alert']")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/SECRET/);
    expect(input().value).toBe("my question");
    expect(!!screen.queryByRole("button", { name: "Try again" })).toBe(retry);
  });

  it("network failure shows the server-not-running message with Try again", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    setup();
    await openAndAsk(user, "my question");
    expect(await screen.findByText(ERROR_MESSAGES.network, { exact: false })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(input().value).toBe("my question");
  });

  it("Try again re-sends the question and shows the answer", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(429, { detail: "busy" }))
      .mockReturnValueOnce(reply(200, ANSWERED));
    setup();
    await openAndAsk(user);
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Answer" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("an unknown intervention is retried without it and the answer is shown normally", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(404, { detail: "Intervention not found" }))
      .mockReturnValueOnce(reply(200, ANSWERED));
    setup({ activeInterventionId: UUID });
    await openAndAsk(user);
    expect(await screen.findByRole("heading", { name: "Answer" })).toBeTruthy();
    expect(body(0).intervention_id).toBe(UUID);
    expect("intervention_id" in body(1)).toBe(false);
    expect(body(1).current_time_seconds).toBe(187.5);
  });

  it("404 'Video not found' shows the unavailable message and does not retry", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(404, { detail: "Video not found" }));
    setup({ activeInterventionId: UUID });
    await openAndAsk(user);
    expect(await screen.findByText(ERROR_MESSAGES.videoNotFound, { exact: false })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a malformed 200 response is reported as a server problem", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, { nope: true }));
    setup();
    await openAndAsk(user);
    expect(await screen.findByText(ERROR_MESSAGES.server, { exact: false })).toBeTruthy();
  });
});

describe("aborting and video changes", () => {
  it("aborts the in-flight request on unmount", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(new Promise(() => {}));
    const { unmount } = setup();
    await openAndAsk(user);
    const { signal } = fetchMock.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("switching video aborts the old request, ignores its late reply and clears the result", async () => {
    const user = userEvent.setup();
    let resolveOld;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolveOld = r)));
    const props = {
      getCurrentTime: () => 1,
      activeInterventionId: null,
      onSeek: vi.fn(),
      knownMomentIds: [],
    };
    const { rerender } = render(<AskLecture videoId={VIDEO} {...props} />);
    await openAndAsk(user);
    const { signal } = fetchMock.mock.calls[0][1];

    rerender(<AskLecture videoId="dQw4w9WgXcQ" {...props} />);
    expect(signal.aborted).toBe(true);
    resolveOld(await reply(200, ANSWERED));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(ANSWERED.answer_text)).toBeNull();
    await user.click(toggle());
    expect(input().value).toBe("");
    expect(askBtn().getAttribute("aria-busy")).toBeNull();
  });

  it("clears a shown result when the video changes", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(200, ANSWERED));
    const props = { getCurrentTime: () => 1, onSeek: vi.fn(), knownMomentIds: [] };
    const { rerender } = render(<AskLecture videoId={VIDEO} {...props} />);
    await openAndAsk(user);
    await screen.findByRole("heading", { name: "Answer" });
    rerender(<AskLecture videoId="dQw4w9WgXcQ" {...props} />);
    expect(screen.queryByRole("heading", { name: "Answer" })).toBeNull();
  });
});

describe("accessibility (axe)", () => {
  async function renderWithStatus(user, resp) {
    fetchMock.mockReturnValue(reply(200, resp));
    const view = setup({ knownMomentIds: [UUID] });
    await openAndAsk(user);
    await screen.findAllByRole("heading");
    return view;
  }

  it("has no violations when closed", async () => {
    const { container } = setup();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations when answered", async () => {
    const { container } = await renderWithStatus(userEvent.setup(), ANSWERED);
    expect(await axe(container)).toHaveNoViolations();
  });

  it.each(["insufficient_context", "not_in_lecture"])("has no violations for %s", async (status) => {
    const { container } = await renderWithStatus(userEvent.setup(), {
      status,
      scope: "lecture",
      answer_text: "Nothing here.",
      sources: [],
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no violations while showing an error with Try again", async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValue(reply(429, {}));
    const { container } = setup();
    await openAndAsk(user);
    await screen.findByRole("button", { name: "Try again" });
    expect(await axe(container)).toHaveNoViolations();
  });
});
