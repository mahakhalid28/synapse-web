// Entry for the real-Electron layout check (see quiz-layout-main.cjs). Mounts the real QuizScreen
// with an in-memory store and a canned API response, then drives it to the requested state by
// clicking its own buttons, exactly as a keyboard or mouse user would.
//
//   ?state=setup|question|feedback|review|confirm|results   ?long=1  ?scale=1.6  ?contrast=1  ?theme=night

import { createRoot } from "react-dom/client";
import "@fontsource/atkinson-hyperlegible-next/400.css";
import "@fontsource/atkinson-hyperlegible-next/500.css";
import "@fontsource/atkinson-hyperlegible-next/600.css";
import "@fontsource/atkinson-hyperlegible-next/700.css";
import "../src/index.css";
import QuizScreen from "../src/components/QuizScreen.jsx";
import { createQuizStore } from "../src/lib/quizStore.js";
import { createFakeIndexedDB } from "../src/test/fakeIndexedDb.js";
import { makeQuestion, makeQuiz } from "../src/test/quizFixtures.js";

const params = new URLSearchParams(location.search);
const state = params.get("state") || "setup";
const long = params.get("long") === "1";

document.documentElement.setAttribute("data-theme", params.get("theme") || "paper");
localStorage.setItem("synapse_quiz_text_scale", params.get("scale") || "1");
localStorage.setItem("synapse_quiz_high_contrast", params.get("contrast") === "1" ? "true" : "false");

// The longest text the contract allows: prompt 400, choice 200, explanation 600, hint 200 characters.
const words = (n, w = "lengthyword") => Array.from({ length: n }, () => w).join(" ");
function buildQuiz() {
  const quiz = makeQuiz();
  if (long) {
    quiz.questions[0] = makeQuestion(1, {
      prompt: `${words(32)}?`.slice(0, 400),
      choices: ["a", "b", "c", "d"].map((id) => ({ id, text: `${id.toUpperCase()} ${words(16)} Supercalifragilisticexpialidocious-${"x".repeat(60)}`.slice(0, 200) })),
      explanation: words(50).slice(0, 600),
      hints: [words(18).slice(0, 200), words(18).slice(0, 200)],
      concept: { id: "concept-long", label: words(7).slice(0, 60) },
    });
  }
  return quiz;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(find, what) {
  for (let i = 0; i < 200; i++) {
    const found = find();
    if (found) return found;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${what}`);
}
const text = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
const byText = (selector, wanted) => [...document.querySelectorAll(selector)].find((el) => text(el) === wanted);
const click = async (selector, wanted) => { (await until(() => byText(selector, wanted), `${selector} "${wanted}"`)).click(); await sleep(60); };

async function drive() {
  if (state === "setup") { await until(() => byText("h2", "Set up your practice"), "setup"); return; }
  await click("button", "Create questions");
  await until(() => /^Question 1 of/.test(text(document.querySelector("h2") || document.body)), "question 1");
  if (state === "question") return;
  if (state === "feedback") {
    (await until(() => [...document.querySelectorAll("label")].find((l) => l.querySelector("input[type=radio]") && text(l).startsWith("A.")), "choice A")).click();
    await sleep(60);
    await click("button", "Show hint 1 of 2");
    await click("button", "Check answer");
    await until(() => byText("h3", "✗ Not quite") || [...document.querySelectorAll("h3")].find((h) => /Not quite/.test(h.textContent)), "feedback");
    return;
  }
  await click("button", "Review answers");
  await until(() => byText("h2", "Review your answers"), "review");
  if (state === "review") return;
  await click("button", "Finish practice");
  await until(() => byText("h3", "Finish this practice?"), "confirm");
  if (state === "confirm") return;
  await click("button", "Finish anyway");
  await until(() => byText("h2", "Your results"), "results");
}

const fake = createFakeIndexedDB();
const store = createQuizStore({ indexedDB: fake.factory, storage: undefined });
const api = { requestQuiz: async () => buildQuiz() };

createRoot(document.getElementById("root")).render(
  <div style={{ height: "100vh" }}>
    <QuizScreen videoId="5ugDJhmmkFM" jobId="job-1" videoTitle={long ? words(12, "Lecture") : "The Animal Cell"} store={store} api={api} />
  </div>,
);

drive().then(() => { window.__ready = true; }).catch((err) => { window.__error = String(err && err.message); window.__ready = true; });
