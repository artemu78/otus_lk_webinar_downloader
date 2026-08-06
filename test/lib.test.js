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
  parseScoringUrl,
  sanitizeDownloadFilename,
  fetchGroupsList,
  fetchGroupStudents,
  buildGroupAnalyticsPrompt,
  buildGroupAnalyticsTSV,
} from "../lib.js";

test("decodes URL-encoded download filenames", () => {
  assert.equal(
    sanitizeDownloadFilename(
      "Dev_AI_Agents_2026_05_%D0%98%D0%BD%D1%84%D1%80%D0%B0%D1%81%D1%82%D1%80%D1%83%D0%BA%D1%82%D1%83%D1%80%D0%B0_%D0%B0%D0%B3%D0%B5%D0%BD%D1%82%D0%BE%D0%B2.mp4"
    ),
    "Dev_AI_Agents_2026_05_Инфраструктура_агентов.mp4"
  );
});

test("replaces characters forbidden in filenames", () => {
  assert.equal(
    sanitizeDownloadFilename("topic%3A%20one%2Ftwo%3F.mp4"),
    "topic_ one_two_.mp4"
  );
});

test("extracts program and lesson IDs", () => {
  assert.deepEqual(
    parseLessonUrl("https://otus.ru/teacher-lk/programs/3616/127815/details"),
    { programId: "3616", lessonId: "127815" }
  );
});

test("rejects unrelated URLs", () => {
  assert.throws(() => parseLessonUrl("https://otus.ru/lessons/127815"));
});

test("builds the expected lesson endpoint", () => {
  assert.equal(
    buildLessonApiUrl({ programId: "3616", lessonId: "127815" }),
    "https://otus.ru/api/teacher-lk/programs/3616/lesson/127815/?lessonId=127815&programId=3616"
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
    /не найдена доступная запись вебинара/
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
    '"Intro ""live"""\t1\t"=SUBSTITUTE(""Alice"", "", "", CHAR(10))"\t2\t""\t1\t"=SUBSTITUTE(""Bob"", "", "", CHAR(10))"\t1\t"=SUBSTITUTE(""Alice"", "", "", CHAR(10))"'
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
      '"Bob"\t"🔴"\t"🟢"'
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

test("recognizes the scoring page URL", () => {
  assert.deepEqual(
    parseScoringUrl("https://otus.ru/teacher-lk/scoring"),
    { isScoring: true }
  );
  assert.deepEqual(
    parseScoringUrl("https://otus.ru/teacher-lk/scoring/"),
    { isScoring: true }
  );
  assert.throws(
    () => parseScoringUrl("https://otus.ru/teacher-lk/programs/3616/127815/"),
    /скоринга/
  );
});

test("fetches and parses the groups list", async () => {
  const mockFetch = async (url) => {
    assert.match(url, /teacher\.lk\.group\.list/);
    return {
      ok: true,
      json: async () => ({
        status: "ok",
        data: [
          { id: 4115, title: "AI-dev-tools-2026-07", is_finished: false },
          { id: 4097, title: "AI-Agents-2026-02", is_finished: true },
        ],
      }),
    };
  };
  const groups = await fetchGroupsList(mockFetch);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, 4115);
  assert.equal(groups[0].title, "AI-dev-tools-2026-07");
});

test("excludes groups whose start_date is in the future", async () => {
  const past = new Date(Date.now() - 86_400_000).toISOString(); // yesterday
  const future = new Date(Date.now() + 86_400_000).toISOString(); // tomorrow
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      status: "ok",
      data: [
        { id: 1, title: "Past Group", start_date: past },
        { id: 2, title: "Future Group", start_date: future },
        { id: 3, title: "No Date Group" },
      ],
    }),
  });
  const groups = await fetchGroupsList(mockFetch);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, 1);
  assert.equal(groups[1].id, 3);
  assert.ok(groups.every((g) => g.id !== 2), "future group must be excluded");
});

test("fetches student rows for a group", async () => {
  const mockFetch = async (url) => {
    assert.match(url, /reports\.scoring\.group\.get/);
    assert.match(url, /group_id=4115/);
    assert.match(url, /sql_report_id=757/);
    return {
      ok: true,
      json: async () => ({
        status: "ok",
        data: {
          rows: [
            ["Иван Иванов", "Backend Developer", 1990, "5 years Java", "Languages: Java 5 year(s);", "", 1],
            ["Мария Сидорова", "QA Engineer", null, null, null, "", 2],
          ],
          head: ["Student", "TITLE", "BIRTHYEAR", "about_self", "Technologies", "github", "user_id"],
        },
      }),
    };
  };
  const rows = await fetchGroupStudents(4115, mockFetch);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0], "Иван Иванов");
  assert.equal(rows[1][1], "QA Engineer");
});

