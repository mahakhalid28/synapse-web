import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import useLectureSearch from "./useLectureSearch";
import * as lectureSearchModule from "../lib/lectureSearch";

describe("useLectureSearch hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes with empty or provided initial query", () => {
    const { result } = renderHook(() => useLectureSearch({ initialQuery: "Calculus" }));
    expect(result.current.url).toBe("Calculus");
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
    expect(result.current.searchError).toBeNull();
  });

  it("handles valid YouTube URL paste detection", () => {
    const { result } = renderHook(() => useLectureSearch());

    act(() => {
      result.current.handleUrlChange({
        target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      });
    });

    expect(result.current.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(result.current.videoId).toBe("dQw4w9WgXcQ");
    expect(result.current.isValidUrl).toBe(true);
    expect(result.current.statusMessage).toBe("YouTube lecture detected.");
  });

  it("submits a valid URL directly to onProcess", async () => {
    const onProcess = vi.fn();
    const { result } = renderHook(() =>
      useLectureSearch({ onProcess, defaultDepth: "detailed" }),
    );

    act(() => {
      result.current.handleUrlChange({
        target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(onProcess).toHaveBeenCalledTimes(1);
    expect(onProcess).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      videoId: "dQw4w9WgXcQ",
      mode: "detailed",
    });
  });

  it("searches and updates results and status message on success", async () => {
    const sampleResults = [
      {
        videoId: "vid1",
        title: "Calculus 101",
        channel: "Math Channel",
        duration: "05:00",
      },
    ];
    vi.spyOn(lectureSearchModule, "searchVideos").mockResolvedValueOnce(sampleResults);

    const { result } = renderHook(() => useLectureSearch());

    act(() => {
      result.current.handleUrlChange({ target: { value: "calculus" } });
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.searching).toBe(false);
    expect(result.current.results).toEqual(sampleResults);
    expect(result.current.searchError).toBeNull();
    expect(result.current.statusMessage).toBe("1 lecture found.");
  });

  it("discards stale search responses when newer queries finish first", async () => {
    let resolveFirst;
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve;
    });

    vi.spyOn(lectureSearchModule, "searchVideos")
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce([
        { videoId: "v2", title: "Second Search", channel: "C", duration: "1:00" },
      ]);

    const { result } = renderHook(() => useLectureSearch());

    // First search triggered
    let p1;
    act(() => {
      p1 = result.current.runSearch("first");
    });
    expect(result.current.searching).toBe(true);

    // Second search triggered immediately
    await act(async () => {
      await result.current.runSearch("second");
    });

    expect(result.current.results).toEqual([
      { videoId: "v2", title: "Second Search", channel: "C", duration: "1:00" },
    ]);

    // Now resolve the first search (which was delayed)
    await act(async () => {
      resolveFirst([
        { videoId: "v1", title: "First Search (Stale)", channel: "C", duration: "2:00" },
      ]);
      await p1;
    });

    // The results must NOT be overwritten by the stale first search!
    expect(result.current.results).toEqual([
      { videoId: "v2", title: "Second Search", channel: "C", duration: "1:00" },
    ]);
  });

  it("selectResult immediately calls onProcess with validated video info and sets submitting", () => {
    const onProcess = vi.fn();
    const { result } = renderHook(() =>
      useLectureSearch({ onProcess, defaultDepth: "brief" }),
    );

    const videoItem = {
      videoId: "NFZtjSeT3XE",
      title: "MIT Calculus",
      canonicalUrl: "https://www.youtube.com/watch?v=NFZtjSeT3XE",
    };

    act(() => {
      result.current.selectResult(videoItem);
    });

    expect(onProcess).toHaveBeenCalledTimes(1);
    expect(onProcess).toHaveBeenCalledWith({
      url: "https://www.youtube.com/watch?v=NFZtjSeT3XE",
      videoId: "NFZtjSeT3XE",
      mode: "brief",
      metadata: {
        videoTitle: "MIT Calculus",
        videoAuthor: "",
        videoDuration: "",
        videoThumbnail: "",
      },
    });
    expect(result.current.submitting).toBe(true);

    // A second click while submitting is ignored
    act(() => {
      result.current.selectResult(videoItem);
    });
    expect(onProcess).toHaveBeenCalledTimes(1);
  });

  it("reports a URL-like invalid value instead of searching for it", async () => {
    const onProcess = vi.fn();
    const { result } = renderHook(() => useLectureSearch({ onProcess }));

    act(() => {
      result.current.handleUrlChange({
        target: { value: "https://youtube.com/watch?v=too-short" },
      });
    });
    await act(async () => result.current.handleSubmit());

    expect(onProcess).not.toHaveBeenCalled();
    expect(result.current.validationError).toBe("Enter a valid YouTube video URL.");
  });
});

