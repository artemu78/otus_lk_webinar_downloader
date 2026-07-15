import assert from "node:assert/strict";
import test from "node:test";
import {
  findStudentSurname,
  findStudentMessages,
  parseHomeworkUrl,
} from "../lib.js";

test("extracts student and homework IDs from a homework URL", () => {
  assert.deepEqual(
    parseHomeworkUrl("https://otus.ru/teacher-lk/homework/170836/47369"),
    { studentId: "170836", homeworkId: "47369" },
  );
});

test("rejects an incomplete homework URL", () => {
  assert.throws(
    () => parseHomeworkUrl("https://otus.ru/teacher-lk/homework/170836"),
    /Не удалось определить студента/,
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
  const studentMessage = { actor: { id: 170836 }, text: "https://github.com/me/repo" };
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
    /не найдены сообщения студента/,
  );
});
