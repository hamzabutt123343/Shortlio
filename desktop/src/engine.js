const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, shell } = require("electron");

/** @type {Map<string, import('child_process').ChildProcess>} */
const running = new Map();

/** @type {{ jobId: string, accessToken: string }[]} */
const jobQueue = [];
let drainingQueue = false;

function resourcesRoot() {
  // Packaged: resources/ next to app.asar. Dev: desktop/resources/
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.join(__dirname, "..", "resources");
}

function clipsDir() {
  const videos = path.join(os.homedir(), "Videos", "Shortlio");
  fs.mkdirSync(videos, { recursive: true });
  return videos;
}

function cacheDir() {
  const dir = path.join(app.getPath("userData"), "cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function tokenPathFor(jobId) {
  const dir = path.join(app.getPath("userData"), "tokens");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${jobId}.token`);
}

/**
 * Windows venv Scripts\python.exe is a redirector that reads pyvenv.cfg `home=`.
 * CI-built venvs point at C:\hostedtoolcache\... and fail on user PCs (exit 103).
 */
function isUsablePython(exe) {
  if (!exe || !fs.existsSync(exe)) return false;
  const cfgPath = path.join(path.dirname(exe), "..", "pyvenv.cfg");
  if (!fs.existsSync(cfgPath)) return true;
  try {
    const text = fs.readFileSync(cfgPath, "utf8");
    const match = text.match(/^\s*home\s*=\s*(.+)\s*$/m);
    if (!match) return true;
    const home = match[1].trim().replace(/^["']|["']$/g, "");
    const homePy = path.join(home, "python.exe");
    if (!fs.existsSync(homePy)) {
      console.error(
        `[engine] Skipping broken venv python (home missing): ${exe} -> ${homePy}`
      );
      return false;
    }
  } catch {
    // If cfg is unreadable, still try spawning — spawn errors surface to the UI.
  }
  return true;
}

function findEnginePython() {
  const root = resourcesRoot();
  const candidates = [
    path.join(root, "engine", "python", "python.exe"),
    path.join(root, "engine", ".venv", "Scripts", "python.exe"),
    path.join(root, "engine", "Scripts", "python.exe"),
  ];
  for (const p of candidates) {
    if (isUsablePython(p)) return p;
  }
  // Dev fallback: repo worker venv
  const devVenv = path.join(__dirname, "..", "..", "worker", ".venv", "Scripts", "python.exe");
  if (isUsablePython(devVenv)) return devVenv;
  return null;
}

function findWorkerRoot() {
  const bundled = path.join(resourcesRoot(), "engine", "worker");
  if (fs.existsSync(path.join(bundled, "local_runner.py"))) return bundled;
  const dev = path.join(__dirname, "..", "..", "worker");
  if (fs.existsSync(path.join(dev, "local_runner.py"))) return dev;
  if (fs.existsSync(path.join(dev, "main.py"))) return dev;
  return null;
}

function findBinary(name) {
  const root = resourcesRoot();
  const candidates = [
    path.join(root, "ffmpeg", `${name}.exe`),
    path.join(root, "bin", `${name}.exe`),
    path.join(root, "engine", "bin", `${name}.exe`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

function findNode() {
  const root = resourcesRoot();
  const candidates = [
    path.join(root, "node", "node.exe"),
    path.join(root, "bin", "node.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "node";
}

function resolveAppApiUrl() {
  try {
    const configPath = path.join(__dirname, "..", "app-config.json");
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (parsed?.appUrl) return String(parsed.appUrl).replace(/\/$/, "");
  } catch {
    // ignore
  }
  return (process.env.SHORTLIO_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function engineStatus() {
  const python = findEnginePython();
  const workerRoot = findWorkerRoot();
  let runningJobId = null;
  for (const [id, child] of running.entries()) {
    if (child.exitCode === null && !child.killed) {
      runningJobId = id;
      break;
    }
  }
  return {
    ready: Boolean(python && workerRoot),
    runningJobId,
    clipsDir: clipsDir(),
    python,
    workerRoot,
  };
}

function activeJobCount() {
  let n = 0;
  for (const child of running.values()) {
    if (child.exitCode === null && !child.killed) n += 1;
  }
  return n;
}

/**
 * Spawn one local_runner. Resolves once the process has started (or failed to spawn),
 * NOT when the job finishes — UI should poll job progress on the project/clip page.
 * @param {{ jobId: string, accessToken: string }} opts
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
function spawnJobProcess({ jobId, accessToken }) {
  return new Promise((resolve) => {
    const python = findEnginePython();
    const workerRoot = findWorkerRoot();
    if (!python || !workerRoot) {
      resolve({
        ok: false,
        error:
          "Local engine not found or broken (Python missing). Reinstall the latest Shortlio Desktop release, or run desktop/scripts/bundle-engine.ps1 for a local build.",
      });
      return;
    }

    const tokenFile = tokenPathFor(jobId);
    try {
      fs.writeFileSync(tokenFile, accessToken, "utf8");
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const ffmpeg = findBinary("ffmpeg");
    const ffprobe = findBinary("ffprobe");
    const nodeBin = findNode();
    const apiUrl = resolveAppApiUrl();

    const env = {
      ...process.env,
      SHORTLIO_API_URL: apiUrl,
      SHORTLIO_ACCESS_TOKEN: accessToken,
      SHORTLIO_TOKEN_FILE: tokenFile,
      TEMP_DIR: cacheDir(),
      OUTPUT_DIR: clipsDir(),
      OUTPUT_MODE: "local",
      TRANSCRIPTION_PROVIDER: "groq_proxy",
      LLM_PROVIDER: "heuristic",
      WORKER_CONCURRENCY: "1",
      YTDLP_JS_RUNTIME: "node",
      PATH: [
        path.dirname(nodeBin !== "node" ? nodeBin : python),
        ffmpeg ? path.dirname(ffmpeg) : "",
        process.env.PATH || "",
      ]
        .filter(Boolean)
        .join(path.delimiter),
    };
    if (ffmpeg) env.FFMPEG_PATH = ffmpeg;
    if (ffprobe) env.FFPROBE_PATH = ffprobe;
    // Desktop never needs cloud service role — leave unset so it cannot leak.
    delete env.SUPABASE_SERVICE_ROLE_KEY;
    delete env.GROQ_API_KEY;

    // Placeholder Supabase URL for Settings validation when using HTTP repo only.
    if (!env.SUPABASE_URL) {
      env.SUPABASE_URL = apiUrl;
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      env.SUPABASE_SERVICE_ROLE_KEY = "desktop-local-unused";
    }

    const args = ["local_runner.py", "--job-id", jobId];
    let child;
    try {
      child = spawn(python, args, {
        cwd: workerRoot,
        env,
        windowsHide: true,
      });
    } catch (err) {
      try {
        fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }

    running.set(jobId, child);
    let settled = false;
    const settleOk = () => {
      if (settled) return;
      settled = true;
      resolve({ ok: true });
    };

    child.stdout?.on("data", (buf) => {
      console.log(`[engine ${jobId}]`, buf.toString("utf8").trimEnd());
    });
    child.stderr?.on("data", (buf) => {
      console.error(`[engine ${jobId}]`, buf.toString("utf8").trimEnd());
    });

    child.on("spawn", () => {
      settleOk();
    });

    child.on("error", (err) => {
      running.delete(jobId);
      try {
        fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
      if (!settled) {
        settled = true;
        resolve({ ok: false, error: err.message });
      }
      void pumpQueue();
    });

    child.on("exit", (code) => {
      running.delete(jobId);
      try {
        fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
      if (!settled) {
        // Spawn event missed (rare on some Node builds) — treat non-immediate exit as started.
        if (code === 0 || code === null) settleOk();
        else {
          settled = true;
          resolve({
            ok: false,
            error: `Engine exited with code ${code} before processing began`,
          });
        }
      } else if (code && code !== 0) {
        console.error(`[engine ${jobId}] exited with code ${code}`);
      }
      void pumpQueue();
    });

    // Windows sometimes omits 'spawn'; resolve after a short tick if still alive.
    setTimeout(() => {
      if (!settled && running.has(jobId)) settleOk();
    }, 250);
  });
}

async function pumpQueue() {
  if (drainingQueue) return;
  drainingQueue = true;
  try {
    while (jobQueue.length > 0 && activeJobCount() === 0) {
      const next = jobQueue.shift();
      if (!next) break;
      if (running.has(next.jobId)) continue;
      const result = await spawnJobProcess(next);
      if (!result.ok) {
        console.error(`[engine] queued job ${next.jobId} failed to start:`, result.error);
      }
    }
  } finally {
    drainingQueue = false;
  }
}

/**
 * @param {{ jobId: string, accessToken: string }} opts
 */
async function runJob({ jobId, accessToken }) {
  if (!jobId || !accessToken) {
    return { ok: false, error: "jobId and accessToken are required" };
  }
  if (running.has(jobId) || jobQueue.some((j) => j.jobId === jobId)) {
    return { ok: true }; // already queued/running — UI can poll
  }

  const python = findEnginePython();
  const workerRoot = findWorkerRoot();
  if (!python || !workerRoot) {
    return {
      ok: false,
      error:
        "Local engine not found or broken (Python missing). Reinstall the latest Shortlio Desktop release, or run desktop/scripts/bundle-engine.ps1 for a local build.",
    };
  }

  // One engine process at a time — avoids N× FFmpeg -threads 0 thrashing.
  if (activeJobCount() > 0) {
    jobQueue.push({ jobId, accessToken });
    console.log(`[engine] queued job ${jobId} (${jobQueue.length} waiting)`);
    return { ok: true };
  }

  return spawnJobProcess({ jobId, accessToken });
}

function cancelJob(jobId) {
  const qi = jobQueue.findIndex((j) => j.jobId === jobId);
  if (qi >= 0) jobQueue.splice(qi, 1);

  const child = running.get(jobId);
  if (!child) return { ok: true };
  try {
    child.kill();
  } catch {
    // ignore
  }
  running.delete(jobId);
  void pumpQueue();
  return { ok: true };
}

function openClipsFolder() {
  const dir = clipsDir();
  shell.openPath(dir);
  return { ok: true, path: dir };
}

module.exports = {
  engineStatus,
  runJob,
  cancelJob,
  openClipsFolder,
  clipsDir,
};
