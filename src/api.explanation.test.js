import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const INTERVENTION_ID = "11111111-1111-1111-1111-111111111111";
const VIDEO_ID = "AudioTest01";
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  };
}

function backendExplanation(overrides = {}) {
  return {
    intervention_id: INTERVENTION_ID,
    text_explanation: "First sentence. More detail follows.\n\nA second paragraph.",
    audio_file_path: "data/AudioTest01/interventions/11111111/explanatory.mp3",
    audio_url: `/video/intervention/${INTERVENTION_ID}/audio?output_mode=explanatory`,
    output_mode: "explanatory",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:synapse-explanation"),
  });
});

afterEach(() => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
  } else {
    delete URL.createObjectURL;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("explanation API compatibility", () => {
  it("maps frontend standard mode to explanatory and builds the audio request URL", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(backendExplanation()))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        blob: vi.fn(async () => new Blob(["audio"], { type: "audio/mpeg" })),
      });
    const { getTTSExplanation } = await import("./api");

    const result = await getTTSExplanation(INTERVENTION_ID, "standard", VIDEO_ID);

    expect(JSON.parse(fetch.mock.calls[0][1].body).output_mode).toBe("explanatory");
    expect(fetch.mock.calls[1][0]).toBe(
      `http://127.0.0.1:8000/video/intervention/${INTERVENTION_ID}/audio?output_mode=explanatory`,
    );
    expect(result.audio_file_path).toBe("blob:synapse-explanation");
    expect(result.audio_error).toBeNull();
  });

  it.each(["brief", "detailed"])("preserves frontend %s mode", async (mode) => {
    fetch
      .mockResolvedValueOnce(jsonResponse(backendExplanation({
        audio_url: null,
        audio_file_path: null,
        output_mode: mode,
      })));
    const { getTTSExplanation } = await import("./api");

    await getTTSExplanation(INTERVENTION_ID, mode, VIDEO_ID);

    expect(JSON.parse(fetch.mock.calls[0][1].body).output_mode).toBe(mode);
  });

  it("shares one cached explanation response between text and audio consumers", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(backendExplanation()))
      .mockResolvedValueOnce({
        ok: true,
        blob: vi.fn(async () => new Blob(["audio"])),
      });
    const { getExplanation, getTTSExplanation } = await import("./api");

    const [text, audio] = await Promise.all([
      getExplanation(INTERVENTION_ID, "standard", VIDEO_ID),
      getTTSExplanation(INTERVENTION_ID, "standard", VIDEO_ID),
    ]);

    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(text.subtitle).toBe("First sentence.");
    expect(text.paragraphs).not.toHaveLength(0);
    expect(audio.audio_file_path).toBe("blob:synapse-explanation");
  });

  it("keeps readable explanation text when audio is unavailable", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(backendExplanation()))
      .mockResolvedValueOnce({ ok: false, status: 404 });
    const { getExplanation, getTTSExplanation } = await import("./api");

    const text = await getExplanation(INTERVENTION_ID, "standard", VIDEO_ID);
    const audio = await getTTSExplanation(INTERVENTION_ID, "standard", VIDEO_ID);

    expect(text.subtitle).toBe("First sentence.");
    expect(audio.audio_file_path).toBeNull();
    expect(audio.audio_error).toMatch(/still read the explanation/i);
  });

  it("keeps readable explanation text when the audio request cannot connect", async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse(backendExplanation()))
      .mockRejectedValueOnce(new TypeError("network unavailable"));
    const { getExplanation, getTTSExplanation } = await import("./api");

    const text = await getExplanation(INTERVENTION_ID, "standard", VIDEO_ID);
    const audio = await getTTSExplanation(INTERVENTION_ID, "standard", VIDEO_ID);

    expect(text.subtitle).toBe("First sentence.");
    expect(audio.audio_file_path).toBeNull();
    expect(audio.audio_error).toMatch(/could not be loaded/i);
  });

  it("does not use a raw filesystem path as an audio URL", async () => {
    fetch.mockResolvedValueOnce(jsonResponse(backendExplanation({ audio_url: null })));
    const { getTTSExplanation } = await import("./api");

    const result = await getTTSExplanation(INTERVENTION_ID, "standard", VIDEO_ID);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.audio_file_path).toBeNull();
    expect(result.audio_error).toMatch(/unavailable/i);
  });

  it("does not fall back to mock explanations after a real backend failure", async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ detail: "offline" }, { ok: false, status: 503 }));
    const { getExplanation } = await import("./api");

    await expect(
      getExplanation(INTERVENTION_ID, "standard", VIDEO_ID),
    ).rejects.toThrow("Explain failed: 503");
  });

  it("rejects unsupported frontend modes before making a request", async () => {
    const { getExplanation } = await import("./api");
    await expect(
      getExplanation(INTERVENTION_ID, "explanatory", VIDEO_ID),
    ).rejects.toThrow("Unsupported explanation mode");
    expect(fetch).not.toHaveBeenCalled();
  });
});
