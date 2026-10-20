import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotePlayer } from "./useNotePlayer.js";

// jsdom has no object URLs; these stand in for the real ones.
let urlCount;
beforeEach(() => {
  urlCount = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake/${++urlCount}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

function setup(over = {}) {
  const audios = [];
  const createAudio = vi.fn((url) => {
    const a = { url, play: vi.fn(async () => {}), pause: vi.fn(), onended: null, onerror: null };
    audios.push(a);
    return a;
  });
  const loadAudio = vi.fn(async () => new Blob(["x"], { type: "audio/webm" }));
  const announce = vi.fn();
  const beforePlay = vi.fn();
  const hook = renderHook(() => useNotePlayer({ announce, beforePlay, loadAudio, createAudio, ...over }));
  return { hook, audios, createAudio, loadAudio, announce, beforePlay };
}
const note = (id = "a") => ({ id });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("useNotePlayer", () => {
  it("pauses the lecture first, then loads and plays the stored audio through a fresh blob URL", async () => {
    const order = [];
    const env = setup({
      beforePlay: vi.fn(() => order.push("beforePlay")),
      loadAudio: vi.fn(async () => { order.push("load"); return new Blob(["x"]); }),
    });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });

    expect(order).toEqual(["beforePlay", "load"]);
    expect(env.createAudio).toHaveBeenCalledWith("blob:fake/1");
    expect(env.audios[0].play).toHaveBeenCalled();
    expect(env.hook.result.current.playingId).toBe("a");
  });

  it("pressing the same note again stops it and revokes the URL", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake/1");
    expect(env.hook.result.current.playingId).toBeNull();
  });

  it("starting another note stops the first (only one plays at a time)", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    await act(async () => { await env.hook.result.current.toggle(note("b")); });
    expect(env.audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake/1");
    expect(env.hook.result.current.playingId).toBe("b");
    expect(env.audios).toHaveLength(2);
  });

  it("announces when playback finishes, and releases the audio", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    act(() => { env.audios[0].onended(); });
    expect(env.announce).toHaveBeenCalledWith("Finished playing voice note.");
    expect(env.hook.result.current.playingId).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake/1");
  });

  it("does not announce anything when playback starts or when the learner stops it", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.announce).not.toHaveBeenCalled();
  });

  it("explains a missing recording", async () => {
    const env = setup({ loadAudio: vi.fn(async () => { throw Object.assign(new Error("x"), { code: "not_found" }); }) });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.announce).toHaveBeenCalledWith("The recording for this voice note is missing.");
    expect(env.hook.result.current.error).toBe("The recording for this voice note is missing.");
    expect(env.hook.result.current.playingId).toBeNull();
    expect(env.createAudio).not.toHaveBeenCalled();
  });

  it("explains any other load failure", async () => {
    const env = setup({ loadAudio: vi.fn(async () => { throw new Error("db down"); }) });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.announce).toHaveBeenCalledWith("This voice note could not be loaded.");
  });

  it("explains a play() rejection and frees the URL", async () => {
    const env = setup({
      createAudio: vi.fn(() => ({ play: vi.fn(async () => { throw new Error("blocked"); }), pause: vi.fn() })),
    });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.announce).toHaveBeenCalledWith("This voice note could not be played.");
    expect(env.hook.result.current.playingId).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("explains an audio element error", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    act(() => { env.audios[0].onerror(); });
    expect(env.announce).toHaveBeenCalledWith("This voice note could not be played.");
  });

  it("stopping a note whose audio is still loading means it never starts", async () => {
    let finish;
    const slow = vi.fn(() => new Promise((resolve) => { finish = () => resolve(new Blob(["x"])); }));
    const env = setup({ loadAudio: slow });
    act(() => { void env.hook.result.current.toggle(note("a")); });
    env.hook.rerender();
    env.hook.result.current.stop();
    finish();
    await flush();
    expect(env.createAudio).not.toHaveBeenCalled();
    expect(env.hook.result.current.playingId).toBeNull();
  });

  it("unmounting stops playback and revokes the URL", async () => {
    const env = setup();
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    env.hook.unmount();
    expect(env.audios[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake/1");
  });

  it("unmounting while the audio is still loading never plays it", async () => {
    let finish;
    const env = setup({ loadAudio: vi.fn(() => new Promise((resolve) => { finish = () => resolve(new Blob(["x"])); })) });
    act(() => { void env.hook.result.current.toggle(note("a")); });
    env.hook.unmount();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(env.createAudio).not.toHaveBeenCalled();
  });

  it("a failing beforePlay (pausing the lecture) does not prevent playback", async () => {
    const env = setup({ beforePlay: vi.fn(() => { throw new Error("player gone"); }) });
    await act(async () => { await env.hook.result.current.toggle(note("a")); });
    expect(env.audios[0].play).toHaveBeenCalled();
  });
});
