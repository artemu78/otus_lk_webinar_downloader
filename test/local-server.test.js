import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeGroupWithOpenRouter,
  buildHomeworkFolderPath,
  cancelGroupAnalysisJob,
  cloneRepositoryWithSsh,
  courseCodeToDirectory,
  executeCommand,
  findStudentMaterialWithOpenRouter,
  findGitHubUrlWithOpenRouter,
  getAnalysisJob,
  isPathInsideRoot,
  loadEnvironmentFile,
  normalizeGitHubRepositoryUrl,
  resolveGitHubRepositoryUrl,
  splitGroupCode,
  startGroupAnalysisJob,
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
    path.join(root, "AI_Dev_Tools", "2026-07", "homework", "Ivanov", "hw3")
  );
  assert.equal(transliterateFolderPart("Щербаков"), "Shcherbakov");
  assert.deepEqual(splitGroupCode("AI-dev-tools-2026-04"), {
    courseCode: "AI-dev-tools",
    groupDate: "2026-04",
  });
  assert.equal(courseCodeToDirectory("Dev-AI-Agents"), "DEV-AI-Agents");
});

test("recognizes paths inside an allowed root", () => {
  assert.equal(
    isPathInsideRoot("/projects/otus/course/student", "/projects/otus"),
    true
  );
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
    }
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
    }
  );

  assert.equal(result.ok, true);
  assert.equal((await lstat(folder)).isDirectory(), true);
  assert.equal(openedPath, await realpath(folder));
});

test("uses a cached absolute folder path without rebuilding it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-cached-"));
  const folder = path.join(root, "course", "student", "hw7");
  let openedPath;

  const result = await executeCommand(
    { command: "open_folder", path: folder },
    {
      allowedRoot: root,
      openFolder: async (candidate) => {
        openedPath = candidate;
      },
    }
  );

  assert.equal(result.path, await realpath(folder));
  assert.equal(openedPath, result.path);
});

test("opens the cached homework folder in Warp", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-warp-"));
  const folder = path.join(root, "course", "student", "hw2");
  let openedPath;

  const result = await executeCommand(
    { command: "open_warp", path: folder },
    {
      allowedRoot: root,
      openWarp: async (candidate) => {
        openedPath = candidate;
      },
    }
  );

  assert.equal(result.command, "open_warp");
  assert.equal(openedPath, await realpath(folder));
});

test("reads the newest TXT file from analyze_result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-analysis-"));
  const folder = path.join(root, "course", "student", "hw4");
  const analysisFolder = path.join(folder, "analyze_result");
  await mkdir(analysisFolder, { recursive: true });
  await writeFile(path.join(analysisFolder, "older.txt"), "old result");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await writeFile(path.join(analysisFolder, "latest.txt"), "latest result");
  await writeFile(path.join(analysisFolder, "ignored.md"), "newer but not txt");

  const result = await executeCommand(
    { command: "read_latest_analysis", path: folder },
    { allowedRoot: root }
  );

  assert.equal(result.filename, "latest.txt");
  assert.equal(result.content, "latest result");
  assert.equal(result.path, await realpath(folder));
});

test("rejects invalid homework folder parameters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-root-"));
  await assert.rejects(
    executeCommand(
      { command: "open_folder", ...HOMEWORK_FOLDER, homeworkNumber: 0 },
      { allowedRoot: root, openFolder: async () => {} }
    ),
    /homeworkNumber must be a positive integer/
  );
});

test("rejects unsupported commands", async () => {
  await assert.rejects(
    executeCommand({ command: "run_shell", path: "/tmp" }),
    /unsupported command/
  );
});

test("normalizes repository and pull request GitHub URLs", () => {
  assert.equal(
    normalizeGitHubRepositoryUrl("https://github.com/student/homework.git"),
    "https://github.com/student/homework"
  );
  assert.equal(
    normalizeGitHubRepositoryUrl("https://github.com/student/homework/pull/7"),
    "https://github.com/student/homework"
  );
  assert.throws(
    () => normalizeGitHubRepositoryUrl("https://example.com/student/homework"),
    /must use https:\/\/github.com/
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
    }
  );
  assert.equal(repository, "https://github.com/student/student-solution");
  assert.equal(invocation.executable, "gh");
  assert.deepEqual(invocation.args.slice(0, 2), ["pr", "view"]);
});

