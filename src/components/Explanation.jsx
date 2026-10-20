import { useState, useEffect, useRef } from "react";
import jsPDF from "jspdf";
import Sidebar from "./Sidebar";
import {
  getExplanation,
  getInterventionPoints,
  getTTSExplanation,
} from "../api";
import {
  saveBookmark,
  removeBookmark,
  isBookmarked,
  saveToLibrary,
} from "../storage";
import { loadYouTubeIframeAPI } from "../lib/youtubeIframeApi";
import MomentMarker from "./MomentMarker";
import ProvenanceLabel from "./ProvenanceLabel";
import CategoryIcon from "./CategoryIcon";
import AskLecture from "./AskLecture";
import { formatTimestamp } from "../lib/askApi";
import VoiceNotes from "./VoiceNotes";

// "0:15", "1:22", "1:04:10" -> seconds. Same shape as the timestamps
// getInterventionPoints() already returns (see Timeline.jsx's own copy of
// this logic), just kept local here rather than shared across files.
function parseTimestampToSeconds(timestamp) {
  if (!timestamp) return 0;
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

/* ============================================================================
   Mock-only — "Ask about this visual"
   The backend endpoint for this doesn't exist yet. This stands in for it
   using the same mock-first pattern as getExplanation/getInterventionPoints
   in api.js (fixed delay, plausible canned content keyed off real data).
   TODO: replace with a real POST to the ask-about-visual endpoint once the
   backend team adds it (see API Contract).
   ============================================================================ */
// eslint-disable-next-line no-unused-vars -- no longer used; kept per request, see AskLecture.jsx
function mockAskAboutVisual(question, point) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(
        `On "${point.title}": ${question} — the short answer is that the ` +
          `most important thing to look at here is where the behavior ` +
          `changes rather than the absolute values themselves. Re-reading ` +
          `the explanation above with that in mind usually makes "${point.title}" ` +
          `click faster than staring at the numbers alone.`,
      );
    }, 500);
  });
}

// Pure math, no DOM access — unit-testable on its own. The video is a
// cross-origin YouTube iframe (no canvas/pixel access possible), so
// "focusing" an area is purely a CSS scale+translate on a wrapper element,
// never a redraw/crop of actual pixels.
//
// scale fills the frame with the region's larger dimension. translate
// re-centers the region's own center point — (region.x + region.w/2,
// region.y + region.h/2) — on the frame's center (50, 50). CSS resolves a
// translate() percentage against the element's own static (unscaled) box
// regardless of other functions in the same transform list, and transform
// functions apply to a point in the order written with the rightmost
// function nearest the point — so with "scale(s) translate(tx%, ty%)",
// translate is effectively applied first (in the original, unscaled
// coordinate space) and the result is then scaled. Solving for the
// translate that brings the region's center to (50, 50) under that
// composition gives the plain (not scale-multiplied) offsets below; this
// was verified by hand for top-left, centered, and bottom-right regions
// before relying on it here.
function computeFocusTransform(region) {
  const scale = 100 / Math.max(region.w, region.h);
  const centerX = region.x + region.w / 2;
  const centerY = region.y + region.h / 2;
  const translateX = 50 - centerX;
  const translateY = 50 - centerY;
  return `scale(${scale}) translate(${translateX}%, ${translateY}%)`;
}

// YT.PlayerState codes -> the names used by playerState below.
const PLAYER_STATE_NAMES = { 0: "ended", 1: "playing", 2: "paused", 3: "buffering" };

// Single source for the on-page list and the spoken version (Alt+K).
const RATES = [0.75, 1, 1.25, 1.5, 2];

const SHORTCUTS = [
  ["Alt+P", "Play, pause or resume the lecture"],
  ["Alt+L", "Listen to or pause the explanation audio"],
  ["Alt+N", "Next moment"],
  ["Alt+B", "Previous moment"],
  ["Alt+R", "Read: jump to the start of the explanation"],
  ["Alt+. / Alt+,", "Listen faster / slower"],
  ["Alt+M", "Start or stop a voice note"],
  ["Alt+K", "Hear this list"],
];
const SHORTCUTS_SPOKEN =
  "Keyboard shortcuts. " +
  SHORTCUTS.map(([k, d]) =>
    `${k.replace("Alt+. / Alt+,", "Alt plus period, or Alt plus comma").replace("+", " plus ")}: ${d}.`,
  ).join(" ");

/**
 * Explanation — opens when the user clicks a point on the Timeline.
 *
 * Props:
 *   - jobId, videoId, pointId, mode
 *   - onNavigate(key)
 */
