const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { app, shell } = require("electron");

/** @type {Map<string, import('child_process').ChildProcess>} */
const running = new Map();

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

function findEnginePython() {
  const root = resourcesRoot();
  const candidates = [
    path.join(root, "engine", "python", "python.exe"),
    path.join(root, "engine", ".venv", "Scripts", "python.exe"),
    path.join(root, "engine", "Scripts", "python.exe"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  // Dev fallback: repo worker venv
  const devVenv = path.join(__dirname, "..", "..", "worker", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(devVenv)) return devVenv;
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

/**
 * @param {{ jobId: string, accessToken: string }} opts
 */
function runJob({ jobId, accessToken }) {
  return new Promise((resolve) => {
    if (!jobId || !accessToken) {
      resolve({ ok: false, error: "jobId and accessToken are required" });
      return;
    }
    if (running.has(jobId)) {
      resolve({ ok: false, error: "Job is already running locally" });
      return;
    }

    const python = findEnginePython();
    const workerRoot = findWorkerRoot();
    if (!python || !workerRoot) {
      resolve({
        ok: false,
        error:
          "Local engine not found. Run desktop/scripts/bundle-engine.ps1 or use a release build that includes the engine.",
      });
      return;
    }

    const tokenFile = tokenPathFor(jobId);
    fs.writeFileSync(tokenFile, accessToken, "utf8");

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
      YTDLP_JS_RUNTIME: nodeBin === "node" ? "node" : "node",
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
    if (nodeBin !== "node") {
      env.YTDLP_JS_RUNTIME = "node";
      // yt-dlp resolves `node` from PATH; we already prepended dirname
    }
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
    const child = spawn(python, args, {
      cwd: workerRoot,
      env,
      windowsHide: true,
    });
    running.set(jobId, child);

    let stderr = "";
    child.stdout?.on("data", (buf) => {
      console.log(`[engine ${jobId}]`, buf.toString("utf8").trimEnd());
    });
    child.stderr?.on("data", (buf) => {
      const text = buf.toString("utf8");
      stderr += text;
      console.error(`[engine ${jobId}]`, text.trimEnd());
    });

    child.on("error", (err) => {
      running.delete(jobId);
      try {
        fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
      resolve({ ok: false, error: err.message });
    });

    child.on("exit", (code) => {
      running.delete(jobId);
      try {
        fs.unlinkSync(tokenFile);
      } catch {
        // ignore
      }
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({
          ok: false,
          error: `Engine exited with code ${code}${stderr ? `: ${stderr.slice(-500)}` : ""}`,
        });
      }
    });
  });
}

function cancelJob(jobId) {
  const child = running.get(jobId);
  if (!child) return { ok: true };
  try {
    child.kill();
  } catch {
    // ignore
  }
  running.delete(jobId);
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