test("asks the configured OpenRouter model for a JSON GitHub URL", async () => {
  let request;
  const url = await findGitHubUrlWithOpenRouter([{ text: "solution link" }], {
    apiKey: "test-key",
    openRouterUrl: "https://openrouter.example/api/chat",
    openRouterModel: "deepseek/test-model",
    fetchImpl: async (endpoint, options) => {
      request = { endpoint, options };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"github_url":"https://github.com/me/work"}',
                },
              },
            ],
          }),
      };
    },
  });

  assert.equal(url, "https://github.com/me/work");
  assert.equal(request.options.headers.Authorization, "Bearer test-key");
  assert.equal(request.endpoint, "https://openrouter.example/api/chat");
  assert.equal(JSON.parse(request.options.body).model, "deepseek/test-model");
});

test("recognizes a ZIP URL from OpenRouter and asks for both material types", async () => {
  let request;
  const material = await findStudentMaterialWithOpenRouter(
    [{ text: "archive" }],
    {
      apiKey: "test-key",
      openRouterUrl: "https://openrouter.example/api/chat",
      openRouterModel: "test/model",
      fetchImpl: async (_endpoint, options) => {
        request = options;
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      '{"github_url":null,"zip_url":"https://files.example/work.zip"}',
                  },
                },
              ],
            }),
        };
      },
    }
  );

  assert.deepEqual(material, {
    githubUrl: null,
    zipUrl: "https://files.example/work.zip",
  });
  assert.match(JSON.parse(request.body).messages[0].content, /ZIP archive URL/);
});

test("returns safe diagnostics for malformed OpenRouter assistant content", async () => {
  const logs = [];

  await assert.rejects(
    findGitHubUrlWithOpenRouter([{ text: "solution link" }], {
      apiKey: "test-key",
      openRouterUrl: "https://openrouter.example/api/chat",
      openRouterModel: "test/model",
      flowId: "parse-failure",
      logger: (line) => logs.push(line),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () =>
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                native_finish_reason: "MAX_TOKENS",
                message: { content: "not json" },
              },
            ],
          }),
      }),
    }),
    (error) => {
      assert.match(error.message, /assistant content was not valid JSON/);
      assert.deepEqual(error.details, {
        code: "openrouter.assistant-content.invalid-json",
        contentType: "string",
        contentLength: 8,
        contentPreview: "not json",
        parseError: "Unexpected token 'o', \"not json\" is not valid JSON",
      });
      return true;
    }
  );

  const output = logs.join("\n");
  assert.match(output, /"finishReason":"length"/);
  assert.match(output, /"nativeFinishReason":"MAX_TOKENS"/);
  assert.match(output, /openrouter\.assistant-content\.invalid-json/);
  assert.match(output, /"contentPreview":"not json"/);
  assert.doesNotMatch(output, /test-key/);
});

test("distinguishes a malformed OpenRouter response body", async () => {
  const logs = [];

  await assert.rejects(
    findGitHubUrlWithOpenRouter([{ text: "solution link" }], {
      apiKey: "test-key",
      openRouterUrl: "https://openrouter.example/api/chat",
      openRouterModel: "test/model",
      logger: (line) => logs.push(line),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => "text/html" },
        text: async () => "<html>upstream error</html>",
      }),
    }),
    /response body was not valid JSON/
  );

  assert.match(logs.join("\n"), /openrouter\.response\.invalid-json/);
  assert.match(logs.join("\n"), /"contentType":"text\/html"/);
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
  const previous = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  );
  for (const name of names) delete process.env[name];
  try {
    await writeFile(
      envPath,
      `DEFAULT_ALLOWED_ROOT=${root}\nOPENROUTER_API_KEY=test-key\nOPENROUTER_URL=https://example.test/chat\nOPENROUTER_MODEL=test/model\nGITHUB_SSH_HOST=artemreva-hub\n`
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
    }
  );

  assert.equal(result.repository, "https://github.com/student/fork");
  assert.equal(cloned.repository, "https://github.com/student/fork");
  assert.equal(cloned.candidate, await realpath(folder));
});

