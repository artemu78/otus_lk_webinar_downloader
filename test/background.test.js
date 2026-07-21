import assert from "node:assert/strict";
import test from "node:test";

let messageListener;

globalThis.chrome = {
  downloads: {
    onDeterminingFilename: { addListener() {} },
    async download() {
      return 1;
    },
  },
  runtime: {
    id: "test-extension",
    onMessage: {
      addListener(listener) {
        messageListener = listener;
      },
    },
  },
};

await import("../background.js");

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    const keepChannelOpen = messageListener(message, {}, resolve);
    if (keepChannelOpen !== true) {
      reject(
        new Error(
          "The background listener did not keep the response channel open."
        )
      );
    }
  });
}

test("opens the numbered homework folder using the homework and group endpoints", async () => {
  const requestedUrls = [];
  let localCommand;
  const expectedPath =
    "/Users/artemreva/projects/otus/AI_Dev_Tools/2026-07/homework/Ivanov/hw2";

  globalThis.fetch = async (url, options = {}) => {
    requestedUrls.push(url);

    if (url.includes("/homework/msg/170836/47369/")) {
      return jsonResponse({
        data: { chat: [{ actor: { id: 170836, lname: "Иванов" } }] },
      });
    }
    if (url.includes("/homework/put/170836/47369/")) {
      return jsonResponse({ data: { homework: { group_id: 42 } } });
    }
    if (url.includes("/homework/journal/42/")) {
      return jsonResponse({
        data: {
          group: { title: "AI-dev-tools-2026-07" },
          homeworks: [{ id: 100 }, { id: 47369 }, { id: 50000 }],
        },
      });
    }
    if (url === "http://127.0.0.1:8765/commands") {
      localCommand = JSON.parse(options.body);
      return jsonResponse({ ok: true, path: expectedPath });
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await sendRuntimeMessage({
    type: "OPEN_HOMEWORK_FOLDER",
    payload: { studentId: "170836", homeworkId: "47369" },
  });

  assert.deepEqual(response, { ok: true, path: expectedPath });
  assert.deepEqual(localCommand, {
    command: "open_folder",
    groupCode: "AI-dev-tools-2026-07",
    surname: "Иванов",
    homeworkNumber: 2,
  });
  assert.deepEqual(requestedUrls.slice(0, 3), [
    "https://otus.ru/api/teacher-lk/homework/msg/170836/47369/",
    "https://otus.ru/api/teacher-lk/homework/put/170836/47369/?",
    "https://otus.ru/api/teacher-lk/homework/journal/42/?groupId=42",
  ]);
});

test("reports an error when the homework is absent from the group journal", async () => {
  globalThis.fetch = async (url) => {
    if (url.includes("/homework/msg/")) {
      return jsonResponse({
        data: { chat: [{ actor: { id: 170836, lname: "Иванов" } }] },
      });
    }
    if (url.includes("/homework/put/")) {
      return jsonResponse({ data: { homework: { group_id: 42 } } });
    }
    if (url.includes("/homework/journal/42/")) {
      return jsonResponse({
        data: {
          group: { title: "AI-dev-tools-2026-07" },
          homeworks: [{ id: 100 }],
        },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await sendRuntimeMessage({
    type: "OPEN_HOMEWORK_FOLDER",
    payload: { studentId: "170836", homeworkId: "47369" },
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /Домашняя работа id=47369 не найдена/);
});

test("uses the cached path for Finder without calling OTUS", async () => {
  let localCommand;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, "http://127.0.0.1:8765/commands");
    localCommand = JSON.parse(options.body);
    return jsonResponse({ ok: true, path: localCommand.path });
  };

  const response = await sendRuntimeMessage({
    type: "OPEN_HOMEWORK_FOLDER",
    payload: {
      studentId: "170836",
      homeworkId: "47369",
      cachedPath: "/projects/otus/course/student/hw2",
    },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(localCommand, {
    command: "open_folder",
    path: "/projects/otus/course/student/hw2",
  });
});

test("downloads a student ZIP with the Chrome session before local extraction", async () => {
  const zipUrl = "https://otus.ru/private/materials.zip";
  const expectedPath = "/projects/otus/course/student/hw2";
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/homework/msg/170836/47369/")) {
      return jsonResponse({
        data: { chat: [{ actor: { id: 170836 }, text: zipUrl }] },
      });
    }
    if (url === "http://127.0.0.1:8765/commands") {
      return jsonResponse({ ok: true, path: expectedPath, zipUrl });
    }
    if (url === zipUrl) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    }
    if (url === "http://127.0.0.1:8765/zip-extraction") {
      return jsonResponse({ ok: true, path: expectedPath });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_HOMEWORK_MATERIALS",
    payload: {
      studentId: "170836",
      homeworkId: "47369",
      cachedPath: expectedPath,
    },
  });

  assert.equal(response.ok, true);
  const download = calls.find((call) => call.url === zipUrl);
  assert.equal(download.options.credentials, "include");
  const extraction = calls.find(
    (call) => call.url === "http://127.0.0.1:8765/zip-extraction"
  );
  assert.equal(extraction.options.headers["X-OTUS-Student-Path"], expectedPath);
  assert.deepEqual(
    new Uint8Array(extraction.options.body),
    new Uint8Array([1, 2, 3])
  );
});

test("downloads supported student chat attachments while resolving homework context", async () => {
  const uploads = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url.includes("/homework/msg/170836/47369/")) {
      return jsonResponse({
        data: {
          chat: [
            {
              actor: { id: 170836, lname: "Иванов" },
              media: [
                {
                  type: "file",
                  media: {
                    link: "https://cdn.otus.ru/media/private/work.docx?hash=1",
                    original_file_name: "Работа 1.docx",
                  },
                },
              ],
            },
          ],
        },
      });
    }
    if (url.includes("/homework/put/")) {
      return jsonResponse({ data: { homework: { group_id: 42 } } });
    }
    if (url.includes("/homework/journal/42/")) {
      return jsonResponse({
        data: {
          group: { title: "AI-dev-tools-2026-07" },
          homeworks: [{ id: 47369 }],
        },
      });
    }
    if (url === "http://127.0.0.1:8765/commands") {
      return jsonResponse({ ok: true, path: "/projects/otus/course/student/hw1" });
    }
    if (url === "https://cdn.otus.ru/media/private/work.docx?hash=1") {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    }
    if (url === "http://127.0.0.1:8765/static-file") {
      uploads.push(options);
      return jsonResponse({
        ok: true,
        path: "/projects/otus/course/student/hw1",
        skippedExisting: false,
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const response = await sendRuntimeMessage({
    type: "DOWNLOAD_HOMEWORK_MATERIALS",
    payload: { studentId: "170836", homeworkId: "47369" },
  });

  assert.equal(response.ok, true);
  assert.equal(response.staticFileCount, 1);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].headers["X-OTUS-Student-Path"], "/projects/otus/course/student/hw1");
  assert.equal(
    decodeURIComponent(uploads[0].headers["X-OTUS-File-Name"]),
    "Работа 1.docx"
  );
});

test("reads analysis through the cached homework path", async () => {
  let localCommand;
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, "http://127.0.0.1:8765/commands");
    localCommand = JSON.parse(options.body);
    return jsonResponse({
      ok: true,
      path: localCommand.path,
      filename: "evaluation.txt",
      content: "Принято",
    });
  };

  const response = await sendRuntimeMessage({
    type: "READ_HOMEWORK_RESULTS",
    payload: {
      studentId: "170836",
      homeworkId: "47369",
      cachedPath: "/projects/otus/course/student/hw2",
    },
  });

  assert.deepEqual(localCommand, {
    command: "read_latest_analysis",
    path: "/projects/otus/course/student/hw2",
  });
  assert.equal(response.content, "Принято");
});