export default function Explanation({
  jobId,
  videoId,
  pointId = null,
  mode = "standard",
  promise = null, // in-flight processVideo() promise when arriving straight from Home
  bookmarkData = null, // pre-populated when navigating from Bookmarks
  autoPlay = false, // auto-start audio when navigating from Library
  startSeconds = null, // cue the lecture at this time (opening a voice note); null = use the moment's own time
  onNavigate: onNavigateRaw = () => {},
  onOpenTimeline: onOpenTimelineRaw = () => {}, // jumps to Timeline for this same lecture, carrying the active point over
  onStartPractice: onStartPracticeRaw = null, // opens Practice for this lecture; the button exists only when this is provided (feature flag)
}) {
  const initialPoint = bookmarkData
    ? {
        id: bookmarkData.pointId,
        title: bookmarkData.title,
        category: bookmarkData.category,
        timestamp: bookmarkData.timestamp,
      }
    : null;
  const preloadedExpl = useRef(bookmarkData?.explanation || null);

  const [allPoints, setAllPoints] = useState(
    initialPoint ? [initialPoint] : [],
  );
  const [videoTitle, setVideoTitle] = useState(bookmarkData?.videoTitle || "");
  const [videoDuration, setVideoDuration] = useState("");
  const [videoAuthor, setVideoAuthor] = useState("");
  // Short, one-off transition announcements only (never the full explanation
  // text) — a separate sr-only live region from the always-visible status
  // text below, so screen reader users hear exactly the two messages spec'd
  // for the pause/resume flow without the whole sidebar or explanation
  // being read aloud.
  const [srAnnouncement, setSrAnnouncement] = useState("");
  // The single path for every spoken state change. Clearing first (then
  // setting after a beat) makes a repeated identical message re-announce,
  // and keeping this the only live region means exactly one message per event.
  const announceTimerRef = useRef(null);
  const announce = (msg) => {
    clearTimeout(announceTimerRef.current);
    setSrAnnouncement("");
    announceTimerRef.current = setTimeout(() => {
      setSrAnnouncement(msg);
      // Don't leave stale text sitting in the reading flow once it was spoken.
      announceTimerRef.current = setTimeout(() => setSrAnnouncement(""), 5000);
    }, 60);
  };
  useEffect(() => () => clearTimeout(announceTimerRef.current), []);

  // "Playing." / "Paused." / "Lecture resumed." must only be spoken once the
  // YouTube player has actually reached that state, never on the keypress
  // that merely asked for it. A command registers what it expects here; the
  // player's onStateChange (below) confirms it. If the player never gets
  // there, the learner is told so instead of hearing a state that isn't true.
  const expectedStateRef = useRef(null); // { target, okMsg, timer }
  const expectPlayerState = (target, okMsg, failMsg) => {
    const current = PLAYER_STATE_NAMES[playerRef.current?.getPlayerState?.()];
    if (current === target) {
      announce(okMsg);
      return;
    }
    clearTimeout(expectedStateRef.current?.timer);
    expectedStateRef.current = {
      target,
      okMsg,
      timer: setTimeout(() => {
        expectedStateRef.current = null;
        announce(failMsg);
      }, 5000),
    };
  };
  // Re-pointed every render so the player callback (bound once per video)
  // always reaches the current announce().
  const confirmPlayerStateRef = useRef(() => {});
  useEffect(() => {
    confirmPlayerStateRef.current = (name) => {
      const exp = expectedStateRef.current;
      if (!exp || exp.target !== name) return;
      clearTimeout(exp.timer);
      expectedStateRef.current = null;
      announce(exp.okMsg);
    };
  });
  useEffect(() => () => clearTimeout(expectedStateRef.current?.timer), []);

  const [activePointId, setActivePointId] = useState(pointId);
  // Explicit user selection, or the first point once points have loaded, if
  // nothing's been chosen yet (arriving straight from Home rather than via
  // Timeline/Bookmarks/Library, where a specific point is already known).
  const effectiveActivePointId = activePointId ?? allPoints[0]?.id ?? null;
  const [explanation, setExplanation] = useState(
    bookmarkData?.explanation || null,
  );
  const [bookmarked, setBookmarked] = useState(false);

  // Inline processing status (replaces the old full-screen Processing
  // route) — tracks the same processVideo() promise Home kicked off.
  const [isProcessing, setIsProcessing] = useState(Boolean(promise));
  const [processingError, setProcessingError] = useState(null);
  const [processingProgress, setProcessingProgress] = useState(0);
  const processingStartRef = useRef(null);

  // Audio playback — real HTML5 Audio via TTS backend
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  const [audioLoading, setAudioLoading] = useState(false);
  // Listening speed for Synapse's explanation audio (screen-reader users often
  // listen at 2x+); remembered across moments and sessions.
  const [playbackRate, setPlaybackRate] = useState(() => {
    try {
      const saved = parseFloat(localStorage.getItem("synapse_tts_rate"));
      return RATES.includes(saved) ? saved : 1;
    } catch {
      return 1;
    }
  });
  const playbackRateRef = useRef(playbackRate);
  // Points whose explanation audio has completed at least once this
  // session — drives the "Played automatically · Replay" vs "Listen" label
  // distinction below. Persists across point navigation within the same
  // lecture (revisiting an already-heard point should still say "Replay"),
  // but resets whenever the lecture itself changes (see the videoId effect
  // further down).
  const [playedPointIds, setPlayedPointIds] = useState(() => new Set());

  // YouTube video playback — real, controllable embed with automatic
  // pause-and-explain behavior at each intervention point's timestamp.
  const playerContainerRef = useRef(null);
  const playerRef = useRef(null); // the YT.Player instance, for imperative control
  const [playerReady, setPlayerReady] = useState(false);
  // Real YouTube player state ("unstarted" | "playing" | "paused" |
  // "buffering" | "ended") — drives the status line and Play/Pause control so
  // neither claims "Playing." before the learner has actually started it.
  const [playerState, setPlayerState] = useState("unstarted");
  // Who currently owns the video's pause: null (playing, nobody owns it),
  // "user" (student paused/seeked manually), or "intervention" (Synapse
  // auto-paused for an explanation). This is the single source of truth for
  // whether auto-resume is allowed — never a plain boolean.
  const [pauseOwner, setPauseOwner] = useState(null);
  const pauseOwnerRef = useRef(pauseOwner); // lets the TTS "ended" handler read the latest value without re-binding
  const triggeredPointIdsRef = useRef(new Set()); // intervention points already auto-triggered this session
  // Set by <VoiceNotes>: toggle() for Alt+M, lectureStarted() when the lecture or
  // TTS is started (blocks it while a note is being recorded), requestLeave(fn)
  // to save or discard an unsaved recording before navigating away. Null until mounted.
  const voiceControlRef = useRef(null);

  // "accessibility" (default) | "study" — purely a rendering choice. Every
  // piece of state/data-fetching/pauseOwner/timestamp-watching above is
  // identical in both modes; only how the video and its status are
  // displayed changes below.
  // Persisted (same localStorage pattern as App.jsx's theme) so a user's
  // choice survives opening a new lecture or returning from Timeline —
  // without this, Explanation.jsx remounting fresh each time silently
  // reset a blind user back to re-selecting Accessibility Mode every
  // single visit. First-time visitors (no saved value yet) still default
  // to Accessibility Mode as the safer non-visual-first starting point;
  // this never guesses who the user is from the device/browser.
  const [presentationMode, setPresentationMode] = useState(() => {
    const saved = localStorage.getItem("synapse_presentation_mode");
    return saved === "study" || saved === "accessibility" ? saved : "accessibility";
  });
  // Scales only the main reading content (title, subtitle, Explanation
  // heading, paragraphs, key insight) — WCAG 1.4.4 text resize, session-only.
  const [textScale, setTextScale] = useState(1);
  // Forces a real higher-contrast rendering of the same reading content
  // (WCAG 1.4.3/1.4.6) — addresses contrast-sensitivity loss, a distinct
  // condition from the acuity loss textScale addresses. Independent of
  // textScale; both can be on at once.
  const [highContrast, setHighContrast] = useState(false);
  // "visual" (default, the video/paused-frame area above — no new content)
  // | "structured" (new: factual-only label/value decomposition, mock data
  // for now). Separate from presentationMode — this toggles what's shown
  // between the video and the explanation card, not how the video itself
  // is presented.
  const [visualTab, setVisualTab] = useState("visual");
  const visualTabRefs = useRef({});
  // Belongs to the current intervention point, not the lecture — reset to
  // false whenever the active point changes (see that effect below). Purely
  // a CSS transform toggle on the video wrapper; touches nothing about
  // playback (see computeFocusTransform above for why/how).
  const [focusActive, setFocusActive] = useState(false);
  const listenBtnRef = useRef(null);
  // Start of the explanation content. In Accessibility Mode, focus lands here
  // whenever a new moment becomes active (auto-pause, Next/Previous, jump) so
  // the learner is already at the content instead of on a control far below it.
  const explanationHeadingRef = useRef(null);

  useEffect(() => {
    pauseOwnerRef.current = pauseOwner;
  }, [pauseOwner]);

  // Read by the interval/handlers below without re-binding them on mode change.
  const presentationModeRef = useRef(presentationMode);
  useEffect(() => {
    presentationModeRef.current = presentationMode;
  }, [presentationMode]);

  // Never auto-reads: the explanation waits for the learner to press Listen
  // (or read it with their own screen reader). Focus just goes to its start.
  const focusExplanationStart = () => {
    if (presentationModeRef.current !== "accessibility") return;
    setTimeout(() => explanationHeadingRef.current?.focus(), 0);
  };

  useEffect(() => {
    localStorage.setItem("synapse_presentation_mode", presentationMode);
  }, [presentationMode]);

  // A new lecture — clear "has this point been heard" tracking. Navigating
  // between points within the same lecture must NOT hit this (only the
  // videoId dependency), since a previously-played point should still read
  // as played when revisited.
  useEffect(() => {
    setPlayedPointIds(new Set());
  }, [videoId]);

  // Track the in-flight processVideo() promise (same elapsed-time-based
  // progress estimate Processing.jsx used) and drive the compact inline
  // status indicator instead of a separate blocking screen.
  useEffect(() => {
    if (!promise) return;
    // isProcessing/processingError already start correct for this promise via
    // their useState initializers above — this effect only needs to react to
    // the promise settling, not re-assert the starting state.
    processingStartRef.current = Date.now();

    const ESTIMATED_MS = 90_000;
    const interval = setInterval(() => {
      const elapsed = Date.now() - processingStartRef.current;
      setProcessingProgress(
        Math.min(95, Math.round((elapsed / ESTIMATED_MS) * 100)),
      );
    }, 1000);

    promise
      .then(() => {
        clearInterval(interval);
        setProcessingProgress(100);
        setIsProcessing(false);
      })
      .catch(() => {
        clearInterval(interval);
        setIsProcessing(false);
        setProcessingError(
          "Something went wrong while preparing this lecture.",
        );
      });

    return () => clearInterval(interval);
  }, [promise]);

  // Load all points (for the left sidebar contents list) — waits for
  // processing to finish, since the backend has nothing to return until then.
  useEffect(() => {
    if (isProcessing || processingError) return;
    getInterventionPoints(jobId, videoId)
      .then((result) => {
        setAllPoints(result.points);
        if (result.points.length > 0) {
          const n = result.points.length;
          let intro = "";
          // First lecture ever only: say how the session works, once, in the
          // same single message (never a second announcement).
          try {
            if (
              presentationModeRef.current === "accessibility" &&
              !localStorage.getItem("synapse_intro_seen")
            ) {
              localStorage.setItem("synapse_intro_seen", "1");
              intro =
                " Press Play lecture to begin. It pauses at each visual; then read the explanation below or use the Listen button. Press Alt plus K for keyboard shortcuts.";
            }
          } catch {
            // storage unavailable — skip the one-time hint
          }
          // Names the moment on screen too — the heading changes from
          // "Preparing your lecture" without any other spoken cue.
          const startIdx = Math.max(
            0,
            result.points.findIndex((p) => p.id === pointId),
          );
          announce(
            `Lecture ready. ${n} moment${n === 1 ? "" : "s"} found. Showing moment ${startIdx + 1}: ${result.points[startIdx].title}.${intro}`,
          );
        }
        setVideoTitle(result.videoTitle || "");
        // Both already returned alongside videoTitle by this same call — no
        // new fetch needed. Left blank if the backend/mock ever omits them.
        setVideoDuration(result.duration || "");
        setVideoAuthor(result.author || "");
      })
      .catch((err) => console.error("Failed to load points:", err));
  }, [jobId, videoId, pointId, isProcessing, processingError]);

  // Initialize the real YouTube player once the API is loaded and the
  // container is in the DOM. Kept alive for the life of this videoId —
  // controlled imperatively (pauseVideo/playVideo/seekTo) from elsewhere.
  useEffect(() => {
    if (!videoId || !playerContainerRef.current) return;
    let cancelled = false;
    let player = null;

    loadYouTubeIframeAPI().then((YT) => {
      if (cancelled || !playerContainerRef.current) return;
      player = new YT.Player(playerContainerRef.current, {
        videoId,
        playerVars: { rel: 0 },
        events: {
          onReady: (e) => {
            playerRef.current = e.target;
            setPlayerReady(true);
          },
          // The video can also be resumed via its own native controls, not
          // just our "Resume video" button — whenever it actually starts
          // playing, pause ownership is released either way.
          onStateChange: (e) => {
            const YT_PLAYING = window.YT?.PlayerState?.PLAYING ?? 1;
            if (e.data === YT_PLAYING) {
              setPauseOwner(null);
              // While a voice note is being recorded this pauses the lecture again
              // (and says why); otherwise it just stops a voice note that is playing.
              voiceControlRef.current?.lectureStarted();
            }
            const name = PLAYER_STATE_NAMES[e.data] ?? "unstarted";
            setPlayerState(name);
            confirmPlayerStateRef.current(name);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      playerRef.current = null;
      setPlayerReady(false);
      setPlayerState("unstarted");
      player?.destroy?.();
    };
  }, [videoId]);

  // Opened on a specific moment (Timeline, Library, Bookmarks): start the
  // video there instead of at 0:00, so what plays matches the explanation on
  // screen. Cued, not played — the learner still presses Play.
  const initialCueDoneRef = useRef(false);
  useEffect(() => {
    if (initialCueDoneRef.current || !playerReady) return;
    if (!pointId && startSeconds == null) return;
    // Wait for the moments to load, so the one at the cue point can be marked
    // as already triggered (otherwise the first Play would auto-pause at once).
    if (allPoints.length === 0) return;
    const target = pointId ? allPoints.find((p) => p.id === pointId) : null;
    if (startSeconds == null && !target) return;
    initialCueDoneRef.current = true;
    if (target) triggeredPointIdsRef.current.add(target.id);
    if (startSeconds != null) {
      for (const p of allPoints) {
        if (Math.abs(parseTimestampToSeconds(p.timestamp) - startSeconds) <= 0.6) {
          triggeredPointIdsRef.current.add(p.id);
        }
      }
    }
    playerRef.current?.cueVideoById?.({
      videoId,
      startSeconds: startSeconds ?? parseTimestampToSeconds(target.timestamp),
    });
  }, [playerReady, allPoints, pointId, videoId, startSeconds]);

  // While the video is playing and nothing owns the pause, watch for the
  // next untriggered intervention point's timestamp and auto-pause there.
  // This effect only ever runs its interval while pauseOwner is null — once
  // an intervention (or the user) takes ownership, it tears down and simply
  // doesn't restart until ownership is released back to null, which is
  // exactly what prevents two close-together points from flickering.
  useEffect(() => {
    if (!playerReady || pauseOwner !== null) return;

    const YT_PLAYING = window.YT?.PlayerState?.PLAYING ?? 1;
    const interval = setInterval(() => {
      const player = playerRef.current;
      if (!player || typeof player.getPlayerState !== "function") return;
      if (player.getPlayerState() !== YT_PLAYING) return;

      const currentSeconds = player.getCurrentTime();
      for (const point of allPoints) {
        if (triggeredPointIdsRef.current.has(point.id)) continue;
        const pointSeconds = parseTimestampToSeconds(point.timestamp);
        if (Math.abs(currentSeconds - pointSeconds) <= 0.5) {
          triggeredPointIdsRef.current.add(point.id);
          player.pauseVideo();
          setPauseOwner("intervention");
          setActivePointId(point.id);
          // The one announcement for this event (the visible status line is
          // deliberately not a live region) — names the moment so the
          // learner knows what changed without hunting for the heading.
          const n = allPoints.findIndex((p) => p.id === point.id) + 1;
          announce(
            `Paused at moment ${n} of ${allPoints.length}, ${point.timestamp}. ${capitalize(point.category)}: ${point.title}. The explanation is below; use Listen to hear it.`,
          );
          focusExplanationStart();
          break;
        }
      }
    }, 300);

    return () => clearInterval(interval);
  }, [playerReady, pauseOwner, allPoints]);

  // Load text explanation + kick off TTS fetch when point/mode changes
  useEffect(() => {
    if (!effectiveActivePointId) return;
    // Guards the two async calls below against a slower response for a
    // point the learner has already navigated away from landing after a
    // newer one and silently overwriting it with stale content — same
    // cancellation pattern already used for the YouTube player init effect
    // above. Doesn't change anything observable under the current fixed
    // mock delay, but matters the moment responses stop all resolving in
    // call order (e.g. a real backend with variable latency).
    let cancelled = false;
    if (!preloadedExpl.current) setExplanation(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setAudioUrl(null);
    setAudioLoading(true);
    // Focus belongs to this point's visual, not the lecture — a new point
    // (even one with no focusRegion) always starts back at the full frame.
    setFocusActive(false);

    setBookmarked(isBookmarked(`${videoId}-${effectiveActivePointId}`));

    // Text explanation
    getExplanation(effectiveActivePointId, mode, videoId)
      .then((data) => {
        if (cancelled) return;
        setExplanation(data);
        preloadedExpl.current = null;
      })
      .catch((err) => {
        if (!cancelled) console.error("Failed to load explanation:", err);
      });

    // TTS audio — runs in parallel (shares the same HTTP request via cache)
    getTTSExplanation(effectiveActivePointId, mode, videoId)
      .then((tts) => {
        if (!cancelled) setAudioUrl(tts.audio_file_path);
      })
      .catch((err) => {
        if (!cancelled) console.error("TTS fetch failed:", err);
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [effectiveActivePointId, mode, videoId]);

  // Wire up the HTML5 Audio element whenever the URL changes
  useEffect(() => {
    if (!audioUrl) return;

    const audio = new Audio(audioUrl);
    audio.playbackRate = playbackRateRef.current;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoaded = () => setAudioDuration(audio.duration);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      // Mark this point as heard — drives the "Played automatically ·
      // Replay" label below. effectiveActivePointId is safe to close over
      // here: this effect re-runs (rebinding onEnded) every time the audio
      // URL changes, which happens exactly when the active point changes.
      setPlayedPointIds((prev) =>
        prev.has(effectiveActivePointId)
          ? prev
          : new Set(prev).add(effectiveActivePointId),
      );
      // Auto-resume the video only if Synapse is the one holding the pause —
      // read via the ref since this listener isn't re-bound on every
      // pauseOwner change (see pauseOwnerRef above).
      if (pauseOwnerRef.current === "intervention") {
        // Said only once the player really is playing again.
        expectPlayerState(
          "playing",
          "Explanation finished. Lecture resumed.",
          "Explanation finished, but the lecture did not resume. Press Resume lecture.",
        );
        playerRef.current?.playVideo?.();
        setPauseOwner(null);
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("ended", onEnded);

    // Auto-play when coming from the Library "Play audio" button
    if (autoPlay) {
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, [audioUrl]);

  // ---- Actions -------------------------------------------------------------

  // Sidebar clicks and prev/next navigation are the "user" ownership path:
  // seek + pause the real player, then hand pause ownership to the user.
  const selectPointManually = (id) => {
    const point = allPoints.find((p) => p.id === id);
    if (point) {
      // Seeking lands exactly on this point's timestamp — mark it as already
      // triggered, otherwise the first Resume would immediately auto-pause
      // again at the very spot the learner just chose to review.
      triggeredPointIdsRef.current.add(id);
      const seconds = parseTimestampToSeconds(point.timestamp);
      playerRef.current?.seekTo?.(seconds, true);
      playerRef.current?.pauseVideo?.();
    }
    setPauseOwner("user");
    setActivePointId(id);
    if (point) {
      const idx = allPoints.findIndex((p) => p.id === id);
      announce(
        `Moment ${idx + 1} of ${allPoints.length}, at ${point.timestamp}. ${capitalize(point.category)}: ${point.title}.${isLecturePlaying ? " Video paused." : ""} The explanation is below.`,
      );
      focusExplanationStart();
    }
  };

  // The learner's own Play / Pause / Resume control for the lecture (the
  // YouTube iframe is inert in Accessibility Mode, so this is the only way
  // to start it). The button's visible text changes with state, but NVDA
  // doesn't re-read a text-content change on the focused button (only an
  // aria-label change) — so the new state is announced explicitly.
  const handleLectureToggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playerState === "playing" || playerState === "buffering") {
      expectPlayerState("paused", "Paused.", "The lecture did not pause.");
      player.pauseVideo?.();
      setPauseOwner("user");
    } else {
      expectPlayerState(
        "playing",
        "Playing.",
        "The lecture did not start. Press Play lecture to try again.",
      );
      handleResumeVideo();
    }
  };

  // The one manual "resume" affordance, regardless of who currently owns
  // the pause. If Synapse's explanation audio is still playing, stop it
  // first so it never overlaps the lecture audio once the video resumes.
  const handleResumeVideo = () => {
    // Recording a voice note: the lecture stays paused (it would be recorded).
    if (voiceControlRef.current?.lectureStarted()) return;
    if (pauseOwner === "intervention" && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    setPauseOwner(null);
    playerRef.current?.playVideo?.();
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      // Same rule for Synapse's own TTS: not while a voice note is being recorded.
      if (voiceControlRef.current?.lectureStarted()) return;
      if (audioDuration > 0 && currentTime >= audioDuration)
        audio.currentTime = 0;
      audio
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {});
    }
  };

  // Applies live (mid-playback) and persists; spoken once.
  const changeRate = (rate, speak = true) => {
    playbackRateRef.current = rate;
    setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
    try {
      localStorage.setItem("synapse_tts_rate", String(rate));
    } catch {
      // storage unavailable — the choice just won't persist
    }
    // The native <select> already speaks its new value to a screen reader.
    if (speak) announce(`Listening speed ${rate} times.`);
  };
  const stepRate = (dir) => {
    const i = RATES.indexOf(playbackRateRef.current);
    const next = RATES[Math.min(RATES.length - 1, Math.max(0, i + dir))];
    if (next === playbackRateRef.current) {
      announce(dir > 0 ? "Already at the fastest speed." : "Already at the slowest speed.");
      return;
    }
    changeRate(next);
  };

  const handleBookmark = () => {
    const id = `${videoId}-${effectiveActivePointId}`;
    if (bookmarked) {
      removeBookmark(id);
      setBookmarked(false);
    } else if (activePoint && explanation) {
      saveBookmark({
        id,
        pointId: effectiveActivePointId,
        videoId,
        jobId,
        videoTitle,
        title: activePoint.title,
        category: activePoint.category,
        timestamp: activePoint.timestamp,
        mode,
        explanation: {
          subtitle: explanation.subtitle,
          paragraphs: explanation.paragraphs || [],
          keyInsight: explanation.keyInsight,
        },
        savedAt: Date.now(),
      });
      setBookmarked(true);
    }
  };

  const handleExportPDF = () => {
    if (!explanation) return;
    exportToPDF(explanation, activePoint);
  };

  const handleExportAudio = () => {
    if (!explanation) return;
    exportToAudio(explanation, activePoint);
  };

  // The layout changes substantially; the toggle's own "pressed" says which
  // button, this says what it did.
  const switchPresentationMode = (next) => {
    if (next === presentationMode) return;
    setPresentationMode(next);
    announce(
      next === "study"
        ? "Study mode on. The lecture video is now shown."
        : "Accessibility mode on. The video is hidden; the lecture audio still plays.",
    );
  };

  // Standard WAI-ARIA tabs keyboard pattern (automatic activation): arrow
  // keys both move focus and select, Home/End jump to the ends.
  // VISUAL_TAB_ORDER itself is declared further down (it depends on
  // structuredRows, computed in the Derived data section below) — safe to
  // reference here via closure since this function only runs on a later
  // keydown event, by which point the whole component body has finished
  // executing for this render.
  const handleVisualTabKeyDown = (e) => {
    const idx = VISUAL_TAB_ORDER.indexOf(visualTab);
    let nextTab = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextTab = VISUAL_TAB_ORDER[(idx + 1) % VISUAL_TAB_ORDER.length];
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextTab =
        VISUAL_TAB_ORDER[
          (idx - 1 + VISUAL_TAB_ORDER.length) % VISUAL_TAB_ORDER.length
        ];
    } else if (e.key === "Home") {
      nextTab = VISUAL_TAB_ORDER[0];
    } else if (e.key === "End") {
      nextTab = VISUAL_TAB_ORDER[VISUAL_TAB_ORDER.length - 1];
    }
    if (nextTab) {
      e.preventDefault();
      setVisualTab(nextTab);
      visualTabRefs.current[nextTab]?.focus();
    }
  };

  // Purely a CSS-transform toggle on the video wrapper (see
  // computeFocusTransform above) — never touches pauseVideo/playVideo/
  // seekTo, pauseOwner, or the intervention-detection interval, all of
  // which read/control the real player independently of this state.
  const handleToggleFocus = () => {
    const next = !focusActive;
    setFocusActive(next);
    announce(next ? "Showing focused view." : "Showing full frame.");
  };

  // "Where in the lecture" source buttons from <AskLecture>: seek the real
  // player and hand the pause to the learner (they press Play when ready),
  // the same ownership model as selecting a moment manually.
  const handleAskSeek = (seconds) => {
    const player = playerRef.current;
    if (!player?.seekTo) {
      announce("The lecture player isn't ready yet.");
      return;
    }
    player.seekTo(seconds, true);
    player.pauseVideo?.();
    setPauseOwner("user");
    announce(`Jumped to ${formatTimestamp(seconds)}. Lecture paused.`);
  };

  // Voice notes: pause the lecture AND Synapse's TTS and hand the pause to the
  // learner (owner "user"), so neither is ever resumed automatically, not even
  // by the TTS "ended" handler, which only resumes an "intervention" pause.
  const pauseLectureAudio = () => {
    clearTimeout(expectedStateRef.current?.timer); // don't announce a stale "did not start"
    expectedStateRef.current = null;
    audioRef.current?.pause();
    setIsPlaying(false);
    playerRef.current?.pauseVideo?.();
    setPauseOwner("user");
  };

  // Every way out of this screen goes through here, so an unsaved voice note
  // gets a Save / Discard / Stay choice instead of being lost.
  const leaveScreen = (go) => {
    const control = voiceControlRef.current;
    if (control) control.requestLeave(go);
    else go();
  };
  const onNavigate = (key) => leaveScreen(() => onNavigateRaw(key));
  const onOpenTimeline = (id) => leaveScreen(() => onOpenTimelineRaw(id));
  const onStartPractice = () => leaveScreen(() => onStartPracticeRaw());

  // ---- Derived data --------------------------------------------------------

  // Use a fallback so the screen renders even if allPoints hasn't loaded yet
  const activePoint = allPoints.find(
    (p) => p.id === effectiveActivePointId,
  ) ?? {
    id: effectiveActivePointId,
    // Placeholder until the first point loads. App.jsx focuses this <h1> on
    // arrival, so the screen reader speaks it — "Explanation" alone said nothing
    // about what was happening.
    title: isProcessing ? "Preparing your lecture" : "Loading your lecture",
    category: "diagram",
    timestamp: "",
  };

  // Factual-only rows for Structured View / Accessible visual information —
  // carried directly on the intervention object itself (per-point, from the
  // normalized data in api.js's MOCK_INTERVENTIONS — the same shape a real
  // backend response will eventually provide), not looked up by category.
  // null when this point has no structured data — the Structured View tab
  // itself doesn't render in that case (Study Mode) / the section is
  // omitted entirely (Accessibility Mode), instead of fabricating rows or
  // showing a tab that only ever resolves to an empty state.
  const structuredRows = activePoint.structured?.rows ?? null;

  // Only includes "structured" when this point actually has it, so
  // keyboard navigation (arrows/Home/End) never lands on a tab that isn't
  // rendered.
  const VISUAL_TAB_ORDER = structuredRows ? ["visual", "structured"] : ["visual"];
  // Falls back to "visual" for rendering when the raw tab preference
  // (visualTab) is "structured" but the active point has no structured
  // data — e.g. after Previous/Next moves from a point that had it to one
  // that doesn't. Doesn't discard the user's actual preference: revisiting
  // a point that does have structured data restores it automatically.
  const effectiveVisualTab =
    visualTab === "structured" && !structuredRows ? "visual" : visualTab;

  // null when this point has no focus region — the toggle button simply
  // doesn't render in that case (see change 3: no disabled state).
  const focusRegion = activePoint.focusRegion ?? null;

  // Save to library once both explanation AND point metadata are ready.
  // The explanation can arrive before the moment list does, when activePoint
  // is still the "Loading your lecture" placeholder — saving then wrote a
  // nameless entry to the Library, so wait for the real point.
  const hasPointDetails = allPoints.some((p) => p.id === effectiveActivePointId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!explanation || !hasPointDetails) return;
    saveToLibrary({
      id: `${videoId}-${effectiveActivePointId}`,
      pointId: effectiveActivePointId,
      videoId,
      jobId,
      videoTitle,
      title: activePoint.title,
      category: activePoint.category,
      timestamp: activePoint.timestamp,
      mode,
      explanation,
      savedAt: Date.now(),
    });
  }, [explanation, activePoint?.id, hasPointDetails]); // fires when explanation + real point details are both ready

  useEffect(() => {
    document.title = `${activePoint.title} – Synapse`;
  }, [activePoint.title]);

  // Contents panel order — chronological across all points regardless of
  // category, not grouped by category.
  const sortedPoints = [...allPoints].sort(
    (a, b) =>
      parseTimestampToSeconds(a.timestamp) -
      parseTimestampToSeconds(b.timestamp),
  );

  // Explanation audio-controls label — reflects what actually happened for
  // THIS point, not a static "press play" instruction.
  const hasPlayedCurrent = playedPointIds.has(effectiveActivePointId);
  const audioLabel = isPlaying
    ? "Playing · Pause"
    : hasPlayedCurrent
      ? "Played automatically · Replay"
      : "Listen";
  // Once heard and not currently playing, this is a secondary/replay
  // control rather than the primary way to hear the explanation.
  const audioControlsDeemphasized = !isPlaying && hasPlayedCurrent;

  const currentIndex = allPoints.findIndex(
    (p) => p.id === effectiveActivePointId,
  );
  const prevPoint = currentIndex > 0 ? allPoints[currentIndex - 1] : null;
  const nextPoint =
    currentIndex < allPoints.length - 1 ? allPoints[currentIndex + 1] : null;

  const isLecturePlaying =
    playerState === "playing" || playerState === "buffering";
  const lectureControlLabel = !playerReady
    ? "Loading lecture player…"
    : isLecturePlaying
      ? "Pause lecture"
      : playerState === "unstarted"
        ? "Play lecture"
        : playerState === "ended"
          ? "Replay lecture"
          : "Resume lecture";
  // Honest, state-derived copy — "Playing." only when it really is.
  const statusText =
    pauseOwner === "intervention"
      ? presentationMode === "study"
        ? isPlaying
          ? "Explaining this moment…"
          : "Video paused for explanation."
        : "Paused for this moment's explanation."
      : isLecturePlaying
        ? "Playing."
        : playerState === "unstarted"
          ? "Lecture not started."
          : playerState === "ended"
            ? "Lecture finished."
            : "Paused.";

  // Keyboard shortcuts (Alt+letter — NVDA leaves these to the app, and the
  // letters avoid Electron's default menu mnemonics F/E/V/W/H). The listener
  // is bound once; it reads the latest handlers through this ref, refreshed
  // after every render.
  const shortcutsRef = useRef({});
  useEffect(() => {
    shortcutsRef.current = {
      KeyP: handleLectureToggle,
      KeyL: () => {
        if (!audioRef.current) {
          announce("Explanation audio isn't ready yet.");
          return;
        }
        // With the Listen button focused its own name change is already
        // spoken ("Pause explanation audio"), so only announce otherwise.
        if (document.activeElement !== listenBtnRef.current) {
          announce(isPlaying ? "Explanation paused." : "Listening to the explanation.");
        }
        togglePlay();
      },
      KeyN: () =>
        nextPoint
          ? selectPointManually(nextPoint.id)
          : announce("This is the last moment."),
      KeyB: () =>
        prevPoint
          ? selectPointManually(prevPoint.id)
          : announce("This is the first moment."),
      KeyR: () => explanationHeadingRef.current?.focus(),
      Period: () => stepRate(1),
      Comma: () => stepRate(-1),
      KeyM: () => {
        if (!voiceControlRef.current) {
          announce("Voice notes aren't ready yet.");
          return;
        }
        voiceControlRef.current.toggle();
      },
      KeyK: () => announce(SHORTCUTS_SPOKEN),
    };
  });
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && t.type === "text"))) return;
      // e.code is empty for some synthetic/assistive-tech key events, so fall
      // back to the typed letter.
      const code =
        e.code ||
        ({ ".": "Period", ",": "Comma" }[e.key] ??
          (e.key?.length === 1 ? `Key${e.key.toUpperCase()}` : ""));
      const action = shortcutsRef.current[code];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---- Render --------------------------------------------------------------

  return (
    <div className="flex h-full w-full bg-background font-sans overflow-hidden">
      <nav aria-label="Main navigation">
        <Sidebar active="home" onNavigate={onNavigate} />
      </nav>

      {/* Workbench — main reading column + (Study mode) Lecture Details
          column, capped and centered on very wide screens so the layout
          doesn't stretch edge-to-edge; the Sidebar above stays flush-left
          like on every other screen. */}
      <div className="flex flex-1 max-w-[1400px] mx-auto overflow-hidden">
        {/* Main reading area */}
        <main
          id="main-content"
          tabIndex={-1}
          aria-label="Lecture explanation"
          className="flex-1 overflow-y-auto outline-none"
        >
          <div className="max-w-[720px] px-14 py-10">
            {/* Inline processing status — replaces the old full-screen Processing route */}
            {(isProcessing || processingError) && (
              <div
                role={processingError ? "alert" : undefined}
                className="mb-6 flex items-center gap-3 px-4 py-3 bg-surface border border-border-subtle rounded-radius-md"
              >
                {processingError ? (
                  <>
                    <span className="text-[14px] text-text-secondary flex-1">
                      {processingError}
                    </span>
                    <button
                      onClick={() => onNavigate("home")}
                      className="text-[14px] text-accent hover:text-text-primary underline underline-offset-2 focus-ring rounded-radius-sm"
                    >
                      Back to Home
                    </button>
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
                    {/* Spoken once (static text); the ticking percentage is
                    visual-only so it isn't re-announced every second. */}
                    <span role="status" className="sr-only">
                      Preparing your lecture. This can take about a minute.
                    </span>
                    <span
                      aria-hidden="true"
                      className="text-[14px] text-text-secondary flex-1"
                    >
                      Preparing your lecture… {processingProgress}%
                    </span>
                    <button
                      onClick={() => onNavigate("home")}
                      className="text-[14px] text-text-secondary hover:text-text-primary underline underline-offset-2 focus-ring rounded-radius-sm"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Header — focused on the current concept being explained, not
              lecture-level metadata (that lives in the Lecture Details
              sidebar). Title first, then the Moment header identifying
              this as a moment within the lecture, at its timestamp. */}
            <h1
              className="font-bold text-text-primary leading-tight tracking-tight"
              style={{ fontSize: `${32 * textScale}px` }}
            >
              {activePoint.title}
            </h1>

            <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
              {/* Moment header — the strongest attention element below the
              title: which point in the lecture this is, at a glance.
              Deliberately a separate, static element from the aria-live
              status line further down (that announces play/pause state
              changes) — this never changes that live region's content or
              structure, just displays which moment is active. Shared by
              both modes (Accessibility Mode wants the same marker/chip
              treatment here too, per the design spec). */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-accent-soft border border-border-subtle rounded-radius-sm">
                <MomentMarker className="text-accent" />
                <span className="text-[14px] text-text-secondary">
                  Lecture moment ·{" "}
                  <span className="font-mono tabular-nums text-text-primary">
                    {activePoint.timestamp}
                  </span>
                </span>
                <span className="ds-chip">
                  <CategoryIcon category={activePoint.category} />
                  {capitalize(activePoint.category)}
                </span>
              </div>

              {/* Text size + High contrast are visual presentation settings
              with no effect on what a screen reader announces — Accessibility
              Mode has no visual viewport to adjust, so these never render
              there (no useless focusable controls in that mode's tab order). */}
              {presentationMode === "study" && (
                <div className="flex items-center gap-2 shrink-0">
                  <div
                    role="group"
                    aria-label="Text size"
                    className="flex items-center gap-1"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setTextScale((s) => Math.max(0.85, s - 0.15))
                      }
                      aria-label="Decrease text size"
                      className="w-7 h-7 flex items-center justify-center rounded-radius-sm border border-border-strong text-text-secondary text-[14px] font-medium hover:bg-surface-muted hover:text-text-primary transition-colors focus-ring"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setTextScale((s) => Math.min(1.6, s + 0.15))
                      }
                      aria-label="Increase text size"
                      className="w-7 h-7 flex items-center justify-center rounded-radius-sm border border-border-strong text-text-secondary text-[14px] font-medium hover:bg-surface-muted hover:text-text-primary transition-colors focus-ring"
                    >
                      +
                    </button>
                  </div>

                  {/* Separate setting from Text size above — contrast, not
                  scale. Independent state; either, both, or neither can be
                  active at once. */}
                  <button
                    type="button"
                    onClick={() => setHighContrast((v) => !v)}
                    aria-pressed={highContrast}
                    className={
                      "h-7 px-2.5 flex items-center justify-center rounded-radius-sm border text-[14px] font-medium transition-colors focus-ring " +
                      (highContrast
                        ? "bg-accent-soft text-text-primary font-semibold border-accent"
                        : "border-border-strong text-text-secondary hover:bg-surface-muted hover:text-text-primary")
                    }
                  >
                    High contrast
                  </button>
                </div>
              )}
            </div>

            {/* Where am I? — Study mode shows this in the Lecture Details
              panel; Accessibility mode has no such panel, so the lecture,
              its author, and the position within the sequence are spoken
              here, right after the moment header. */}
            {presentationMode === "accessibility" && (
              <p className="mt-3 text-[14px] text-text-secondary">
                {videoTitle ? `Lecture: ${videoTitle}` : "Lecture"}
                {videoAuthor ? ` by ${videoAuthor}` : ""}
                {videoDuration ? `, length ${videoDuration}` : ""}.{" "}
                {allPoints.length > 0 && currentIndex >= 0
                  ? `Moment ${currentIndex + 1} of ${allPoints.length}.`
                  : ""}
              </p>
            )}

            <p
              className={
                "mt-3 mb-7 " +
                (highContrast ? "text-black" : "text-text-secondary")
              }
              style={{ fontSize: `${15 * textScale}px` }}
            >
              {explanation
                ? explanation.subtitle
                : effectiveActivePointId
                  ? "Loading this explanation…"
                  : "Your lecture is being prepared — the first explanation will appear here shortly."}
            </p>

            {/* Presentation mode toggle — a segmented control: selected
            uses a filled accent + bold weight, unselected a plain
            surface/border-strong boundary, per the design spec. */}
            <div
              role="group"
              aria-label="Presentation mode"
              className="mb-6 inline-flex rounded-radius-md border border-border-strong overflow-hidden"
            >
              <button
                type="button"
                aria-pressed={presentationMode === "accessibility"}
                onClick={() => switchPresentationMode("accessibility")}
                className={
                  "px-3.5 py-2 text-[14px] transition-colors focus-ring " +
                  (presentationMode === "accessibility"
                    ? "bg-accent text-on-accent font-semibold"
                    : "bg-surface text-text-secondary font-medium hover:bg-surface-muted")
                }
              >
                Accessibility mode
              </button>
              <button
                type="button"
                aria-pressed={presentationMode === "study"}
                onClick={() => switchPresentationMode("study")}
                className={
                  "px-3.5 py-2 text-[14px] border-l border-border-strong transition-colors focus-ring " +
                  (presentationMode === "study"
                    ? "bg-accent text-on-accent font-semibold"
                    : "bg-surface text-text-secondary font-medium hover:bg-surface-muted")
                }
              >
                Study mode
              </button>
            </div>

            {/* Video — the player itself and its DOM container are never
              unmounted between modes (that would kill the lecture's audio,
              its only content in Accessibility mode). Accessibility mode
              only visually hides the video area (sr-only, not display:none —
              display:none suspends the iframe's playback; this doesn't) and
              swaps in a plain status line covering the same state. */}
            <div className="my-9">
              <div
                id="lecture-video-region"
                role="region"
                aria-label="Lecture video"
                className={
                  presentationMode === "study"
                    ? "aspect-video rounded-radius-md overflow-hidden relative bg-surface-muted border border-border-subtle"
                    : "sr-only"
                }
                /* `inert` in Accessibility Mode removes the visually-hidden
                   YouTube player from the tab order and the accessibility
                   tree (its ~12 lines of title/channel/controls otherwise
                   interrupt reading) — audio keeps playing, since inert
                   doesn't touch media. Study Mode keeps the player fully
                   interactive. */
                inert={presentationMode === "study" ? undefined : ""}
              >
                {/* This wrapper — not the ref'd div below — is what gets the
                focus transform. YT.Player *replaces* playerContainerRef's
                own div with an <iframe> in place once initialized, so a
                style on that div itself would silently stop applying to
                anything visible; this wrapper is never touched by the
                YouTube API and stays fully React-owned. */}
                <div
                  className="w-full h-full"
                  style={{
                    transform:
                      focusActive && focusRegion
                        ? computeFocusTransform(focusRegion)
                        : "scale(1) translate(0%, 0%)",
                    transformOrigin: "center center",
                  }}
                >
                  <div ref={playerContainerRef} className="w-full h-full" />
                </div>
                {presentationMode === "study" && !playerReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-[14px] text-text-muted pointer-events-none">
                    Loading video…
                  </div>
                )}
              </div>

              {/* Small status indicator, not an overlay — describes the real
                playback state for sighted users and for screen-reader users
                reading the page. It is deliberately NOT a live region: every
                spoken state change goes through the single sr-only region
                below, so one event is announced exactly once. */}
              <div className="mt-3 text-[14px] text-text-secondary">
                {statusText}
              </div>

              {/* Screen-reader-only announcements — one short message per
                event (never the explanation text itself, so it never
                overlaps or duplicates what Synapse's TTS is reading). */}
              <div role="status" aria-live="polite" className="sr-only">
                {srAnnouncement}
              </div>

              {/* Accessibility mode's lecture control — the YouTube iframe is
                inert there, so this is the learner's only way to start,
                pause and resume the lecture. Study mode's equivalent (Resume
                video) sits with the explanation's audio controls below. */}
              {presentationMode === "accessibility" && (
                <div className="mt-3">
                  <button
                    type="button"
                    aria-keyshortcuts="Alt+P"
                    onClick={handleLectureToggle}
                    disabled={!playerReady}
                    className="ds-btn-primary"
                  >
                    <span aria-hidden="true">
                      {playerState === "playing" || playerState === "buffering"
                        ? "❚❚"
                        : "▶"}
                    </span>{" "}
                    {lectureControlLabel}
                  </button>
                </div>
              )}
            </div>

            {/* Visual View / Structured View tabs — Study Mode only.
              Accessibility Mode has no visual viewport to switch between
              representations of (the video is sr-only there), so these tabs
              — along with the Visual View tabpanel's "Focus important area"
              control — never render in that mode; the same factual
              information Structured View shows is instead exposed as
              ordinary navigable content ("Accessible visual information")
              inside the explanation flow below. Visual View (default) is
              just the video area above; nothing new renders for it.
              Structured View is a factual-only label/value decomposition
              of the current visual — per-point data (activePoint.structured),
              mock for now (see MOCK_INTERVENTIONS in api.js). */}
            {presentationMode === "study" && (
              <>
                <div
                  role="tablist"
                  aria-label="Visual content view"
                  className="mb-6 inline-flex rounded-radius-md border border-border-strong overflow-hidden"
                >
                  <button
                    type="button"
                    role="tab"
                    id="visual-tab-visual"
                    ref={(el) => (visualTabRefs.current.visual = el)}
                    aria-selected={effectiveVisualTab === "visual"}
                    aria-controls="visual-tabpanel-visual"
                    tabIndex={effectiveVisualTab === "visual" ? 0 : -1}
                    onClick={() => setVisualTab("visual")}
                    onKeyDown={handleVisualTabKeyDown}
                    className={
                      "px-3.5 py-2 text-[14px] transition-colors focus-ring " +
                      (effectiveVisualTab === "visual"
                        ? "bg-accent text-on-accent font-semibold"
                        : "bg-surface text-text-secondary font-medium hover:bg-surface-muted")
                    }
                  >
                    Visual View
                  </button>
                  {/* Only when this point actually has structured data —
                  never a tab that only ever resolves to an empty state. */}
                  {structuredRows && (
                    <button
                      type="button"
                      role="tab"
                      id="visual-tab-structured"
                      ref={(el) => (visualTabRefs.current.structured = el)}
                      aria-selected={effectiveVisualTab === "structured"}
                      aria-controls="visual-tabpanel-structured"
                      tabIndex={effectiveVisualTab === "structured" ? 0 : -1}
                      onClick={() => setVisualTab("structured")}
                      onKeyDown={handleVisualTabKeyDown}
                      className={
                        "px-3.5 py-2 text-[14px] border-l border-border-strong transition-colors focus-ring " +
                        (effectiveVisualTab === "structured"
                          ? "bg-accent text-on-accent font-semibold"
                          : "bg-surface text-text-secondary font-medium hover:bg-surface-muted")
                      }
                    >
                      Structured View
                    </button>
                  )}
                </div>

                {effectiveVisualTab === "visual" && (
                  <div
                    id="visual-tabpanel-visual"
                    role="tabpanel"
                    aria-labelledby="visual-tab-visual"
                    className={focusRegion ? "mb-9" : ""}
                  >
                    {/* Only for categories with mock region data — no
                    disabled state when a point has no focusRegion, per spec. */}
                    {focusRegion && (
                      <button
                        type="button"
                        onClick={handleToggleFocus}
                        aria-pressed={focusActive}
                        className={
                          "h-7 px-2.5 inline-flex items-center justify-center rounded-radius-sm border text-[14px] font-medium transition-colors focus-ring " +
                          (focusActive
                            ? "bg-accent-soft border-accent text-text-primary font-semibold"
                            : "border-border-strong text-text-secondary hover:bg-surface-muted hover:text-text-primary")
                        }
                      >
                        {focusActive
                          ? "Showing focused view — click to see full frame"
                          : "Focus important area"}
                      </button>
                    )}
                  </div>
                )}

                {/* effectiveVisualTab can only be "structured" when
                structuredRows exists (see its derivation above), so this
                panel never needs an empty-state branch. */}
                {effectiveVisualTab === "structured" && structuredRows && (
                  <div
                    id="visual-tabpanel-structured"
                    role="tabpanel"
                    aria-labelledby="visual-tab-structured"
                    className={
                      "mb-9 rounded-radius-lg p-6 " +
                      (highContrast
                        ? "bg-white border-2 border-black"
                        : "bg-surface border border-border-subtle")
                    }
                  >
                    <ProvenanceLabel kind="video" className="mb-4" />
                    <dl className="space-y-3 m-0">
                      {structuredRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex flex-col sm:flex-row sm:gap-3"
                        >
                          <dt
                            className={
                              "font-semibold shrink-0 sm:w-40 m-0 " +
                              (highContrast ? "text-black" : "text-text-secondary")
                            }
                            style={{ fontSize: `${14 * textScale}px` }}
                          >
                            {row.label}
                          </dt>
                          <dd
                            className={
                              "m-0 " + (highContrast ? "text-black" : "text-text-primary")
                            }
                            style={{ fontSize: `${14 * textScale}px` }}
                          >
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </>
            )}

            {/* Explanation card — the main learning content, immediately below
              the video, grouped as one clearly-bordered workbench card
              (heading, body, key insight, audio controls, secondary actions,
              and prev/next all belong to this one unit). */}
            <div
              className={
                "rounded-radius-lg p-7 md:p-10 " +
                (highContrast
                  ? "bg-white border-2 border-black"
                  : "bg-surface border border-border-subtle")
              }
            >
              {/* A bare container, not a named region: a region named "Explanation" followed by an "Explanation" heading was spoken twice. */}
              <div>
                <h2
                  id="explanation-heading"
                  ref={explanationHeadingRef}
                  tabIndex={-1}
                  className={
                    "outline-none font-semibold mb-4 " +
                    (highContrast ? "text-black" : "text-text-primary")
                  }
                  style={{ fontSize: `${24 * textScale}px` }}
                >
                  Explanation
                </h2>

                {/* Structured View's rows are factual, detected from the
                video; this prose is Synapse's own interpretation of what
                they mean — the two are genuinely different kinds of
                content, not a styling choice, so the label is accurate
                here (unlike Key Insight below, which is part of this same
                interpretive content, not a separately-sourced claim). */}
                <ProvenanceLabel kind="interpretation" className="mb-4" />

                <div
                  className={
                    "leading-[1.65] " +
                    (highContrast
                      ? "text-black font-medium"
                      : "text-text-primary")
                  }
                  style={{ fontSize: `${18 * textScale}px` }}
                >
                  {explanation?.paragraphs?.map((para, i) => (
                    <p key={i} className="mb-[18px]">
                      {para}
                    </p>
                  ))}
                </div>

                {/* Accessible visual information — Accessibility Mode's
                non-visual replacement for the Study Mode "Structured View"
                tab. Same underlying factual data (activePoint.structured),
                exposed as ordinary navigable DOM content rather than a tab,
                since there's no visual viewport here to switch a tab
                against. Never aria-live — this is substantive content the
                student reads at their own pace. Omitted entirely (not a
                "not available" message) when this point has no structured
                data, per the reading order spec. Carries the same
                ProvenanceLabel as Study Mode's Structured View tab (added
                Phase 5) since it's the identical underlying factual data —
                "From the video", not a Synapse interpretation. */}
                {presentationMode === "accessibility" && (
                  <div className="mb-7">
                    <h3
                      className={
                        "font-semibold mb-3 " +
                        (highContrast ? "text-black" : "text-text-primary")
                      }
                      style={{ fontSize: `${18 * textScale}px` }}
                    >
                      Accessible visual information
                    </h3>
                    {structuredRows ? (
                      <>
                    <ProvenanceLabel kind="video" className="mb-3" />
                    <dl className="space-y-2 m-0">
                      {structuredRows.map((row) => (
                        <div
                          key={row.label}
                          className="flex flex-col sm:flex-row sm:gap-3"
                        >
                          <dt
                            className={
                              "font-semibold shrink-0 sm:w-40 m-0 " +
                              (highContrast ? "text-black" : "text-text-secondary")
                            }
                            style={{ fontSize: `${15 * textScale}px` }}
                          >
                            {row.label}
                          </dt>
                          <dd
                            className={
                              "m-0 " + (highContrast ? "text-black" : "text-text-primary")
                            }
                            style={{ fontSize: `${15 * textScale}px` }}
                          >
                            {row.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                      </>
                    ) : (
                      // Say so, rather than leaving the section out — silence
                      // can't be told apart from "I missed it".
                      <p
                        className={highContrast ? "text-black" : "text-text-secondary"}
                        style={{ fontSize: `${15 * textScale}px` }}
                      >
                        A detailed description of this visual isn&rsquo;t
                        available for this moment. The explanation above
                        describes what it means.
                      </p>
                    )}
                  </div>
                )}

                {/* Key insight pull quote */}
                {explanation?.keyInsight && (
                  <>
                  {/* A real heading so heading navigation finds it and the
                  quote is introduced before it is read; the visible label
                  below stays where it was and is hidden from screen readers
                  so it isn't spoken twice. */}
                  <h3 className="sr-only">Key insight</h3>
                  <blockquote className="my-7 pl-6 py-1 border-l-2 border-accent text-text-secondary">
                    <p
                      className={
                        "m-0 leading-[1.65] " + (highContrast ? "text-black" : "")
                      }
                      style={{ fontSize: `${18 * textScale}px` }}
                    >
                      {explanation.keyInsight}
                    </p>
                    <p
                      aria-hidden="true"
                      className="text-[14px] text-text-muted mt-2.5"
                    >
                      Key insight
                    </p>
                  </blockquote>
                  </>
                )}

                {/* Lecture-wide question answering (see AskLecture.jsx).
                The moment id is passed only while the learner has selected
                or paused on a moment (pauseOwner set), never while the video
                is merely playing past one. */}
                <AskLecture
                  videoId={videoId}
                  getCurrentTime={() => playerRef.current?.getCurrentTime?.()}
                  activeInterventionId={pauseOwner !== null ? effectiveActivePointId : null}
                  onSeek={handleAskSeek}
                  onSelectMoment={selectPointManually}
                  knownMomentIds={allPoints.map((p) => p.id)}
                />

                {/* Personal voice notes about this lecture (see VoiceNotes.jsx).
                Recording pauses the lecture and TTS and never resumes them. */}
                <VoiceNotes
                  videoId={videoId}
                  jobId={jobId}
                  videoTitle={videoTitle}
                  getLectureSeconds={() => playerRef.current?.getCurrentTime?.()}
                  getPointId={() => (pauseOwner !== null ? effectiveActivePointId : null)}
                  pauseLectureAudio={pauseLectureAudio}
                  announce={announce}
                  onGoToTime={handleAskSeek}
                  controlRef={voiceControlRef}
                />

                {/* Audio controls — Listen/Pause controls ONLY Synapse's
                explanation TTS; Resume video (Study mode, shown only while
                Synapse holds the pause) controls ONLY the lecture video.
                They're kept as two distinct, clearly-labelled buttons,
                never combined. */}
                <div className="mt-9 px-5 py-4 bg-surface-muted rounded-radius-md flex items-center gap-4 flex-wrap">
                  {/* Listen/Pause cluster — de-emphasized (via opacity) once
                  this point's explanation has already played and isn't
                  currently playing, since it's then a secondary "replay"
                  control rather than the primary way to hear it. Resume
                  video (below, outside this wrapper) is never affected by
                  that de-emphasis. */}
                  <div
                    className={
                      "flex items-center gap-4 flex-1 min-w-[220px] transition-opacity " +
                      (audioControlsDeemphasized ? "opacity-70" : "")
                    }
                  >
                    <button
                      ref={listenBtnRef}
                      aria-keyshortcuts="Alt+L"
                      onClick={togglePlay}
                      aria-disabled={!audioUrl || undefined}
                      aria-label={
                        isPlaying
                          ? "Pause explanation audio"
                          : "Listen to explanation audio"
                      }
                      className={"w-11 h-11 rounded-full bg-accent-soft border border-accent text-accent flex items-center justify-center shrink-0 hover:bg-surface transition-colors focus-ring " +
                        (!audioUrl ? "opacity-40 cursor-not-allowed" : "")
                      }
                    >
                      {audioLoading ? (
                        <span aria-hidden="true" className="text-[8px]">
                          …
                        </span>
                      ) : (
                        <span aria-hidden="true" className="text-xs ml-0.5">
                          {isPlaying ? "❚❚" : "▶"}
                        </span>
                      )}
                    </button>

                    <div className="flex-1 min-w-[160px]">
                      {/* Progress track */}
                      <div className="h-0.5 bg-border-subtle rounded-full relative">
                        <div
                          className="h-full bg-accent rounded-full transition-all duration-100"
                          style={{
                            width:
                              audioDuration > 0
                                ? `${(currentTime / audioDuration) * 100}%`
                                : "0%",
                          }}
                        />
                        {audioDuration > 0 && (
                          <div
                            className="absolute top-1/2 w-2.5 h-2.5 bg-accent rounded-full transition-all duration-100"
                            style={{
                              left: `${(currentTime / audioDuration) * 100}%`,
                              transform: "translate(-50%, -50%)",
                            }}
                          />
                        )}
                      </div>

                      {/* Time row */}
                      <div className="flex justify-between mt-2 font-mono text-[14px] text-text-muted">
                        <span className="tabular-nums">{formatTime(currentTime)}</span>
                        <span className="font-sans text-text-secondary">
                          {audioLoading ? "Loading audio…" : audioLabel}
                        </span>
                        <span className="tabular-nums">
                          {audioDuration > 0
                            ? formatTime(audioDuration)
                            : "--:--"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[14px] text-text-secondary shrink-0">
                    Listening speed
                    <select
                      value={playbackRate}
                      onChange={(e) => changeRate(parseFloat(e.target.value), false)}
                      aria-keyshortcuts="Alt+. Alt+,"
                      className="min-h-[36px] px-2 rounded-radius-sm border border-border-strong bg-surface text-text-primary focus-ring"
                    >
                      {RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* The one primary (filled-accent) action in this
                  cluster, per the design spec: Resume video = primary,
                  Listen = secondary/accent-outline above. */}
                  {presentationMode === "study" &&
                    pauseOwner === "intervention" && (
                      <button
                        onClick={() => {
                          expectPlayerState(
                            "playing",
                            "Playing.",
                            "The lecture did not resume. Press Resume video to try again.",
                          );
                          handleResumeVideo();
                          // This button unmounts as the pause is released —
                          // hand focus to Listen rather than dropping it.
                          listenBtnRef.current?.focus();
                        }}
                        className="ds-btn-primary shrink-0"
                      >
                        <span aria-hidden="true">▶</span> Resume video
                      </button>
                    )}
                </div>
              </div>

              {/* Secondary actions — deliberately quieter (plain text-style
              buttons) than the Listen/Pause + Resume video controls above,
              which are the primary learning actions on this screen. */}
              <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5">
                {/* aria-pressed (with a constant name) so a screen reader says
                "pressed" / "not pressed" on activation — the old text swap
                to "Bookmarked" was silent. */}
                <button
                  onClick={handleBookmark}
                  disabled={!explanation}
                  aria-pressed={bookmarked}
                  className="ds-btn-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">{bookmarked ? "★" : "❏"}</span>
                  Bookmark
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={!explanation}
                  className="ds-btn-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">↓</span>
                  Export PDF
                </button>
                <button
                  onClick={handleExportAudio}
                  disabled={!explanation}
                  className="ds-btn-text disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">↓</span>
                  Export audio
                </button>
                {/* Only rendered when App provides the callback (VITE_QUIZ_ENABLED). Leaves through
                leaveScreen like every other way out, so an unsaved voice-note draft is still protected. */}
                {onStartPracticeRaw && (
                  <button onClick={onStartPractice} className="ds-btn-text">
                    <span aria-hidden="true">✎</span>
                    Practice this lecture
                  </button>
                )}
              </div>

              {/* Prev/next navigation */}
              <div className="flex justify-between mt-9 pt-6 border-t border-border-subtle text-[14px]">
                {prevPoint ? (
                  <button
                    onClick={() => selectPointManually(prevPoint.id)}
                    aria-keyshortcuts="Alt+B"
                    className="text-left text-text-secondary hover:text-text-primary transition-colors rounded-radius-sm focus-ring"
                  >
                    <div className="text-[14px] text-text-muted mb-1">
                      ← Previous
                    </div>
                    <div className="text-[14px] text-text-primary">
                      {prevPoint.title}
                    </div>
                  </button>
                ) : (
                  <div />
                )}

                {nextPoint && (
                  <button
                    onClick={() => selectPointManually(nextPoint.id)}
                    aria-keyshortcuts="Alt+N"
                    className="text-right text-text-secondary hover:text-text-primary transition-colors rounded-radius-sm focus-ring"
                  >
                    <div className="text-[14px] text-text-muted mb-1">
                      Next →
                    </div>
                    <div className="text-[14px] text-text-primary">
                      {nextPoint.title}
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Moments in this lecture — Accessibility mode's equivalent of
              the Study-mode Lecture Details list: lets the learner hear how
              many moments exist and jump straight to any of them. */}
            {presentationMode === "accessibility" && sortedPoints.length > 0 && (
              <section aria-labelledby="moments-heading" className="mt-10">
                <h2
                  id="moments-heading"
                  className="text-[18px] font-semibold text-text-primary mb-3"
                >
                  Moments in this lecture
                </h2>
                <ul className="space-y-1">
                  {sortedPoints.map((point, i) => {
                    const isActive = point.id === effectiveActivePointId;
                    return (
                      <li key={point.id}>
                        <button
                          type="button"
                          onClick={() => selectPointManually(point.id)}
                          aria-current={isActive ? "step" : undefined}
                          className={
                            "w-full text-left px-3 py-2 rounded-radius-sm text-[14px] border transition-colors focus-ring " +
                            (isActive
                              ? "border-accent bg-accent-soft text-text-primary font-medium"
                              : "border-transparent text-text-secondary hover:bg-surface-muted")
                          }
                        >
                          Moment {i + 1}, {point.timestamp}: {point.title},{" "}
                          {point.category}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <section aria-labelledby="shortcuts-heading" className="mt-10">
              <h2
                id="shortcuts-heading"
                className="text-[18px] font-semibold text-text-primary mb-3"
              >
                Keyboard shortcuts
              </h2>
              <ul className="space-y-1 text-[14px] text-text-secondary">
                {SHORTCUTS.map(([keys, what]) => (
                  <li key={keys}>
                    <span className="font-mono text-text-primary">{keys}</span>
                    {" — "}
                    {what}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </main>

        {/* Lecture Details panel — Study-mode-oriented addition, same as the
          video area itself is only visually shown in Study mode; the
          intervention points list previously lived in the left Contents
          panel and moved here unchanged (same data/click handler/active
          state), just restyled and relabeled. */}
        {presentationMode === "study" && (
          <aside
            aria-label="Lecture details"
            className="w-[300px] bg-background border-l border-border-subtle p-5 overflow-y-auto shrink-0"
          >
            {/* Only real entry point into Timeline — carries the current
            point along via onOpenTimeline so Timeline opens with it already
            selected instead of always defaulting to the first point. Study
            Mode only: Timeline is a visual, spatial view (and its markers
            aren't yet keyboard-operable), so it isn't offered as a path out
            of Accessibility Mode. */}
            <button
              type="button"
              onClick={() => onOpenTimeline(effectiveActivePointId)}
              className="ds-btn-text mb-4"
            >
              View full timeline
              <span aria-hidden="true" className="text-sm">→</span>
            </button>

            {/* One continuous card — Lecture Details and Intervention Points
                are sections within it, separated by a divider rather than
                living in two separate boxes. */}
            <div className="bg-surface border border-border-subtle rounded-radius-md">
              {/* Lecture Details section */}
              <div className="p-4">
                <h2 className="text-[15px] font-semibold text-text-secondary mb-2">
                  Lecture Details
                </h2>
                <div className="flex gap-3">
                  {videoId && (
                    <img
                      src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
                      alt=""
                      className="w-14 h-14 rounded-radius-sm object-cover shrink-0 bg-surface-muted"
                      onError={(e) => (e.currentTarget.style.visibility = "hidden")}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {videoTitle && (
                      <div className="text-[14px] font-medium text-text-primary leading-snug mb-1">
                        {videoTitle}
                      </div>
                    )}
                    {videoAuthor && (
                      <div className="text-[14px] text-text-secondary">
                        {videoAuthor}
                      </div>
                    )}
                  </div>
                </div>
                {videoDuration && (
                  <div className="flex items-center gap-1.5 mt-3 text-[14px] text-text-secondary">
                    <ClockIcon />
                    {videoDuration}
                  </div>
                )}
              </div>

              {/* Intervention Points section — connected vertical stepper */}
              <div className="p-4 border-t border-border-subtle">
                <h3 className="text-[15px] font-semibold text-text-secondary mb-3">
                  Moments in this lecture
                </h3>
                <div className="relative">
                  {/* Connecting line running behind every dot */}
                  <div
                    aria-hidden="true"
                    className="absolute left-[12px] top-2 bottom-2 w-px bg-border-subtle"
                  />
                  <div>
                    {sortedPoints.map((point) => {
                      const isActive = point.id === effectiveActivePointId;
                      return (
                        <button
                          key={point.id}
                          onClick={() => selectPointManually(point.id)}
                          aria-current={isActive ? "step" : undefined}
                          className="relative z-10 flex items-start gap-3 w-full text-left px-1 py-2.5 rounded-radius-sm transition-colors focus-ring hover:bg-surface-muted"
                        >
                          <span
                            aria-hidden="true"
                            className={
                              "mt-1 w-4 h-4 shrink-0 rounded-full border-2 " +
                              (isActive
                                ? "bg-accent border-accent"
                                : "bg-surface border-border-strong")
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <div
                              className={
                                "font-mono tabular-nums text-[14px] " +
                                (isActive ? "text-text-primary" : "text-text-muted")
                              }
                            >
                              {point.timestamp}
                            </div>
                            <div className="flex items-baseline gap-1 text-[14px]">
                              <span
                                className={
                                  "flex-1 min-w-0 truncate " +
                                  (isActive
                                    ? "text-text-primary font-medium"
                                    : "text-text-secondary")
                                }
                              >
                                {point.title}
                              </span>
                              <span className="shrink-0 font-normal text-text-muted capitalize">
                                · {point.category}
                              </span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/* ============================================================================
   Sub-components
   ============================================================================ */

function ClockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

/* ============================================================================
   Helpers — exports + formatting
   ============================================================================ */

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// For the Moment header's category chip — categories are stored lowercase.
function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

/**
 * Generates a real PDF download using jsPDF.
 */
function exportToPDF(explanation, point) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 60;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Eyebrow
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(138, 128, 112);
  doc.text(`${point.category.toUpperCase()} · ${point.timestamp}`, margin, y);
  y += 25;

  // Title
  doc.setFont("times", "normal");
  doc.setFontSize(24);
  doc.setTextColor(30, 26, 21);
  const titleLines = doc.splitTextToSize(point.title, contentWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 28 + 6;

  // Subtitle
  doc.setFont("times", "italic");
  doc.setFontSize(13);
  doc.setTextColor(92, 82, 71);
  const subLines = doc.splitTextToSize(explanation.subtitle, contentWidth);
  doc.text(subLines, margin, y);
  y += subLines.length * 16 + 20;

  // Divider
  doc.setDrawColor(229, 223, 208);
  doc.line(margin, y, pageWidth - margin, y);
  y += 24;

  // Body paragraphs
  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.setTextColor(42, 37, 32);

  explanation.paragraphs.forEach((para) => {
    const lines = doc.splitTextToSize(para, contentWidth);
    lines.forEach((line) => {
      if (y > 770) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 18;
    });
    y += 8; // paragraph spacing
  });

  // Key insight
  if (explanation.keyInsight) {
    if (y > 720) {
      doc.addPage();
      y = margin;
    }
    y += 14;
    doc.setDrawColor(74, 91, 140);
    doc.setLineWidth(2);
    doc.line(margin, y - 6, margin, y + 40);
    doc.setLineWidth(1);

    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.setTextColor(61, 53, 40);
    const insightLines = doc.splitTextToSize(
      explanation.keyInsight,
      contentWidth - 14,
    );
    doc.text(insightLines, margin + 14, y);
    y += insightLines.length * 16 + 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(138, 128, 112);
    doc.text("KEY INSIGHT", margin + 14, y);
  }

  // Footer
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(138, 128, 112);
  doc.text(
    `Generated by Synapse — ${new Date().toLocaleDateString()}`,
    margin,
    810,
  );

  const filename = `synapse-${slugify(point.title)}.pdf`;
  doc.save(filename);
}

/**
 * Generates a real WAV audio file (silent placeholder for now — replace with
 * actual TTS audio when the backend is ready).
 *
 * Creates a 5-second silent WAV the user can save. Once your TTS pipeline is
 * wired up, fetch the audio file URL from the backend and download that
 * instead.
 */
function exportToAudio(explanation, point) {
  const sampleRate = 22050;
  const duration = 5; // seconds
  const numSamples = sampleRate * duration;

  // Create a low-volume tone as a placeholder so the file isn't completely
  // silent — students will know it played.
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = Math.sin((i / sampleRate) * 220 * 2 * Math.PI) * 1000;
    // Fade in/out
    if (i < sampleRate * 0.1) samples[i] *= i / (sampleRate * 0.1);
    if (i > numSamples - sampleRate * 0.1)
      samples[i] *= (numSamples - i) / (sampleRate * 0.1);
  }

  const wavBlob = createWavBlob(samples, sampleRate);
  const url = URL.createObjectURL(wavBlob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `synapse-${slugify(point.title)}.wav`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Builds a valid WAV file blob from raw 16-bit PCM samples.
 */
function createWavBlob(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Sample data
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
