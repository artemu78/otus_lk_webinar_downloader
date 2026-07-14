import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLessonApiUrl,
  findWebinarDownloadUrl,
  parseLessonUrl,
} from "../lib.js";

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
