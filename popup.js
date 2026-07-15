import {
  generateAttendanceTableTSV,
  generateSummaryTableTSV,
  parseLessonUrl,
  parseHomeworkUrl,
} from "./lib.js";

const lessonElement = document.querySelector("#lesson");
const downloadButton = document.querySelector("#download");
const summaryButton = document.querySelector("#summary");
const attendanceButton = document.querySelector("#attendance");
const homeworkFolderButton = document.querySelector("#homework-folder");
const homeworkMaterialsButton = document.querySelector("#homework-materials");
const homeworkResultsButton = document.querySelector("#homework-results");
const homeworkWarpButton = document.querySelector("#homework-warp");
const lessonButtons = [downloadButton, summaryButton, attendanceButton];
const homeworkButtons = [
  homeworkFolderButton,
  homeworkMaterialsButton,
  homeworkResultsButton,
  homeworkWarpButton,
];
const actionButtons = [...lessonButtons, ...homeworkButtons];
const statusElement = document.querySelector("#status");
let lessonIds;
let homeworkIds;

initialize();

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeUrl = tab?.url ?? "";
    if (activeUrl.startsWith("https://otus.ru/teacher-lk/homework")) {
      homeworkIds = parseHomeworkUrl(activeUrl);
      for (const button of lessonButtons) button.hidden = true;
      for (const button of homeworkButtons) button.hidden = false;
      lessonElement.textContent = `Студент ${homeworkIds.studentId} · Работа ${homeworkIds.homeworkId}`;
    } else {
      lessonIds = parseLessonUrl(activeUrl);
      lessonElement.textContent = `Программа ${lessonIds.programId} · Занятие ${lessonIds.lessonId}`;
    }
    setActionsDisabled(false);
  } catch (error) {
    lessonElement.textContent = "Занятие OTUS не найдено";
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  }
}

downloadButton.addEventListener("click", async () => {
  if (!lessonIds) return;

  setActionsDisabled(true);
  downloadButton.textContent = "Запускаем…";
  showStatus("Получаем данные занятия…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_WEBINAR",
      payload: lessonIds,
    });
    if (!result?.ok)
      throw new Error(result?.error ?? "Не удалось начать загрузку.");
    showStatus("Загрузка началась.", false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    downloadButton.textContent = "Скачать вебинар";
  }
});

homeworkFolderButton.addEventListener("click", async () => {
  if (!homeworkIds) return;

  setActionsDisabled(true);
  homeworkFolderButton.textContent = "Ищем папку…";
  showStatus("Получаем данные домашней работы…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "OPEN_HOMEWORK_FOLDER",
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось открыть папку студента.");
    }
    rememberHomeworkPath(result.path);
    showStatus(`Открыта папка ${result.path}`, false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    homeworkFolderButton.textContent = "Открыть папку студента";
  }
});

homeworkMaterialsButton.addEventListener("click", async () => {
  if (!homeworkIds) return;

  setActionsDisabled(true);
  homeworkMaterialsButton.textContent = "Скачиваем…";
  showStatus("Ищем ссылку на GitHub в сообщениях студента…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_HOMEWORK_MATERIALS",
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось скачать материалы студента.");
    }
    rememberHomeworkPath(result.path);
    showStatus(`Материалы скачаны в ${result.path}`, false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    homeworkMaterialsButton.textContent = "Скачать материалы студента";
  }
});

homeworkResultsButton.addEventListener("click", async () => {
  if (!homeworkIds) return;

  setActionsDisabled(true);
  homeworkResultsButton.textContent = "Читаем результат…";
  showStatus("Ищем последний TXT-файл в analyze_result…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "READ_HOMEWORK_RESULTS",
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось прочитать результаты проверки.");
    }
    rememberHomeworkPath(result.path);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (typeof tab?.id !== "number") {
      throw new Error("Не удалось определить активную вкладку.");
    }
    const [{ result: inserted }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: insertIntoFirstTextarea,
      args: [result.content],
    });
    if (!inserted) {
      throw new Error("На странице не найдено поле для результатов проверки.");
    }
    showStatus(`Вставлен файл ${result.filename}`, false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    homeworkResultsButton.textContent = "Вставить результаты проверки";
  }
});

homeworkWarpButton.addEventListener("click", async () => {
  if (!homeworkIds) return;

  setActionsDisabled(true);
  homeworkWarpButton.textContent = "Открываем…";
  showStatus("Открываем папку в Warp…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "OPEN_HOMEWORK_WARP",
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось открыть Warp.");
    }
    rememberHomeworkPath(result.path);
    showStatus(`Warp открыт в ${result.path}`, false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    homeworkWarpButton.textContent = "Открыть Warp";
  }
});

function getHomeworkStorageKey() {
  return `oth/homework-folder/${homeworkIds.studentId}/${homeworkIds.homeworkId}`;
}

function getHomeworkPayload() {
  const cachedPath = localStorage.getItem(getHomeworkStorageKey());
  return cachedPath ? { ...homeworkIds, cachedPath } : { ...homeworkIds };
}

function rememberHomeworkPath(folderPath) {
  if (typeof folderPath === "string" && folderPath) {
    localStorage.setItem(getHomeworkStorageKey(), folderPath);
  }
}

function insertIntoFirstTextarea(content) {
  const textarea = document.querySelector("textarea");
  if (!textarea) return false;

  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(textarea, content);
  else textarea.value = content;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
  textarea.focus();
  return true;
}

summaryButton.addEventListener("click", () =>
  generateAndCopyTable(
    summaryButton,
    "Формируем сводную таблицу… Не закрывайте окно",
    generateSummaryTableTSV,
  ),
);

attendanceButton.addEventListener("click", () =>
  generateAndCopyTable(
    attendanceButton,
    "Формируем таблицу посещаемости… Не закрывайте окно",
    generateAttendanceTableTSV,
  ),
);

async function generateAndCopyTable(button, loadingText, generator) {
  if (!lessonIds) return;

  setActionsDisabled(true);
  const originalButtonText = button.textContent.trim();
  button.textContent = loadingText;

  try {
    const tsv = await generator(lessonIds.programId, fetch, showStatus);
    await navigator.clipboard.writeText(tsv);
    const result = await chrome.runtime.sendMessage({ type: "OPEN_GOOGLE_SHEET" });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось открыть Google Таблицы.");
    }
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
    );
  } finally {
    setActionsDisabled(false);
    button.textContent = originalButtonText;
  }
}

function setActionsDisabled(disabled) {
  for (const button of actionButtons) button.disabled = disabled;
}

function showStatus(message, isError = false, isSuccess = false) {
  statusElement.textContent = message;
  statusElement.className = `status${isError ? " error" : isSuccess ? " success" : ""}`;
}
