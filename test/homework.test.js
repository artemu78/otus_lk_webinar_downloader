import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomeworkFolderPath,
  courseCodeToDirectory,
  findAssignedHomework,
  findStudentSurname,
  findStudentMessages,
  parseHomeworkUrl,
  splitGroupCode,
  transliterateFolderPart,
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

test("finds assigned homework using numeric API IDs", () => {
  const payload = {
    data: {
      items: [
        { user_id: 710488, homework_id: 34, group: "Dev-AI-Agents-2026-05" },
        { user_id: 170836, homework_id: 47369, group: "AI-dev-tools-2026-04" },
      ],
    },
  };
  assert.equal(
    findAssignedHomework(payload, {
      studentId: "170836",
      homeworkId: "47369",
    }).group,
    "AI-dev-tools-2026-04",
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

test("transliterates Russian surnames into safe folder names", () => {
  assert.equal(transliterateFolderPart("Щербаков"), "Shcherbakov");
  assert.equal(transliterateFolderPart("Иванова-Петрова"), "Ivanova-Petrova");
});

test("splits a group at its YYYY-MM suffix", () => {
  assert.deepEqual(splitGroupCode("AI-dev-tools-2026-04"), {
    courseCode: "AI-dev-tools",
    groupCode: "2026-04",
  });
});

test("maps known OTUS course codes to local directory names", () => {
  assert.equal(courseCodeToDirectory("AI-dev-tools"), "AI_Dev_Tools");
  assert.equal(courseCodeToDirectory("Dev-AI-Agents"), "DEV-AI-Agents");
});

test("builds the local homework folder path", () => {
  assert.equal(
    buildHomeworkFolderPath("AI-dev-tools-2026-07", "Иванов"),
    "/Users/artemreva/projects/otus/AI_Dev_Tools/2026-07/Ivanov",
  );
});
