import { useState, useMemo, useRef, useEffect } from "react";
import { extractYouTubeId, searchVideos } from "../lib/lectureSearch";

// Single source of truth for the "paste a link or search" flow used by the
// Home screen and the subject-scoped lecture views — keeps status copy,
// detection behavior, and the processing hand-off identical everywhere.
export default function useLectureSearch({ onProcess = () => {}, defaultDepth = "standard", initialQuery = "" } = {}) {
  const [url, setUrl] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [statusMessage, setStatusMessage] = useState(""); // starts empty — announces nothing on load
  const resultsHeadingRef = useRef(null);
  const wasValidUrlRef = useRef(false);

  // Focus moves to the results heading once results actually appear,
  // so keyboard/screen-reader users land somewhere meaningful —
  // not the input itself, which they never left.
  useEffect(() => {
    if (results.length > 0) {
      resultsHeadingRef.current?.focus();
    }
  }, [results]);

  const videoId = useMemo(() => extractYouTubeId(url), [url]);
  const isValidUrl = Boolean(videoId);

  const runSearch = async (query) => {
    setResults([]);
    setSearching(true);
    setStatusMessage("Searching.");
    const found = await searchVideos(query);
    setSearching(false);
    setResults(found);
    setStatusMessage(
      found.length === 0
        ? "No lectures found. Try another search term or paste a YouTube link."
        : `${found.length} lecture${found.length === 1 ? "" : "s"} found.`,
    );
  };

  const handleSubmit = async () => {
    if (isValidUrl) {
      onProcess({ url, videoId, mode: defaultDepth });
      return;
    }
    const query = url.trim();
    if (!query) {
      setStatusMessage("Please enter a lecture link or a search term.");
      return;
    }
    await runSearch(query);
  };

  // Announce detection as a real state change, once, on the false→true edge —
  // not "ready", since detecting a link isn't the same as processing it.
  const handleUrlChange = (e) => {
    const next = e.target.value;
    setUrl(next);
    const nextValid = Boolean(extractYouTubeId(next));
    if (nextValid && !wasValidUrlRef.current) {
      setStatusMessage("YouTube lecture detected.");
    }
    wasValidUrlRef.current = nextValid;
  };

  // Hands a chosen result straight to the same processing flow used for a
  // pasted link — the one existing "start learning" entry point.
  const startLearning = (video) => {
    onProcess({
      url: `https://youtube.com/watch?v=${video.videoId}`,
      videoId: video.videoId,
      mode: defaultDepth,
    });
  };

  return {
    url,
    setUrl,
    results,
    setResults,
    searching,
    statusMessage,
    setStatusMessage,
    resultsHeadingRef,
    videoId,
    isValidUrl,
    runSearch,
    handleSubmit,
    handleUrlChange,
    startLearning,
  };
}
