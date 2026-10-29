import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { extractYouTubeId, searchVideos } from "../lib/lectureSearch";
import { useVoiceActions } from "../voice/voiceActions";

// Single source of truth for the "paste a link or search" flow used by the
// Home screen and the subject-scoped lecture views — keeps status copy,
// detection behavior, and the processing hand-off identical everywhere.
export default function useLectureSearch({
  onProcess = () => {},
  defaultDepth = "standard",
  initialQuery = "",
} = {}) {
  const [url, setUrl] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState(""); // starts empty — announces nothing on load

  const resultsHeadingRef = useRef(null);
  const wasValidUrlRef = useRef(false);
  const searchSeqRef = useRef(0);
  const abortControllerRef = useRef(null);
  const lastQueryRef = useRef(initialQuery.trim());

  // Focus moves to the results heading once results actually appear,
  // so keyboard/screen-reader users land somewhere meaningful.
  useEffect(() => {
    if (results.length > 0) {
      resultsHeadingRef.current?.focus();
    }
  }, [results]);

  // Clean up any in-flight search on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const videoId = useMemo(() => extractYouTubeId(url), [url]);
  const isValidUrl = Boolean(videoId);

  const runSearch = useCallback(async (query) => {
    const cleanQuery = typeof query === "string" ? query.trim() : "";
    if (!cleanQuery) return;

    lastQueryRef.current = cleanQuery;
    const currentSeq = ++searchSeqRef.current;

    // Abort previous in-flight search
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setResults([]);
    setSearchError(null);
    setValidationError(null);
    setSearching(true);
    setStatusMessage("Searching.");

    try {
      const found = await searchVideos(cleanQuery, { signal: controller.signal });
      if (currentSeq !== searchSeqRef.current) {
        // Discard stale response
        return;
      }
      setResults(found);
      setSearchError(null);
      setStatusMessage(
        found.length === 0
          ? "No lectures found. Try another search term or paste a YouTube link."
          : `${found.length} lecture${found.length === 1 ? "" : "s"} found.`,
      );
    } catch (err) {
      if (err.name === "AbortError" || currentSeq !== searchSeqRef.current) {
        return;
      }
      const message = err.message || "Failed to search lectures.";
      setSearchError(message);
      setStatusMessage(message);
      setResults([]);
    } finally {
      if (currentSeq === searchSeqRef.current) {
        setSearching(false);
      }
    }
  }, []);

  const retrySearch = useCallback(() => {
    if (lastQueryRef.current) {
      runSearch(lastQueryRef.current);
    } else if (url.trim()) {
      runSearch(url.trim());
    }
  }, [runSearch, url]);

  // Hands a chosen result straight to the processing flow.
  // 1. Extracts its validated YouTube video URL
  // 2. Populates the existing selected-video state (url)
  // 3. Immediately calls the same processing handler used when a URL is pasted
  // 4. Passes selected explanation mode
  // 5. Disables repeated processing submissions while active
  const selectResult = useCallback(
    (video) => {
      if (submitting) return;

      const extractedId =
        video?.videoId ||
        video?.video_id ||
        extractYouTubeId(video?.canonicalUrl || video?.canonical_url);

      if (!extractedId) {
        const message = "This search result does not contain a valid YouTube video.";
        setValidationError(message);
        setStatusMessage(message);
        return;
      }

      const validatedUrl =
        video?.canonicalUrl ||
        video?.canonical_url ||
        `https://www.youtube.com/watch?v=${extractedId}`;

      // Update state without relying on asynchronous state for immediate processing call
      setUrl(validatedUrl);
      setValidationError(null);
      setSubmitting(true);

      try {
        onProcess({
          url: validatedUrl,
          videoId: extractedId,
          mode: defaultDepth,
          metadata: {
            videoTitle: video.title || "",
            videoAuthor: video.channel || video.channel_name || "",
            videoDuration: video.duration || video.duration_formatted || "",
            videoThumbnail: video.thumbnailUrl || video.thumbnail_url || "",
          },
        });
      } catch (err) {
        setSubmitting(false);
        throw err;
      }
    },
    [submitting, onProcess, defaultDepth],
  );

  const handleSubmit = useCallback(async () => {
    if (submitting || searching) return;

    if (isValidUrl) {
      setValidationError(null);
      setSubmitting(true);
      try {
        onProcess({ url, videoId, mode: defaultDepth });
      } catch (err) {
        setSubmitting(false);
        throw err;
      }
      return;
    }

    const query = url.trim();
    if (!query) {
      const message = "Please enter a lecture link or a search term.";
      setValidationError(message);
      setStatusMessage(message);
      return;
    }

    if (/^(?:https?:\/\/|www\.)/i.test(query) || /(?:youtube\.com|youtu\.be)/i.test(query)) {
      const message = "Enter a valid YouTube video URL.";
      setValidationError(message);
      setStatusMessage(message);
      setResults([]);
      return;
    }

    await runSearch(query);
  }, [submitting, searching, isValidUrl, onProcess, url, videoId, defaultDepth, runSearch]);

  // Announce detection as a real state change, once, on the false→true edge
  const handleUrlChange = useCallback((e) => {
    const next = e.target.value;
    setUrl(next);
    setValidationError(null);
    const nextValid = Boolean(extractYouTubeId(next));
    if (nextValid && !wasValidUrlRef.current) {
      setStatusMessage("YouTube lecture detected.");
    }
    wasValidUrlRef.current = nextValid;
  }, []);

  // By voice: the same actions the search box and result list offer (src/voice).
  useVoiceActions(
    {
      search_lectures: ({ query }) => {
        setUrl(query);
        return runSearch(query);
      },
      select_result: ({ index }) => {
        const video = results[index - 1];
        if (!video) throw new Error("no such result");
        setUrl(`https://youtube.com/watch?v=${video.videoId}`);
        setResults([]);
      },
      start_lecture: () => handleSubmit(),
      paste_url: async () => {
        let text;
        try {
          text = ((await navigator.clipboard.readText()) || "").trim();
        } catch {
          const err = new Error("clipboard blocked");
          err.spoken = "I couldn't read the clipboard. Allow clipboard access for this site, or paste with Control V.";
          throw err;
        }
        if (!text) {
          const err = new Error("clipboard empty");
          err.spoken = "The clipboard is empty. Copy a YouTube link first.";
          throw err;
        }
        setUrl(text);
        setValidationError(null);
        const valid = Boolean(extractYouTubeId(text));
        setStatusMessage(valid ? "YouTube lecture detected." : "Pasted from the clipboard.");
        wasValidUrlRef.current = valid;
      },
    },
    () => ({
      items: results.map((video, i) => ({ ref: video.videoId, kind: "result", label: video.title, position: i + 1 })),
    }),
  );

  return {
    url,
    setUrl,
    results,
    setResults,
    searching,
    searchError,
    validationError,
    submitting,
    statusMessage,
    setStatusMessage,
    resultsHeadingRef,
    videoId,
    isValidUrl,
    runSearch,
    retrySearch,
    selectResult,
    startLearning: selectResult, // alias for backwards compatibility
    handleSubmit,
    handleUrlChange,
  };
}