test("returns a ZIP material for the authenticated extension download", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "otus-command-zip-"));
  const folder = buildHomeworkFolderPath(root, HOMEWORK_FOLDER);
  const result = await executeCommand(
    {
      command: "clone_student_materials",
      ...HOMEWORK_FOLDER,
      messages: [{ text: "archive" }],
    },
    {
      allowedRoot: root,
      analyzeMessages: async () => ({
        githubUrl: null,
        zipUrl: "https://files.example/work.zip",
      }),
    }
  );

  assert.equal(result.zipUrl, "https://files.example/work.zip");
  assert.equal(result.path, await realpath(folder));
});

test("clones through the configured SSH host alias", async () => {
  const folder = await mkdtemp(
    path.join(os.tmpdir(), "otus-command-gh-clone-")
  );
  let invocation;

  await cloneRepositoryWithSsh(
    "https://github.com/2887444-hue/ai_dz_14_mcp/",
    folder,
    {
      githubSshHost: "artemreva-hub",
      run: async (executable, args, options) => {
        invocation = { executable, args, options };
      },
    }
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
    }
  );

  assert.match(logs.join("\n"), /flow.start/);
  assert.match(logs.join("\n"), /repository.resolved/);
  assert.match(logs.join("\n"), /flow.complete/);
  assert.doesNotMatch(logs.join("\n"), /secret student message/);
});

test("calls OpenRouter with the group analytics system prompt and returns structured analysis", async () => {
  const mockAnalysis = {
    summary: "Группа состоит преимущественно из backend-разработчиков.",
    total: 2,
    segments: [
      {
        category: "Developer",
        count: 1,
        subsegments: [{ subcategory: "Backend", seniority: "Middle", count: 1 }],
      },
      {
        category: "QA/PM/BA",
        count: 1,
        subsegments: [{ subcategory: "QA Engineer", seniority: "Junior", count: 1 }],
      },
    ],
  };

  let capturedBody;
  const result = await analyzeGroupWithOpenRouter(
    {
      groupCode: "AI-dev-tools-2026-07",
      studentCount: 2,
      prompt: "Name: Иван Иванов\nRole: Backend Developer",
    },
    {
      apiKey: "test-key",
      openRouterUrl: "https://openrouter.example/api/chat",
      openRouterModel: "test/model",
      fetchImpl: async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(mockAnalysis) } }],
            }),
        };
      },
    }
  );

  assert.deepEqual(result.analysis, mockAnalysis);
  // System prompt should mention target audience categorization
  assert.match(capturedBody.messages[0].content, /Non-IT/);
  assert.match(capturedBody.messages[0].content, /seniority/i);
  // User message should include group code and student count
  assert.match(capturedBody.messages[1].content, /AI-dev-tools-2026-07/);
  assert.match(capturedBody.messages[1].content, /2 students/);
  // API key must not appear in logs
  assert.doesNotMatch(JSON.stringify(capturedBody), /test-key/);
});

test("rejects when OpenRouter returns invalid JSON for group analysis", async () => {
  await assert.rejects(
    analyzeGroupWithOpenRouter(
      { groupCode: "test", studentCount: 1, prompt: "Name: Test" },
      {
        apiKey: "test-key",
        openRouterUrl: "https://openrouter.example/api/chat",
        openRouterModel: "test/model",
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: async () =>
            JSON.stringify({
              choices: [{ message: { content: "not valid json" } }],
            }),
        }),
      }
    ),
    /analytics content was not valid JSON/
  );
});

