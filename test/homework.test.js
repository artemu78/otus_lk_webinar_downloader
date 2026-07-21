import assert from "node:assert/strict";
import test from "node:test";
import {
  findStudentSurname,
  findStudentMessages,
  findStudentStaticFiles,
  parseHomeworkUrl,
} from "../lib.js";

test("extracts student and homework IDs from a homework URL", () => {
  assert.deepEqual(
    parseHomeworkUrl("https://otus.ru/teacher-lk/homework/170836/47369"),
    { studentId: "170836", homeworkId: "47369" }
  );
});

test("rejects an incomplete homework URL", () => {
  assert.throws(
    () => parseHomeworkUrl("https://otus.ru/teacher-lk/homework/170836"),
    /Не удалось определить студента/
  );
});

test("finds the student surname in chat actors", () => {
  const payload = {
    data: {
      chat: [
        { actor: { id: 1, lname: "Преподаватель" } },
        { actor: { id: 170836, lname: "Иванов" } },
      ],
    },
  };
  assert.equal(findStudentSurname(payload, "170836"), "Иванов");
});

test("returns only messages written by the student", () => {
  const studentMessage = {
    actor: { id: 170836 },
    text: "https://github.com/me/repo",
  };
  const payload = {
    data: {
      chat: [
        { actor: { id: 1 }, text: "teacher reply" },
        studentMessage,
        { actor: { id: "170836" }, text: "second student message" },
      ],
    },
  };
  assert.deepEqual(findStudentMessages(payload, "170836"), [
    studentMessage,
    payload.data.chat[2],
  ]);
});

test("rejects a chat without student messages", () => {
  assert.throws(
    () => findStudentMessages({ data: { chat: [] } }, "170836"),
    /не найдены сообщения студента/
  );
});

test("finds only supported static file attachments submitted by the student", () => {
  const payload = {
    data: {
      chat: [
        {
          actor: { id: 170836 },
          media: [
            {
              type: "file",
              media: {
                link: "https://cdn.otus.ru/media/private/report.xlsx?hash=1",
                original_file_name: "Отчёт.xlsx",
              },
            },
            {
              type: "file",
              media: {
                link: "https://cdn.otus.ru/media/private/archive.zip?hash=2",
                original_file_name: "archive.zip",
              },
            },
          ],
        },
        {
          actor: { id: 1 },
          media: [
            {
              type: "file",
              media: {
                link: "https://cdn.otus.ru/media/private/teacher.pdf",
                original_file_name: "teacher.pdf",
              },
            },
          ],
        },
      ],
    },
  };

  assert.deepEqual(findStudentStaticFiles(payload, "170836"), [
    {
      url: "https://cdn.otus.ru/media/private/report.xlsx?hash=1",
      filename: "Отчёт.xlsx",
    },
  ]);
});
