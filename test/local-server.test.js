import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildHomeworkFolderPath,
  cloneRepositoryWithSsh,
  courseCodeToDirectory,
  executeCommand,
  findGitHubUrlWithOpenRouter,
  isPathInsideRoot,
  loadEnvironmentFile,
  normalizeGitHubRepositoryUrl,
  resolveGitHubRepositoryUrl,
  splitGroupCode,
  transliterateFolderPart,
} from "../local-server/server.js";

const HOMEWORK_FOLDER = {
  groupCode: "AI-dev-tools-2026-07",
  surname: "Иванов",
  homeworkNumber: 3,
};

test("builds homework paths with the server OS path implementation", () => {
  const root = path.join(path.parse(process.cwd()).root, "projects", "otus");
  assert.equal(
    buildHomeworkFolderPath(root, HOMEWORK_FOLDER),
    path.join(root, "AI_Dev_Tools", "2026-07", "homework", "Ivanov", "hw3"),
  );
  assert.equal(transliterateFolderPart("Щербаков"), "Shcherbakov");
  assert.deepEqual(splitGroupCode("AI-dev-tools-2026-04"), {
    courseCode: "AI-dev-tools",
    groupDate: "2026-04",
  });
  assert.equal(courseCodeToDirectory("Dev-AI-Agents"), "DEV-AI-Agents");
});

test("recognizes paths inside an allowed root", () => {
  assert.equal(isPathInsideRoot("/projects/otus/course/student", "/projects/otus"), true);
  assert.equal(isPathInsideRoot("/projects/other", "/projects/otus"), false);
});

test("validates and opens an allowed folder without a shell", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-server-"));
  const folder = buildHomeworkFolderPath(root, HOMEWORK_FOLDER);
  await mkdir(folder, { recursive: true });
  let openedPath;

  const result = await executeCommand(
    { command: "open_folder", ...HOMEWORK_FOLDER },
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
  const folder = buildHomeworkFolderPath(root, HOMEWORK_FOLDER);
  let openedPath;

  const result = await executeCommand(
    { command: "open_folder", ...HOMEWORK_FOLDER },
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

test("rejects invalid homework folder parameters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-root-"));
  await assert.rejects(
    executeCommand(
      { command: "open_folder", ...HOMEWORK_FOLDER, homeworkNumber: 0 },
      { allowedRoot: root, openFolder: async () => {} },
    ),
    /homeworkNumber must be a positive integer/,
  );
});

test("rejects unsupported commands", async () => {
  await assert.rejects(
    executeCommand({ command: "run_shell", path: "/tmp" }),
    /unsupported command/,
  );
});

test("normalizes repository and pull request GitHub URLs", () => {
  assert.equal(
    normalizeGitHubRepositoryUrl("https://github.com/student/homework.git"),
    "https://github.com/student/homework",
  );
  assert.equal(
    normalizeGitHubRepositoryUrl("https://github.com/student/homework/pull/7"),
    "https://github.com/student/homework",
  );
  assert.throws(
    () => normalizeGitHubRepositoryUrl("https://example.com/student/homework"),
    /must use https:\/\/github.com/,
  );
});

test("uses gh to resolve the source repository of a pull request", async () => {
  let invocation;
  const repository = await resolveGitHubRepositoryUrl(
    "https://github.com/course/homework/pull/42",
    {
      run: async (executable, args) => {
        invocation = { executable, args };
        return JSON.stringify({
          headRepository: { name: "student-solution" },
          headRepositoryOwner: { login: "student" },
        });
      },
    },
  );
  assert.equal(repository, "https://github.com/student/student-solution");
  assert.equal(invocation.executable, "gh");
  assert.deepEqual(invocation.args.slice(0, 2), ["pr", "view"]);
});

