const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
};

/** @type {import('http').Server | null} */
let server = null;
/** @type {number | null} */
let port = null;

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function isPathAllowed(filePath, allowedRoots) {
  const resolved = path.resolve(filePath);
  return allowedRoots.some((root) => {
    const r = path.resolve(root);
    if (process.platform === "win32") {
      const c = resolved.toLowerCase();
      const base = r.toLowerCase();
      return c === base || c.startsWith(base + "\\") || c.startsWith(base + "/");
    }
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

function sendFile(req, res, filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not a file");
    return;
  }

  const size = stat.size;
  const mime = mimeFor(filePath);
  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Range");
  res.setHeader("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, { "Content-Length": size });
    res.end();
    return;
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
    if (!match) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    let start = match[1] === "" ? 0 : Number.parseInt(match[1], 10);
    let end = match[2] === "" ? size - 1 : Number.parseInt(match[2], 10);
    if (match[1] === "" && match[2] !== "") {
      const suffix = Number.parseInt(match[2], 10);
      start = Math.max(0, size - suffix);
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` });
      res.end();
      return;
    }
    end = Math.min(end, size - 1);
    const chunk = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": chunk,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { "Content-Length": size });
  fs.createReadStream(filePath).pipe(res);
}

/**
 * @param {() => string[]} getAllowedRoots
 * @returns {Promise<number>} port
 */
function startMediaServer(getAllowedRoots) {
  if (server && port) return Promise.resolve(port);

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url || "/", "http://127.0.0.1");
        if (u.pathname !== "/media") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not found");
          return;
        }
        const raw = u.searchParams.get("path") || "";
        const filePath = path.resolve(raw);
        const roots = typeof getAllowedRoots === "function" ? getAllowedRoots() : [];
        if (!filePath || !isPathAllowed(filePath, roots)) {
          res.writeHead(403, { "Content-Type": "text/plain" });
          res.end("Forbidden");
          return;
        }
        sendFile(req, res, filePath);
      } catch (err) {
        console.error("[media-server]", err);
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error");
      }
    });

    server.once("error", reject);
    // port 0 → ephemeral localhost port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : null;
      if (!port) {
        reject(new Error("media server failed to bind"));
        return;
      }
      console.log(`[media-server] http://127.0.0.1:${port}/media`);
      resolve(port);
    });
  });
}

function mediaUrlFor(filePath) {
  if (!port) return null;
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return `http://127.0.0.1:${port}/media?path=${encodeURIComponent(resolved)}`;
}

function getMediaPort() {
  return port;
}

function stopMediaServer() {
  if (!server) return;
  try {
    server.close();
  } catch {
    // ignore
  }
  server = null;
  port = null;
}

module.exports = {
  startMediaServer,
  mediaUrlFor,
  getMediaPort,
  stopMediaServer,
};
