// Real-Electron LAYOUT check for the quiz screen: the actual component, real Chromium layout,
// 200% browser zoom, big text, high contrast, and the longest text the contract allows.
//
// What it measures (jsdom can't): horizontal overflow, controls shorter than 44 CSS px, and the
// text/background contrast ratio of every piece of text. It also saves a PNG per scenario so the
// result can be LOOKED AT. It does not replace a human zoom check with a screen magnifier.
//
// Needs nothing external. It starts the project's own Vite DEV server on 127.0.0.1 (no build, no
// output files) and an Electron window that is only allowed to talk to that server: every other
// request, including the Google Fonts @import in index.css, is cancelled. No model, backend or key.
//
// Run from the repo root:   node spike/quiz-layout-main.cjs [outputDir]
// Exit code 0 only if every check passed. Screenshots go to outputDir (default: a temp folder).

const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 5199;
const ROOT = path.join(__dirname, "..");
const BASE = `http://127.0.0.1:${PORT}`;

/* ── Launcher (plain node) ──────────────────────────────────────────────── */
if (!process.versions.electron) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), "synapse-quiz-layout-"));
  fs.mkdirSync(outDir, { recursive: true });
  const vite = spawn(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"],
  });
  const stop = () => { try { vite.kill(); } catch { /* already gone */ } };
  const ready = () => new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      http.get(`${BASE}/spike/quiz-layout.html`, (res) => { res.resume(); resolve(); })
        .on("error", () => (Date.now() - started > 60000 ? reject(new Error("vite did not start")) : setTimeout(poll, 300)));
    };
    poll();
  });
  ready().then(() => {
    const electronPath = require("electron");
    const env = { ...process.env, QUIZ_LAYOUT_OUT: outDir };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electronPath, [__filename], { env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("exit", () => {
      stop();
      const line = out.split(/\r?\n/).filter((l) => l.startsWith("LAYOUT_RESULT ")).pop();
      if (!line) { console.error("no result from Electron"); process.exit(1); }
      const { rows, fatal } = JSON.parse(line.slice("LAYOUT_RESULT ".length));
      let failed = Boolean(fatal);
      if (fatal) console.error("fatal:", fatal);
      for (const r of rows) {
        const bad = r.problems.length > 0;
        failed = failed || bad;
        console.log(`${bad ? "FAIL" : "PASS"}  ${r.name}${r.metrics ? `  [main ${r.metrics.clientW}px wide, text ${r.metrics.fontPx}, min contrast ${r.metrics.minContrast}:1]` : ""}`);
        for (const p of r.problems) console.log(`        - ${p}`);
      }
      console.log(`\n${rows.filter((r) => r.problems.length === 0).length}/${rows.length} scenarios clean. Screenshots: ${outDir}`);
      process.exit(failed ? 1 : 0);
    });
  }).catch((err) => { console.error(String(err && err.message)); stop(); process.exit(1); });
  return;
}

/* ── Electron ───────────────────────────────────────────────────────────── */
const { app, BrowserWindow, session } = require("electron");

// Runs inside the page after the screen reached the requested state.
const MEASURE = `(() => {
  const main = document.querySelector("main");
  const mr = main.getBoundingClientRect();
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const backdrop = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.a > 0.99) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const label = (el) => (el.tagName.toLowerCase() + ":" + (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 38));

  const overflowing = [], small = [], lowContrast = [];
  let minContrast = 21;
  for (const el of main.querySelectorAll("*")) {
    if (el.closest(".sr-only") || el.getAttribute("aria-hidden") === "true" && !el.textContent.trim()) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > mr.right + 1 || r.left < mr.left - 1) overflowing.push(label(el) + " by " + Math.round(r.right - mr.right) + "px");
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own) {
      const fg = parse(getComputedStyle(el).color);
      const cr = ratio(fg, backdrop(el));
      minContrast = Math.min(minContrast, cr);
      const px = parseFloat(getComputedStyle(el).fontSize);
      const large = px >= 24 || (px >= 18.66 && getComputedStyle(el).fontWeight >= 700);
      if (cr < (large ? 3 : 4.5)) lowContrast.push(label(el) + " " + cr.toFixed(2) + ":1");
    }
  }
  for (const el of main.querySelectorAll("button, select, label")) {
    if (el.closest(".sr-only") || el.classList.contains("ds-btn-text")) continue;
    if (el.tagName === "LABEL" && !el.querySelector("input")) continue; // a caption, not a tap target
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height < 43.5) small.push(label(el) + " " + Math.round(r.height) + "px");
  }
  const html = document.documentElement;
  return {
    innerWidth, innerHeight, zoom: devicePixelRatio,
    clientW: main.clientWidth, scrollW: main.scrollWidth, docScrollW: html.scrollWidth,
    hScroll: main.scrollWidth > main.clientWidth + 1 || html.scrollWidth > innerWidth + 1,
    overflowing: overflowing.slice(0, 6), small: small.slice(0, 6), lowContrast: lowContrast.slice(0, 6),
    minContrast: Math.round(minContrast * 100) / 100, fontPx: getComputedStyle(main).fontSize,
    h1: document.querySelector("h1") && document.querySelector("h1").textContent,
    error: window.__error || null,
  };
})()`;

