import {
  generateAttendanceTableTSV,
  generateSummaryTableTSV,
  parseLessonUrl,
} from "./lib.js";

const lessonElement = document.querySelector("#lesson");
const downloadButton = document.querySelector("#download");
const summaryButton = document.querySelector("#summary");
const attendanceButton = document.querySelector("#attendance");
const actionButtons = [downloadButton, summaryButton, attendanceButton];
const statusElement = document.querySelector("#status");
let lessonIds;

initialize();

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    lessonIds = parseLessonUrl(tab?.url ?? "");
    lessonElement.textContent = `Программа ${lessonIds.programId} · Занятие ${lessonIds.lessonId}`;
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