test("analyze_group command invokes analyzeGroupWithOpenRouter and returns analysis", async () => {
  const mockAnalysis = {
    summary: "Mixed group.",
    total: 1,
    segments: [
      {
        category: "Developer",
        count: 1,
        subsegments: [{ subcategory: "Backend", seniority: "Senior", count: 1 }],
      },
    ],
  };

  const result = await executeCommand(
    {
      command: "analyze_group",
      groupCode: "AI-dev-tools-2026-07",
      studentCount: 1,
      prompt: "Name: Иван\nRole: Backend Developer",
    },
    {
      analyzeGroup: async () => ({ analysis: mockAnalysis }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.command, "analyze_group");
  assert.deepEqual(result.analysis, mockAnalysis);
});

test("starts a background group analysis job and returns its status via getAnalysisJob", async () => {
  const jobId = `test-job-${Date.now()}`;
  const groups = [
    { id: 1, title: "Group-A", studentCount: 2, prompt: "Name: Alice\nRole: Backend" },
    { id: 2, title: "Group-B", studentCount: 1, prompt: "Name: Bob\nRole: QA" },
  ];

  const analysisResults = new Map([
    ["Group-A", { summary: "Mostly backend.", total: 2, segments: [{ category: "Developer", count: 2, subsegments: [{ subcategory: "Backend", seniority: "Middle", count: 2 }] }] }],
    ["Group-B", { summary: "One QA.", total: 1, segments: [{ category: "QA/PM/BA", count: 1, subsegments: [{ subcategory: "QA Engineer", seniority: "Junior", count: 1 }] }] }],
  ]);

  const result = startGroupAnalysisJob(
    { jobId, groups },
    {
      analyzeGroup: async (msg) => ({
        analysis: analysisResults.get(msg.groupCode),
      }),
    }
  );

  assert.equal(result.jobId, jobId);
  assert.equal(result.total, 2);

  const job = getAnalysisJob(jobId);
  assert.ok(job);
  assert.equal(job.status, "running");
  assert.equal(job.total, 2);

  // Wait for the async job to complete
  await new Promise((resolve) => setTimeout(resolve, 50));

  const doneJob = getAnalysisJob(jobId);
  assert.equal(doneJob.status, "done");
  assert.equal(doneJob.current, 2);
  assert.equal(doneJob.results.length, 2);
  assert.equal(doneJob.results[0].group.title, "Group-A");
  assert.deepEqual(doneJob.results[0].analysis, analysisResults.get("Group-A"));
});

test("records per-group errors without aborting the job", async () => {
  const jobId = `test-job-err-${Date.now()}`;
  const groups = [
    { id: 1, title: "Group-OK", studentCount: 1, prompt: "Name: Alice" },
    { id: 2, title: "Group-Fail", studentCount: 1, prompt: "Name: Bob" },
  ];

  startGroupAnalysisJob(
    { jobId, groups },
    {
      analyzeGroup: async (msg) => {
        if (msg.groupCode === "Group-Fail")
          throw new Error("OpenRouter timeout");
        return { analysis: { total: 1, segments: [] } };
      },
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  const job = getAnalysisJob(jobId);
  assert.equal(job.status, "done");
  assert.equal(job.results.length, 2);
  assert.ok(job.results[1].error);
  assert.match(job.results[1].error, /OpenRouter timeout/);
});

test("start_group_analysis command fires and returns the jobId immediately", async () => {
  const jobId = `test-cmd-job-${Date.now()}`;
  const result = await executeCommand(
    {
      command: "start_group_analysis",
      jobId,
      groups: [{ id: 3, title: "Cmd-Group", studentCount: 1, prompt: "Name: Carol" }],
    },
    {
      startJob: (msg) => ({ jobId: msg.jobId, total: msg.groups.length }),
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.command, "start_group_analysis");
  assert.equal(result.jobId, jobId);
  assert.equal(result.total, 1);
});

test("wraps a network failure in a readable error message", async () => {
  await assert.rejects(
    analyzeGroupWithOpenRouter(
      { groupCode: "Test", studentCount: 1, prompt: "Name: Alice" },
      {
        apiKey: "test-key",
        openRouterUrl: "https://openrouter.example/api/chat",
        openRouterModel: "test/model",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }
    ),
    /OpenRouter недоступен.*ECONNREFUSED/
  );
});

test("surfaces OpenRouter payment or rate-limit errors from the response body", async () => {
  await assert.rejects(
    analyzeGroupWithOpenRouter(
      { groupCode: "Test", studentCount: 1, prompt: "Name: Alice" },
      {
        apiKey: "test-key",
        openRouterUrl: "https://openrouter.example/api/chat",
        openRouterModel: "test/model",
        fetchImpl: async () => ({
          ok: false,
          status: 402,
          headers: { get: () => "application/json" },
          text: async () =>
            JSON.stringify({ error: { message: "Insufficient credits" } }),
        }),
      }
    ),
    /Insufficient credits/
  );
});

test("records network errors per-group without aborting the job", async () => {
  const jobId = `test-job-net-${Date.now()}`;
  startGroupAnalysisJob(
    {
      jobId,
      groups: [
        { id: 1, title: "Group-OK", studentCount: 1, prompt: "Name: Alice" },
        { id: 2, title: "Group-Net-Fail", studentCount: 1, prompt: "Name: Bob" },
      ],
    },
    {
      analyzeGroup: async (msg) => {
        if (msg.groupCode === "Group-Net-Fail")
          throw new Error("OpenRouter недоступен: ECONNREFUSED");
        return { analysis: { total: 1, segments: [] } };
      },
    }
  );

  await new Promise((resolve) => setTimeout(resolve, 50));

  const job = getAnalysisJob(jobId);
  assert.equal(job.status, "done");
  assert.equal(job.results.length, 2);
  assert.ok(!job.results[0].error, "first group should succeed");
  assert.match(job.results[1].error, /ECONNREFUSED/);
});

test("cancels a running job and sets finishedAt", async () => {
  const jobId = `test-cancel-${Date.now()}`;
  // Use a never-resolving group to keep the job running
  let resolveBlock;
  const blockingPromise = new Promise((resolve) => { resolveBlock = resolve; });

  startGroupAnalysisJob(
    { jobId, groups: [{ id: 1, title: "Group-Block", studentCount: 1, prompt: "x" }] },
    { analyzeGroup: async () => { await blockingPromise; return { analysis: {} }; } }
  );

  const before = Date.now();
  const result = cancelGroupAnalysisJob(jobId);
  const after = Date.now();

  assert.equal(result.jobId, jobId);
  assert.equal(result.status, "cancelled");

  const job = getAnalysisJob(jobId);
  assert.equal(job.status, "cancelled");
  assert.ok(job.finishedAt >= before && job.finishedAt <= after + 5);

  // Unblock the hanging analyzeGroup so the test process can exit
  resolveBlock();
});

test("rejects cancelling a job that is not running", async () => {
  const jobId = `test-cancel-done-${Date.now()}`;
  startGroupAnalysisJob(
    { jobId, groups: [{ id: 1, title: "G", studentCount: 1, prompt: "x" }] },
    { analyzeGroup: async () => ({ analysis: { total: 1, segments: [] } }) }
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(getAnalysisJob(jobId).status, "done");

  assert.throws(
    () => cancelGroupAnalysisJob(jobId),
    /not running/
  );
});

test("sets finishedAt when job completes normally", async () => {
  const jobId = `test-finished-${Date.now()}`;
  const before = Date.now();
  startGroupAnalysisJob(
    { jobId, groups: [{ id: 1, title: "G", studentCount: 1, prompt: "x" }] },
    { analyzeGroup: async () => ({ analysis: { total: 1, segments: [] } }) }
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  const job = getAnalysisJob(jobId);
  assert.equal(job.status, "done");
  assert.ok(typeof job.finishedAt === "number" && job.finishedAt >= before);
});

test("cancel_group_analysis command delegates to cancelJob option", async () => {
  let cancelledId;
  const result = await executeCommand(
    { command: "cancel_group_analysis", jobId: "job-xyz" },
    { cancelJob: (id) => { cancelledId = id; return { jobId: id, status: "cancelled" }; } }
  );
  assert.equal(result.ok, true);
  assert.equal(result.command, "cancel_group_analysis");
  assert.equal(result.status, "cancelled");
  assert.equal(cancelledId, "job-xyz");
});