const STATES = ["setup", "question", "feedback", "review", "confirm", "results"];
const CONFIGS = [
  { id: "normal", zoom: 1, scale: 1, long: false, contrast: false, theme: "paper" },
  { id: "zoom200", zoom: 2, scale: 1, long: false, contrast: false, theme: "paper" },
  { id: "zoom200-long-text160", zoom: 2, scale: 1.6, long: true, contrast: false, theme: "paper" },
  { id: "contrast-text160", zoom: 1, scale: 1.6, long: true, contrast: true, theme: "paper" },
  { id: "contrast-zoom200-long-text160", zoom: 2, scale: 1.6, long: true, contrast: true, theme: "paper" },
  { id: "night", zoom: 1, scale: 1, long: true, contrast: false, theme: "night" },
];

app.whenReady().then(async () => {
  const outDir = process.env.QUIZ_LAYOUT_OUT;
  // Only the local dev server may be reached. Everything else (fonts CDN, anything) is cancelled.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const local = details.url.startsWith(BASE) || details.url.startsWith(`ws://127.0.0.1:${PORT}`) || details.url.startsWith("devtools:") || details.url.startsWith("data:");
    callback({ cancel: !local });
  });
  const win = new BrowserWindow({ width: 1100, height: 800, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } });
  const rows = [];
  let fatal = null;
  try {
    for (const config of CONFIGS) {
      for (const state of STATES) {
        const name = `${config.id} / ${state}`;
        const url = `${BASE}/spike/quiz-layout.html?state=${state}&scale=${config.scale}&long=${config.long ? 1 : 0}&contrast=${config.contrast ? 1 : 0}&theme=${config.theme}`;
        const problems = [];
        let metrics = null;
        try {
          await win.loadURL(url);
          win.webContents.setZoomFactor(config.zoom);
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline && !(await win.webContents.executeJavaScript("window.__ready === true"))) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          metrics = await win.webContents.executeJavaScript(MEASURE);
          if (metrics.error) problems.push(`page error: ${metrics.error}`);
          if (metrics.hScroll) problems.push(`horizontal scroll: main ${metrics.scrollW}px > ${metrics.clientW}px, document ${metrics.docScrollW}px > ${metrics.innerWidth}px`);
          if (metrics.overflowing.length) problems.push(`overflows its column: ${metrics.overflowing.join("; ")}`);
          if (metrics.small.length) problems.push(`controls under 44px: ${metrics.small.join("; ")}`);
          if (metrics.lowContrast.length) problems.push(`low contrast: ${metrics.lowContrast.join("; ")}`);
          if (config.contrast && metrics.minContrast < 7) problems.push(`high contrast only reaches ${metrics.minContrast}:1`);
          const image = await win.webContents.capturePage();
          fs.writeFileSync(path.join(outDir, `${config.id}__${state}.png`), image.toPNG());
        } catch (err) {
          problems.push(`could not run: ${String(err && err.message)}`);
        }
        rows.push({ name, problems, metrics });
      }
    }
  } catch (err) {
    fatal = String(err && err.message);
  }
  console.log(`LAYOUT_RESULT ${JSON.stringify({ rows, fatal })}`);
  app.exit(0);
});
