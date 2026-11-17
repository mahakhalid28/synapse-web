import { useEffect, useRef, useState } from "react";
import { getPreparedExplanation, retryExplanationPreparation } from "../api";
import { API_MOCK_MODE } from "../lib/apiConfig";
import { loadSavedAudio, normalMode } from "../lib/personalApi";

const WAITING = { phase: "preparing", error: null, retryable: true };
const hasText = (explanation) => explanation?.paragraphs?.some((text) => typeof text === "string" && text.trim());

// Startup readiness belongs to the lecture, independently of the selected moment/depth.
export function useLecturePlaybackGate({ videoId, firstPointId, pointsReady, depth, readOnly, savedItems, preparation }) {
  const key = `${videoId}::${firstPointId}::${depth}::${readOnly}`;
  const [state, setState] = useState(WAITING);
  const [attempt, setAttempt] = useState(0);
  const current = state.key === key ? state : WAITING;
  const generationFailed = ["failed", "cancelled"].includes(preparation?.status);
  const unlocked = current.phase === "ready";
  const retryable = current.phase !== "retrying" && (generationFailed
    ? preparation.retryable !== false && preparation.error_code !== "retry_exhausted" : current.retryable);
  const latestKey = useRef(key);
  const retryInFlight = useRef(false);
  useEffect(() => {
    latestKey.current = key;
    return () => { latestKey.current = null; };
  }, [key]);

  useEffect(() => {
    if (!pointsReady || !firstPointId || unlocked) return;
    if (!readOnly && !API_MOCK_MODE && preparation?.status !== "ready") return;
    const controller = new AbortController();
    const update = (value) => { if (!controller.signal.aborted) setState({ ...value, key }); };
    update(WAITING);
    async function check() {
      let audio;
      try {
        if (readOnly) {
          const saved = savedItems.find((item) => item.pointId === firstPointId && normalMode(item.mode) === normalMode(depth));
          if (!saved?.audioUrl || !hasText(saved.explanation)) {
            update({ phase: "failed", error: "The first explanation is not saved with audio. Open this lecture from Home to prepare it.", retryable: true });
            return;
          }
          audio = await loadSavedAudio(saved, { signal: controller.signal });
          if (!audio) throw new Error("The first saved explanation's audio could not be loaded.");
          if (!audio.startsWith("blob:")) {
            const response = await fetch(audio, { signal: controller.signal });
            if (!response.ok || !(await response.blob()).size) throw new Error("The first saved explanation's audio could not be loaded.");
          }
        } else {
          const bundle = await getPreparedExplanation(firstPointId, depth, videoId, { signal: controller.signal });
          audio = bundle.audio?.audio_file_path;
          if (!audio || bundle.audio.audio_error || !hasText(bundle.explanation)) {
            throw new Error("The first explanation's audio could not be loaded. Check again to retry.");
          }
        }
        update({ phase: "ready", error: null, retryable: false });
      } catch (error) {
        if (error.name !== "AbortError") update({ phase: "failed", error: error.message || "The first explanation could not be checked.", retryable: true });
      } finally {
        if (audio?.startsWith("blob:")) URL.revokeObjectURL?.(audio);
      }
    }
    check();
    return () => { controller.abort(); };
  }, [key, videoId, firstPointId, pointsReady, depth, readOnly, savedItems, preparation?.status, attempt, unlocked]);

  async function retry() {
    if (!retryable || retryInFlight.current) return;
    retryInFlight.current = true;
    try {
      if (generationFailed) {
        setState({ ...WAITING, phase: "retrying", key });
        await retryExplanationPreparation(firstPointId, depth, videoId);
      }
      if (latestKey.current !== key) return;
      setState({ ...WAITING, key });
      setAttempt((value) => value + 1);
    } catch (error) {
      if (latestKey.current === key) setState({ ...WAITING, phase: "failed", key, error: error.message });
    } finally {
      retryInFlight.current = false;
    }
  }

  const failed = !unlocked && current.phase !== "retrying" && generationFailed;
  return { ...current,
    error: current.error || (failed ? "The first explanation could not be prepared. Playback is paused." : null),
    retryable,
    retryGeneration: failed,
    ready: pointsReady && Boolean(firstPointId) && current.phase === "ready", retry };
}