test("builds a prompt string from student rows", () => {
  const rows = [
    ["Иван Иванов", "Backend Developer", 1990, "5 years Java", "Languages: Java 5 year(s);", "", 1],
    ["Мария Сидорова", "QA Engineer", null, null, null, "", 2],
  ];
  const prompt = buildGroupAnalyticsPrompt(rows);
  assert.match(prompt, /Name: Иван Иванов/);
  assert.match(prompt, /Role: Backend Developer/);
  assert.match(prompt, /Birth Year: 1990/);
  assert.match(prompt, /About: 5 years Java/);
  assert.match(prompt, /Technologies: Languages: Java 5 year\(s\);/);
  assert.match(prompt, /Name: Мария Сидорова/);
  assert.match(prompt, /Role: QA Engineer/);
  // null fields should be omitted
  assert.doesNotMatch(prompt, /Birth Year: null/);
  assert.doesNotMatch(prompt, /About: null/);
});

test("builds a TSV for multiple groups ready for Google Sheets", () => {
  const results = [
    {
      group: { id: 4115, title: "AI-dev-tools-2026-07" },
      analysis: {
        total: 5,
        summary: "Mostly backend devs.",
        segments: [
          {
            category: "Developer",
            count: 4,
            subsegments: [
              { subcategory: "Backend", seniority: "Middle", count: 2 },
              { subcategory: "Backend", seniority: "Senior", count: 1 },
              { subcategory: "Frontend", seniority: "Junior", count: 1 },
            ],
          },
          {
            category: "QA/PM/BA",
            count: 1,
            subsegments: [
              { subcategory: "QA Engineer", seniority: "Middle", count: 1 },
            ],
          },
        ],
      },
    },
    {
      group: { id: 4144, title: "AI-Agents-2026-06" },
      analysis: {
        total: 1,
        summary: "One senior architect.",
        segments: [
          {
            category: "Lead",
            count: 1,
            subsegments: [
              { subcategory: "Solution Architect", seniority: "Senior", count: 1 },
            ],
          },
        ],
      },
    },
  ];

  const tsv = buildGroupAnalyticsTSV(results);
  const lines = tsv.split("\n");

  // line 0: first group name (single cell, no tabs)
  assert.match(lines[0], /AI-dev-tools-2026-07/);
  assert.ok(!lines[0].includes("\t"), "group name row must not have tabs");

  // line 1: column header for the group's table
  assert.equal(lines[1], "Категория\tКоличество\tДетализация");

  // line 2: Developer row — category, total count, multi-line detail with subsegments
  assert.match(lines[2], /Developer/);
  assert.match(lines[2], /\t4\t/);
  assert.match(lines[2], /Backend Middle 2/);
  assert.match(lines[2], /Backend Senior 1/);
  assert.match(lines[2], /Frontend Junior 1/);

  // line 3: QA/PM/BA row
  assert.match(lines[3], /QA\/PM\/BA/);
  assert.match(lines[3], /\t1\t/);
  assert.match(lines[3], /QA Engineer Middle 1/);

  // line 4: empty separator
  assert.equal(lines[4], "");

  // line 5: second group name
  assert.match(lines[5], /AI-Agents-2026-06/);

  // line 6: column header again
  assert.equal(lines[6], "Категория\tКоличество\tДетализация");

  // line 7: Lead row with subcategory+seniority detail
  assert.match(lines[7], /Lead/);
  assert.match(lines[7], /\t1\t/);
  assert.match(lines[7], /Solution Architect Senior 1/);

  // line 8: trailing empty separator
  assert.equal(lines[8], "");

  assert.equal(lines.length, 9);
});

test("falls back gracefully when AI returns no subsegments", () => {
  const results = [
    {
      group: { id: 1, title: "Test Group" },
      analysis: {
        total: 3,
        segments: [
          { category: "Developer", count: 3 }, // no subsegments field
        ],
      },
    },
  ];
  const tsv = buildGroupAnalyticsTSV(results);
  const lines = tsv.split("\n");
  assert.match(lines[2], /Developer/);
  assert.match(lines[2], /\t3\t/);
  // fallback detail: category + count
  assert.match(lines[2], /Developer 3/);
});