test("asks the configured OpenRouter model for a JSON GitHub URL", async () => {
  let request;
  const url = await findGitHubUrlWithOpenRouter(
    [{ text: "solution link" }],
    {
      apiKey: "test-key",
      openRouterUrl: "https://openrouter.example/api/chat",
      openRouterModel: "deepseek/test-model",
      fetchImpl: async (endpoint, options) => {
        request = { endpoint, options };
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"github_url":"https://github.com/me/work"}' } }],
          }),
        };
      },
    },
  );

  assert.equal(url, "https://github.com/me/work");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(request.endpoint, "https://openrouter.example/api/chat");
  assert.equal(JSON.parse(request.options.body).model, "deepseek/test-model");
});

test("requires an .env file and loads the OpenRouter configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-env-"));
  const envPath = path.join(root, ".env");
  await assert.rejects(loadEnvironmentFile(envPath), /\.env file is required/);

  const names = [
    "DEFAULT_ALLOWED_ROOT",
    "OPENROUTER_API_KEY",
    "OPENROUTER_URL",
    "OPENROUTER_MODEL",
    "GITHUB_SSH_HOST",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  try {
    await writeFile(
      envPath,
      `DEFAULT_ALLOWED_ROOT=${root}\nOPENROUTER_API_KEY=test-key\nOPENROUTER_URL=https://example.test/chat\nOPENROUTER_MODEL=test/model\nGITHUB_SSH_HOST=artemreva-hub\n`,
    );
    await loadEnvironmentFile(envPath);
    assert.equal(process.env.DEFAULT_ALLOWED_ROOT, root);
    assert.equal(process.env.OPENROUTER_API_KEY, "test-key");
    assert.equal(process.env.OPENROUTER_URL, "https://example.test/chat");
    assert.equal(process.env.OPENROUTER_MODEL, "test/model");
    assert.equal(process.env.GITHUB_SSH_HOST, "artemreva-hub");
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test("analyzes messages and clones student materials into the folder root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-clone-"));
  const folder = buildHomeworkFolderPath(root, HOMEWORK_FOLDER);
  const messages = [{ actor: { id: 7 }, text: "my work" }];
  let cloned;

  const result = await executeCommand(
    { command: "clone_student_materials", ...HOMEWORK_FOLDER, messages },
    {
      allowedRoot: root,
      analyzeMessages: async (received) => {
        assert.deepEqual(received, messages);
        return "https://github.com/student/homework/pull/3";
      },
      resolveRepository: async () => "https://github.com/student/fork",
      cloneRepository: async (repository, candidate) => {
        cloned = { repository, candidate };
      },
    },
  );

  assert.equal(result.repository, "https://github.com/student/fork");
  assert.equal(cloned.repository, "https://github.com/student/fork");
  assert.equal(cloned.candidate, await realpath(folder));
});

test("clones through the configured SSH host alias", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "otus-command-gh-clone-"));
  let invocation;

  await cloneRepositoryWithSsh(
    "https://github.com/2887444-hue/ai_dz_14_mcp/",
    folder,
    {
      githubSshHost: "artemreva-hub",
      run: async (executable, args, options) => {
        invocation = { executable, args, options };
      },
    },
  );

  assert.equal(invocation.executable, "git");
  assert.deepEqual(invocation.args, [
    "clone",
    "git@artemreva-hub:2887444-hue/ai_dz_14_mcp.git",
    ".",
  ]);
  assert.equal(invocation.options.cwd, folder);
});

test("logs the student materials resolve flow without logging message contents", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-logs-"));
  const folder = buildHomeworkFolderPath(root, HOMEWORK_FOLDER);
  const logs = [];

  await executeCommand(
    {
      command: "clone_student_materials",
      ...HOMEWORK_FOLDER,
      messages: [{ text: "secret student message" }],
    },
    {
      allowedRoot: root,
      flowId: "test-flow",
      logger: (line) => logs.push(line),
      analyzeMessages: async () => "https://github.com/student/homework",
      resolveRepository: async (url) => url,
      cloneRepository: async () => {},
    },
  );

  assert.match(logs.join("\n"), /flow.start/);
  assert.match(logs.join("\n"), /repository.resolved/);
  assert.match(logs.join("\n"), /flow.complete/);
  assert.doesNotMatch(logs.join("\n"), /secret student message/);
});
