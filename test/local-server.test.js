import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  executeCommand,
  isPathInsideRoot,
} from "../local-server/server.js";

test("recognizes paths inside an allowed root", () => {
  assert.equal(isPathInsideRoot("/projects/otus/course/student", "/projects/otus"), true);
  assert.equal(isPathInsideRoot("/projects/other", "/projects/otus"), false);
});

test("validates and opens an allowed folder without a shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-server-"));
  const folder = path.join(root, "course", "student");
  await mkdir(folder, { recursive: true });
  let openedPath;

  const result = await executeCommand(
    { command: "open_folder", path: folder },
    {
      allowedRoot: root,
      openFolder: async (candidate) => {
        openedPath = candidate;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(openedPath, await realpath(folder));
});

test("silently creates a missing folder before opening it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-create-"));
  const folder = path.join(root, "course", "student");
  let openedPath;

  const result = await executeCommand(
    { command: "open_folder", path: folder },
    {
      allowedRoot: root,
      openFolder: async (candidate) => {
        openedPath = candidate;
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal((await lstat(folder)).isDirectory(), true);
  assert.equal(openedPath, await realpath(folder));
});

test("rejects folders outside the allowed root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-root-"));
  await assert.rejects(
    executeCommand(
      { command: "open_folder", path: os.tmpdir() },
      { allowedRoot: root, openFolder: async () => {} },
    ),
    /path must be inside/,
  );
});

test("rejects unsupported commands", async () => {
  await assert.rejects(
    executeCommand({ command: "run_shell", path: "/tmp" }),
    /unsupported command/,
  );
});
