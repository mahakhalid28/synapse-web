// Real-Electron smoke test for the quiz store (src/lib/quizStore.js) on REAL Chromium IndexedDB.
//
// Why: the unit tests use an in-memory stand-in (src/test/fakeIndexedDb.js). This runs the SAME store
// code against the real thing: atomic multi-store transactions, compare-and-set under concurrency,
// rollback, and persistence across an app restart.
//
// It needs nothing external: no network, no backend, no model, no key, no dependency beyond the
// Electron already in devDependencies. It uses a THROWAWAY profile directory, never your real one,
// and deletes it afterwards.
//
// Run (from the repo root; two launches = a real restart in between):
//   node spike/quiz-store-smoke-main.cjs
// which spawns Electron twice with phase "write" then phase "read". Exit code 0 only if every
// check passed. You can also run a single phase by hand:
//   set QUIZ_SMOKE_DIR=<empty dir> && node_modules\electron\dist\electron.exe spike/quiz-store-smoke-main.cjs --phase=write
//
// The page is a file:// page, like the packaged app, loaded with webSecurity:false like electron.cjs
// (needed so a file:// page can import the ES modules in src/). Its IndexedDB is therefore the
// file:// origin's, matching the packaged build (the dev server's localhost origin is separate).

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

const phaseArg = process.argv.find((a) => a.startsWith("--phase="));

// ── Launcher mode: plain node, no electron module ────────────────────────────
if (!process.versions.electron) {
  const electronPath = require("electron"); // the electron package exports the binary path under node
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synapse-quiz-smoke-"));
  const env = { ...process.env, QUIZ_SMOKE_DIR: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  let failed = false;
  try {
    for (const phase of ["write", "read"]) {
      const run = spawnSync(electronPath, [__filename, `--phase=${phase}`], { env, encoding: "utf8", timeout: 120000 });
      const line = (run.stdout || "").split(/\r?\n/).filter((l) => l.startsWith("SMOKE_RESULT ")).pop();
      if (!line) { console.error(`phase ${phase}: no result\n${run.stderr || ""}`); failed = true; break; }
      const result = JSON.parse(line.slice("SMOKE_RESULT ".length));
      console.log(`\nphase ${phase}: ${result.results.filter((r) => r.ok).length}/${result.results.length} checks passed`);
      for (const r of result.results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : `  -> ${r.detail}`}`);
      if (result.info) console.log("  info:", JSON.stringify(result.info));
      if (result.results.some((r) => !r.ok) || result.fatal) { failed = true; if (result.fatal) console.error("  fatal:", result.fatal); }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  process.exit(failed ? 1 : 0);
}

// ── Electron mode ────────────────────────────────────────────────────────────
const { app, BrowserWindow } = require("electron");

const phase = (phaseArg || "--phase=write").split("=")[1];
if (!process.env.QUIZ_SMOKE_DIR) {
  console.error("QUIZ_SMOKE_DIR is required (a throwaway profile directory).");
  app.exit(2);
}
app.setPath("userData", process.env.QUIZ_SMOKE_DIR);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, webSecurity: false },
  });
  let payload = { results: [], fatal: "timed out" };
  try {
    await win.loadFile(path.join(__dirname, "quiz-store-smoke.html"), { query: { phase } });
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const state = await win.webContents.executeJavaScript("window.__smoke ? JSON.stringify(window.__smoke) : null");
      if (state) { payload = JSON.parse(state); break; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (err) {
    payload = { results: [], fatal: String(err && err.message) };
  }
  console.log(`SMOKE_RESULT ${JSON.stringify(payload)}`);
  app.exit(0);
});
