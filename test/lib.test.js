import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLessonApiUrl,
  buildAttendanceTableTSV,
  buildSummaryTableTSV,
  findWebinarDownloadUrl,
  generateAttendanceTableTSV,
  generateSummaryTableTSV,
  parseLessonUrl,
  sanitizeDownloadFilename,
} from "../lib.js";

test("decodes URL-encoded download filenames", () => {
  assert.equal(
    sanitizeDownloadFilename(
      "Dev_AI_Agents_2026_05_%D0%98%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0_%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D0%BE%D0%B2.mp4",
    ),
    "Dev_AI_Agents_2026_05_Инфраструктура_агентов.mp4",
  );
});

test("replaces characters forbidden in filenames", () => {
  assert.equal(
    sanitizeDownloadFilename("topic%3A%20one%2Ftwo%3F.mp4"),
    "topic_ one_two_.mp4",
  );
});

test("extracts program and lesson IDs", () => {
  assert.deepEqual(
    parseLessonUrl("https://otus.ru/teacher-lk/programs/3616/127815/details"),
    { programId: "3616", lessonId: "127815" },
  );
});

test("rejects unrelated URLs", () => {
  assert.throws(() => parseLessonUrl("https://otus.ru/lessons/127815"));
});

test("builds the expected lesson endpoint", () => {
  assert.equal(
    buildLessonApiUrl({ programId: "3616", lessonId: "127815" }),
    "https://otus.ru/api/teacher-lk/programs/3616/lesson/127815/?lessonId=127815&programId=3616",
  );
});

test("selects the first non-private webinar", () => {
  const payload = {
    data: {
      lesson: {
        media: [
          {
            type: "webinar",
            is_private: true,
            attrs: { download_url: "https://cdn.test/private" },
          },
          {
            type: "video",
            is_private: false,
            attrs: { download_url: "https://cdn.test/video" },
          },
          {
            type: "webinar",
            is_private: false,
            attrs: { download_url: "https://cdn.test/first" },
          },
          {
            type: "webinar",
            is_private: false,
            attrs: { download_url: "https://cdn.test/second" },
          },
        ],
      },
    },
  };
  assert.equal(findWebinarDownloadUrl(payload), "https://cdn.test/first");
});

test("fails when no eligible webinar exists", () => {
  assert.throws(
    () => findWebinarDownloadUrl({ data: { lesson: { media: [] } } }),
    /не найдена доступная запись вебинара/,
  );
});

const lessons = [
  {
    title: 'Intro "live"',
    onlineUsers: [{ id: 1, fullname: "Alice" }],
    offlineUsers: [],
    rawOfflineCounter: 2,
    polls: [
      { stats: [{ answers: [{ users: [{ id: 1, fullname: "Alice" }] }] }] },
    ],
  },
  {
    title: "Practice",
    onlineUsers: [],
    offlineUsers: [{ id: 2, name: "Bob" }],
    rawOfflineCounter: 0,
    polls: [],
  },
];
const students = new Map([
  [1, "Alice"],
  [2, "Bob"],
]);

test("generates the summary table independently", () => {
  const rows = buildSummaryTableTSV({
    lessonCache: lessons,
    masterStudents: students,
  }).split("\n");

  assert.match(rows[0], /^Lesson Title\tOnline Count/);
  assert.equal(
    rows[1],
    '"Intro ""live"""\t1\t"=SUBSTITUTE(""Alice"", "", "", CHAR(10))"\t2\t""\t1\t"=SUBSTITUTE(""Bob"", "", "", CHAR(10))"\t1\t"=SUBSTITUTE(""Alice"", "", "", CHAR(10))"',
  );
});

test("generates the attendance table independently", () => {
  assert.equal(
    buildAttendanceTableTSV({
      lessonCache: lessons,
      masterStudents: students,
    }),
    'Student Name\t"L1: Intro ""live"""\t"L2: Practice"\n' +
      '"Alice"\t"🟢"\t"🔴"\n' +
      '"Bob"\t"🔴"\t"🟢"',
  );
});

function createFetchMock() {
  return async (url) => ({
    async json() {
      if (url.includes("/get/")) {
        return {
          data: { modules: [{ lessons: [{ id: 10, title: "Intro" }] }] },
        };
      }
      if (url.includes("/lesson/")) {
        return { data: { schedules: [{ id: 20 }], polls: [] } };
      }
      return {
        data: {
          online: [{ id: 1, fullname: "Alice" }],
          offline: [],
        },
      };
    },
  });
}

test("fetches and generates the summary table as a standalone operation", async () => {
  const result = await generateSummaryTableTSV("123", createFetchMock());
  assert.match(result, /"Intro"\t1/);
});

test("fetches and generates the attendance table as a standalone operation", async () => {
  const result = await generateAttendanceTableTSV("123", createFetchMock());
  assert.match(result, /"Alice"\t"🟢"/);
});

test("reports numbered progress stages while collecting data", async () => {
  const progress = [];

  await generateSummaryTableTSV("123", createFetchMock(), (message) => {
    progress.push(message);
  });

  assert.deepEqual(progress, [
    "1/3 Получаем данные программы… Не закрывайте окно",
    "2/3 Получаем данные занятий… (1/1). Не закрывайте окно",
    "3/3 Получаем данные посещаемости… (1/1). Не закрывайте окно",
  ]);
});
