import { expect, it } from "vitest";
import { getLibrary, updatePersonalSummary } from "./storage";

it("keeps the current lecture title when an explanation has stale metadata", () => {
  updatePersonalSummary([{
    videoId: "Tf4A93763Bw",
    videoTitle: "Conservation of energy",
    explanations: [{ videoTitle: "Video Tf4A93763Bw", title: "Energy transfer", timestamp: "5:34" }],
  }], []);
  expect(getLibrary()[0]).toMatchObject({
    videoTitle: "Conservation of energy", title: "Energy transfer", timestamp: "5:34",
  });
});
