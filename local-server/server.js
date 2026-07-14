import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8765;
export const DEFAULT_ALLOWED_ROOT = "/Users/artemreva/projects/otus";
const MAX_BODY_BYTES = 16 * 1024;

export function isPathInsideRoot(candidatePath, allowedRoot) {
  const relative = path.relative(path.resolve(allowedRoot), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function findExistingAncestor(candidatePath) {
  let currentPath = candidatePath;
  while (true) {
    try {
      await lstat(currentPath);
      return currentPath;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) throw error;
      currentPath = parentPath;
    }
  }
}

async function ensureFolder(candidatePath, allowedRoot) {
  if (typeof candidatePath !== "string" || !path.isAbsolute(candidatePath)) {
    throw new CommandError(400, "path must be an absolute filesystem path");
  }
  if (!isPathInsideRoot(candidatePath, allowedRoot)) {
    throw new CommandError(403, `path must be inside ${allowedRoot}`);
  }

  const realRoot = await realpath(allowedRoot);
  const existingAncestor = await findExistingAncestor(candidatePath);
  const realAncestor = await realpath(existingAncestor);
  if (!isPathInsideRoot(realAncestor, realRoot)) {
    throw new CommandError(403, "folder would be created outside the allowed root");
  }

  try {
    await mkdir(candidatePath, { recursive: true });
  } catch (error) {
    if (error?.code === "ENOTDIR" || error?.code === "EEXIST") {
      throw new CommandError(400, `path is not a folder: ${candidatePath}`);
    }
    throw error;
  }

  const info = await lstat(candidatePath);
  if (!info.isDirectory()) {
    throw new CommandError(400, `path is not a folder: ${candidatePath}`);
  }

  const realFolder = await realpath(candidatePath);
  if (!isPathInsideRoot(realFolder, realRoot)) {
    throw new CommandError(403, "resolved folder is outside the allowed root");
  }
  return realFolder;
}

function openInFinder(folderPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/open", [folderPath], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorOutput = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `/usr/bin/open exited with ${code}`));
    });
  });
}

export async function executeCommand(message, options = {}) {
  const allowedRoot = options.allowedRoot ?? DEFAULT_ALLOWED_ROOT;
  const openFolder = options.openFolder ?? openInFinder;

  if (message?.command !== "open_folder") {
    throw new CommandError(400, "unsupported command");
  }

  const folderPath = await ensureFolder(message.path, allowedRoot);
  await openFolder(folderPath);
  return { ok: true, command: "open_folder", path: folderPath };
}

class CommandError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return null;
  return origin.startsWith("chrome-extension://") ? origin : false;
}

function sendJson(request, response, statusCode, payload) {
  const allowedOrigin = getAllowedOrigin(request);
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers.Vary = "Origin";
  }
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new CommandError(413, "request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new CommandError(400, "request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

export function createCommandServer(options = {}) {
  return createServer(async (request, response) => {
    if (getAllowedOrigin(request) === false) {
      sendJson(request, response, 403, { ok: false, error: "origin is not allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      sendJson(request, response, 204, {});
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method !== "POST" || request.url !== "/commands") {
      sendJson(request, response, 404, { ok: false, error: "not found" });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendJson(request, response, 415, {
        ok: false,
        error: "content type must be application/json",
      });
      return;
    }

    try {
      const message = await readJsonBody(request);
      sendJson(request, response, 200, await executeCommand(message, options));
    } catch (error) {
      const statusCode = error instanceof CommandError ? error.statusCode : 500;
      sendJson(request, response, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : "unexpected error",
      });
    }
  });
}

function startServer() {
  const host = process.env.OTUS_COMMAND_HOST ?? DEFAULT_HOST;
  const port = Number(process.env.OTUS_COMMAND_PORT ?? DEFAULT_PORT);
  const allowedRoot = process.env.OTUS_PROJECTS_ROOT ?? DEFAULT_ALLOWED_ROOT;
  const server = createCommandServer({ allowedRoot });
  server.listen(port, host, () => {
    console.log(`OTUS command server listening on http://${host}:${port}`);
    console.log(`Allowed folder root: ${allowedRoot}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
