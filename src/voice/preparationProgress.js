// Spoken progress while a lecture's explanations are being prepared.
//
// The lecture screen reports counts through its voice context (preparationProgress). This module turns the
// counts into short sentences and decides WHEN a change is worth saying, so a learner who cannot see the
// progress hears it without being talked at every few seconds:
//
//   - when preparation starts:        "Preparing 12 explanations. I will tell you as they become ready."
//   - the first one ready:            "The first explanation is ready. 1 of 12."
//   - later ones, at most once per PROGRESS_EVERY_MS: "4 of 12 explanations are ready."
//   - when all have finished:         "All 12 explanations are ready." (or how many could not be prepared)
//
// Nothing here talks over the lecture: the Talk control speaks these only while the lecture is not playing.

export const PROGRESS_EVERY_MS = 60_000;

/** Counts over the explanations actually requested ({ status } per moment). Null when there are none. */
export function preparationCounts(preparations) {
  if (!preparations || typeof preparations.values !== "function") return null;
  const counts = { total: 0, ready: 0, preparing: 0, failed: 0 };
  for (const item of preparations.values()) {
    if (!item || item.requested === false) continue; // explained only on request, and not requested
    counts.total += 1;
    if (item.status === "ready") counts.ready += 1;
    else if (item.status === "failed") counts.failed += 1;
    else if (item.status === "pending" || item.status === "generating") counts.preparing += 1;
  }
  return counts.total ? counts : null;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isAre = (n) => (n === 1 ? "is" : "are");

/** The answer to "how are the explanations going?" */
export function progressSentence(progress, processingMessage = null) {
  if (processingMessage) {
    const stage = processingMessage.replace(/[.\s…]+$/, "");
    return `The lecture is still being processed: ${stage}. Explanations are prepared after that.`;
  }
  if (!progress) return "No explanations are being prepared for this lecture right now.";
  const { total, ready, preparing, failed } = progress;
  if (!preparing) return finishedSentence(progress);
  const failedPart = failed ? ` ${failed} could not be prepared.` : "";
  return `${ready} of ${total} explanations ${isAre(ready)} ready. ${preparing} ${isAre(preparing)} still being prepared.${failedPart}`;
}

function finishedSentence({ total, ready, failed }) {
  if (!failed) return total === 1 ? "The explanation is ready." : `All ${total} explanations are ready.`;
  if (!ready) return `None of the ${total} explanations could be prepared. At a moment, say try the explanation again.`;
  return `${ready} of ${total} explanations ${isAre(ready)} ready. ${failed} could not be prepared; at that moment, say try the explanation again.`;
}

/**
 * Decide what (if anything) to say about a new progress reading.
 * `memory` is a plain object kept by the caller between readings; `now` is the current time in ms.
 */
export function progressUpdate(memory, progress, now = Date.now()) {
  if (!progress) return null;
  const { total, ready, preparing } = progress;
  const previous = memory.last;
  memory.last = progress;
  if (!memory.started) {
    memory.started = true;
    memory.spokeAt = now;
    if (!preparing) return null; // everything was already done when the lecture opened
    return ready
      ? `${ready} of ${total} explanations ${isAre(ready)} ready. I will tell you as more become ready.`
      : `Preparing ${plural(total, "explanation", "explanations")}. I will tell you as they become ready.`;
  }
  if (!previous) return null;
  if (!preparing && previous.preparing) {
    memory.spokeAt = now;
    return finishedSentence(progress);
  }
  if (ready > previous.ready) {
    if (previous.ready === 0) {
      memory.spokeAt = now;
      return `The first explanation is ready. ${ready} of ${total}.`;
    }
    if (now - memory.spokeAt >= PROGRESS_EVERY_MS) {
      memory.spokeAt = now;
      return `${ready} of ${total} explanations are ready.`;
    }
  }
  return null;
}
