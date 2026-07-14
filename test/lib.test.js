import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLessonApiUrl,
  findWebinarDownloadUrl,
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
    data: { lesson: { media: [
      { type: "webinar", is_private: true, attrs: { download_url: "https://cdn.test/private" } },
      { type: "video", is_private: false, attrs: { download_url: "https://cdn.test/video" } },
      { type: "webinar", is_private: false, attrs: { download_url: "https://cdn.test/first" } },
      { type: "webinar", is_private: false, attrs: { download_url: "https://cdn.test/second" } },
    ] } },
  };
  assert.equal(findWebinarDownloadUrl(payload), "https://cdn.test/first");
});

test("fails when no eligible webinar exists", () => {
  assert.throws(
    () => findWebinarDownloadUrl({ data: { lesson: { media: [] } } }),
    /No public webinar/,
  );
});
