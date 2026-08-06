import {
  generateAttendanceTableTSV,
  generateSummaryTableTSV,
  parseLessonUrl,
  parseHomeworkUrl,
  parseScoringUrl,
  fetchGroupsList,
  fetchGroupStudents,
  buildGroupAnalyticsPrompt,
  buildGroupAnalyticsTSV,
} from "./lib.js";
import { EXTENSION_MESSAGES } from "./constants.js";

const lessonElement = document.querySelector("#lesson");
const downloadButton = document.querySelector("#download");
const summaryButton = document.querySelector("#summary");
const attendanceButton = document.querySelector("#attendance");
const homeworkFolderButton = document.querySelector("#homework-folder");
const homeworkMaterialsButton = document.querySelector("#homework-materials");
const homeworkResultsButton = document.querySelector("#homework-results");
const homeworkWarpButton = document.querySelector("#homework-warp");
const analyzeGroupButton = document.querySelector("#analyze-group");
const groupPickerPanel = document.querySelector("#group-picker");
const groupPickerFilter = document.querySelector("#group-picker-filter");
const groupPickerList = document.querySelector("#group-picker-list");
const groupPickerRun = document.querySelector("#group-picker-run");
const analysisJobPanel = document.querySelector("#analysis-job-panel");
const analysisJobLabel = document.querySelector("#analysis-job-label");
const analysisJobTime = document.querySelector("#analysis-job-time");
const analysisJobStatus = document.querySelector("#analysis-job-status");
const analysisJobKill = document.querySelector("#analysis-job-kill");
const analysisJobNew = document.querySelector("#analysis-job-new");
const analysisJobResults = document.querySelector("#analysis-job-results");
const analysisJobCopy = document.querySelector("#analysis-job-copy");
const analysisJobSheet = document.querySelector("#analysis-job-sheet");
const analysisJobErrors = document.querySelector("#analysis-job-errors");
const homeworkFolderSetting = document.querySelector(
  "#homework-folder-setting"
);
const homeworkFolderInput = document.querySelector("#homework-folder-path");
const saveHomeworkFolderButton = document.querySelector(
  "#save-homework-folder"
);
const lessonButtons = [downloadButton, summaryButton, attendanceButton];
const homeworkButtons = [
  homeworkFolderButton,
  homeworkMaterialsButton,
  homeworkResultsButton,
  homeworkWarpButton,
];
const scoringButtons = [analyzeGroupButton];
const actionButtons = [...lessonButtons, ...homeworkButtons, ...scoringButtons];
const statusElement = document.querySelector("#status");
let lessonIds;
let homeworkIds;
let scoringIds;
let allGroups = [];

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

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
      for (const button of scoringButtons) button.hidden = true;
      homeworkFolderSetting.hidden = false;
      homeworkFolderInput.value =
        localStorage.getItem(getHomeworkStorageKey()) ?? "";
      lessonElement.textContent = `Студент ${homeworkIds.studentId} · Работа ${homeworkIds.homeworkId}`;
    } else if (activeUrl.startsWith("https://otus.ru/teacher-lk/scoring")) {
      scoringIds = parseScoringUrl(activeUrl);
      for (const button of lessonButtons) button.hidden = true;
      for (const button of homeworkButtons) button.hidden = true;
      for (const button of scoringButtons) button.hidden = false;
      homeworkFolderSetting.hidden = true;
      lessonElement.textContent = "Скоринг групп";
      showJobPanelForScoring();
    } else {
      lessonIds = parseLessonUrl(activeUrl);
      lessonElement.textContent = `Программа ${lessonIds.programId} · Занятие ${lessonIds.lessonId}`;
    }
    setActionsDisabled(false);
  } catch (error) {
    lessonElement.textContent = "Занятие OTUS не найдено";
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true
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
      type: EXTENSION_MESSAGES.DOWNLOAD_WEBINAR,
      payload: lessonIds,
    });
    if (!result?.ok)
      throw new Error(result?.error ?? "Не удалось начать загрузку.");
    showStatus("Загрузка началась.", false, true);
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true
    );
  } finally {
    setActionsDisabled(false);
    downloadButton.textContent = "Скачать вебинар";
  }
});

saveHomeworkFolderButton.addEventListener("click", saveHomeworkFolderPath);
homeworkFolderInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveHomeworkFolderPath();
});

function saveHomeworkFolderPath() {
  if (!homeworkIds) return;

  const folderPath = homeworkFolderInput.value.trim();
  if (folderPath) {
    localStorage.setItem(getHomeworkStorageKey(), folderPath);
    homeworkFolderInput.value = folderPath;
    showStatus("Путь к папке сохранён.", false, true);
  } else {
    localStorage.removeItem(getHomeworkStorageKey());
    showStatus(
      "Сохранённый путь удалён. Следующее действие снова запросит данные OTUS.",
      false,
      true
    );
  }
}

homeworkFolderButton.addEventListener("click", async () => {
  if (!homeworkIds) return;

  setActionsDisabled(true);
  homeworkFolderButton.textContent = "Ищем папку…";
  showStatus("Получаем данные домашней работы…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGES.OPEN_HOMEWORK_FOLDER,
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
      true
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
  showStatus("Ищем ссылку на GitHub или ZIP в сообщениях студента…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGES.DOWNLOAD_HOMEWORK_MATERIALS,
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      const error = new Error(
        result?.error ?? "Не удалось скачать материалы студента."
      );
      error.details = result?.details;
      throw error;
    }
    if (result.path) rememberHomeworkPath(result.path);
    const skipped = Number(result.skippedExisting) || 0;
    const staticFileCount = Number(result.staticFileCount) || 0;
    showStatus(
      !result.path && staticFileCount > 0
        ? `Скачано файлов из чата: ${staticFileCount}. Они находятся в папке Downloads/OTUS homework materials.`
        : skipped > 0
        ? `Материалы скачаны в ${result.path}; существующие файлы не перезаписаны: ${skipped}.`
        : staticFileCount > 0
          ? `Материалы скачаны в ${result.path}; файлов из чата: ${staticFileCount}.`
          : `Материалы скачаны в ${result.path}`,
      false,
      true
    );
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true,
      false,
      error?.details
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
      type: EXTENSION_MESSAGES.READ_HOMEWORK_RESULTS,
      payload: getHomeworkPayload(),
    });
    if (!result?.ok) {
      throw new Error(
        result?.error ?? "Не удалось прочитать результаты проверки."
      );
    }
    rememberHomeworkPath(result.path);
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
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
      true
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
      type: EXTENSION_MESSAGES.OPEN_HOMEWORK_WARP,
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
      true
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
    homeworkFolderInput.value = folderPath;
  }
}

function insertIntoFirstTextarea(content) {
  const textarea = document.querySelector("textarea");
  if (!textarea) return false;

  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value"
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
    generateSummaryTableTSV
  )
);

attendanceButton.addEventListener("click", () =>
  generateAndCopyTable(
    attendanceButton,
    "Формируем таблицу посещаемости… Не закрывайте окно",
    generateAttendanceTableTSV
  )
);

async function generateAndCopyTable(button, loadingText, generator) {
  if (!lessonIds) return;

  setActionsDisabled(true);
  const originalButtonText = button.textContent.trim();
  button.textContent = loadingText;

  try {
    const tsv = await generator(lessonIds.programId, fetch, showStatus);
    await navigator.clipboard.writeText(tsv);
    const result = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGES.OPEN_GOOGLE_SHEET,
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Не удалось открыть Google Таблицы.");
    }
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Непредвиденная ошибка.",
      true
    );
  } finally {
    setActionsDisabled(false);
    button.textContent = originalButtonText;
  }
}

// --- Group picker & background job ---

const ANALYSIS_JOB_STORAGE_KEY = "owd/analysis-job";
let pollTimer = null;

function saveJobMeta(jobId, groupTitles) {
  localStorage.setItem(
    ANALYSIS_JOB_STORAGE_KEY,
    JSON.stringify({ jobId, groupTitles, startedAt: Date.now() })
  );
}

function loadJobMeta() {
  try {
    return JSON.parse(localStorage.getItem(ANALYSIS_JOB_STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function clearJobMeta() {
  localStorage.removeItem(ANALYSIS_JOB_STORAGE_KEY);
}

async function fetchJobStatus(jobId) {
  const url = `http://127.0.0.1:8765/analysis-job/${encodeURIComponent(jobId)}`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Origin: chrome.runtime.getURL("") },
    });
  } catch {
    return null; // server not running
  }
  if (response.status === 404) return null;
  if (!response.ok) return null;
  return response.json();
}

function startPolling(jobId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    const job = await fetchJobStatus(jobId);
    if (!job) {
      stopPolling();
      renderJobPanel(null, loadJobMeta()?.groupTitles ?? []);
      return;
    }
    renderJobPanel(job, loadJobMeta()?.groupTitles ?? []);
    if (job.status === "done" || job.status === "failed") {
      stopPolling();
    }
  }, 2000);
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(startedAt, finishedAt) {
  const ms = (finishedAt ?? Date.now()) - startedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes} мин ${seconds} с` : `${seconds} с`;
}

function renderJobPanel(job, groupTitles) {
  analysisJobPanel.hidden = false;
  for (const button of scoringButtons) button.hidden = true;

  if (!job) {
    analysisJobLabel.textContent = "Задание на анализ";
    analysisJobTime.textContent = "";
    analysisJobStatus.textContent =
      "Сервер недоступен. Запустите npm run local-server для просмотра результатов.";
    analysisJobKill.disabled = true;
    analysisJobNew.disabled = false;
    analysisJobResults.hidden = true;
    analysisJobErrors.hidden = true;
    return;
  }

  const hasResults = Array.isArray(job.results) && job.results.length > 0;

  if (job.status === "running") {
    analysisJobLabel.textContent = "Анализ выполняется";
    analysisJobTime.textContent = `Начат: ${formatTime(job.startedAt)} · ${formatDuration(job.startedAt)}`;
    analysisJobStatus.textContent = `${job.current} из ${job.total} групп готово…`;
    analysisJobKill.disabled = false;
    analysisJobNew.disabled = true;
    analysisJobResults.hidden = !hasResults;
  } else if (job.status === "done") {
    const duration = formatDuration(job.startedAt, job.finishedAt);
    analysisJobLabel.textContent = "Анализ завершён";
    analysisJobTime.textContent = `${formatTime(job.startedAt)} → ${formatTime(job.finishedAt)} · ${duration}`;
    const errCount = job.results.filter((r) => r.error).length;
    analysisJobStatus.textContent = errCount > 0
      ? `${job.total} групп(ы), ${errCount} с ошибкой. Проверьте результаты.`
      : `${job.total} групп(ы) — всё готово.`;
    analysisJobKill.disabled = true;
    analysisJobNew.disabled = false;
    analysisJobResults.hidden = !hasResults;
  } else if (job.status === "cancelled") {
    const duration = formatDuration(job.startedAt, job.finishedAt);
    analysisJobLabel.textContent = "Анализ остановлен";
    analysisJobTime.textContent = `${formatTime(job.startedAt)} → ${formatTime(job.finishedAt)} · ${duration}`;
    analysisJobStatus.textContent = `Остановлено на ${job.current} из ${job.total} групп.`;
    analysisJobKill.disabled = true;
    analysisJobNew.disabled = false;
    analysisJobResults.hidden = !hasResults;
  } else if (job.status === "failed") {
    analysisJobLabel.textContent = "Анализ завершился с ошибкой";
    analysisJobTime.textContent = formatTime(job.startedAt);
    analysisJobStatus.textContent = job.error ?? "Неизвестная ошибка.";
    analysisJobKill.disabled = true;
    analysisJobNew.disabled = false;
    analysisJobResults.hidden = !hasResults;
  }

  // Store latest results for copy/sheet buttons
  if (hasResults) {
    analysisJobCopy.dataset.results = JSON.stringify(job.results);
    analysisJobSheet.dataset.results = JSON.stringify(job.results);
  }

  // Render per-group errors
  renderJobErrors(job.results);
}

function renderJobErrors(results) {
  if (!Array.isArray(results)) {
    analysisJobErrors.hidden = true;
    return;
  }
  const errored = results.filter((r) => r.error);
  if (errored.length === 0) {
    analysisJobErrors.hidden = true;
    analysisJobErrors.replaceChildren();
    return;
  }
  analysisJobErrors.replaceChildren(
    ...errored.map(({ group, error }) => {
      const item = document.createElement("li");
      item.className = "analysis-job-error-item";

      const groupEl = document.createElement("div");
      groupEl.className = "analysis-job-error-group";
      groupEl.textContent = group?.title ?? "Неизвестная группа";

      const msgEl = document.createElement("div");
      msgEl.className = "analysis-job-error-message";
      msgEl.textContent =
        typeof error === "string" ? error : "Неизвестная ошибка.";

      item.append(groupEl, msgEl);
      return item;
    })
  );
  analysisJobErrors.hidden = false;
}

analysisJobKill.addEventListener("click", async () => {
  const meta = loadJobMeta();
  if (!meta) return;
  analysisJobKill.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGES.CANCEL_GROUP_ANALYSIS,
      payload: { jobId: meta.jobId },
    });
    if (!result?.ok) throw new Error(result?.error ?? "Не удалось остановить задание.");
    stopPolling();
    const job = await fetchJobStatus(meta.jobId);
    renderJobPanel(job, meta.groupTitles ?? []);
    showStatus("Задание остановлено.", false, true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Непредвиденная ошибка.", true);
    analysisJobKill.disabled = false;
  }
});

analysisJobNew.addEventListener("click", () => {
  stopPolling();
  clearJobMeta();
  analysisJobPanel.hidden = true;
  for (const button of scoringButtons) button.hidden = false;
  showStatus("");
});

function showJobPanelForScoring() {
  const meta = loadJobMeta();
  if (!meta) return;
  // Check if server has the job
  fetchJobStatus(meta.jobId).then((job) => {
    if (!job) return; // no active job on server, ignore
    renderJobPanel(job, meta.groupTitles ?? []);
    if (job.status === "running") startPolling(meta.jobId);
  });
}

analysisJobCopy.addEventListener("click", async () => {
  try {
    const results = JSON.parse(analysisJobCopy.dataset.results ?? "[]");
    const tsv = buildGroupAnalyticsTSV(results);
    await navigator.clipboard.writeText(tsv);
    showStatus("Результаты скопированы. Вставьте в таблицу (Cmd+V / Ctrl+V).", false, true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Не удалось скопировать.", true);
  }
});

analysisJobSheet.addEventListener("click", async () => {
  try {
    const results = JSON.parse(analysisJobSheet.dataset.results ?? "[]");
    const tsv = buildGroupAnalyticsTSV(results);
    await navigator.clipboard.writeText(tsv);
    const sheetResult = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGES.OPEN_GOOGLE_SHEET,
    });
    if (!sheetResult?.ok) throw new Error(sheetResult?.error ?? "Не удалось открыть таблицу.");
    showStatus("Данные скопированы. Вставьте в таблицу (Cmd+V / Ctrl+V).", false, true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Непредвиденная ошибка.", true);
  }
});

analyzeGroupButton.addEventListener("click", async () => {
  if (!scoringIds) return;

  setActionsDisabled(true);
  analyzeGroupButton.textContent = "Загружаем группы…";
  showStatus("Загружаем список групп…");

  try {
    allGroups = await fetchGroupsList();
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Не удалось загрузить список групп.",
      true
    );
    setActionsDisabled(false);
    analyzeGroupButton.textContent = "Анализ аудитории групп";
    return;
  }

  for (const button of actionButtons) button.hidden = true;
  groupPickerPanel.hidden = false;
  groupPickerFilter.value = "";
  renderGroupList(allGroups);
  groupPickerFilter.focus();
  showStatus("");
  analyzeGroupButton.textContent = "Анализ аудитории групп";
  setActionsDisabled(false);
});

groupPickerFilter.addEventListener("input", () => {
  renderGroupList(allGroups);
  debouncedAutoSelect();
});

const debouncedAutoSelect = debounce(() => {
  const lower = groupPickerFilter.value.toLowerCase().trim();
  for (const group of allGroups) {
    const checkbox = groupPickerList.querySelector(
      `input[data-group-id="${group.id}"]`
    );
    if (!checkbox) continue;
    checkbox.checked = lower
      ? group.title.toLowerCase().includes(lower)
      : false;
  }
  updatePickerRunButton();
}, 300);

groupPickerRun.addEventListener("click", async () => {
  const selected = allGroups.filter((g) =>
    groupPickerList.querySelector(`input[data-group-id="${g.id}"]`)?.checked
  );
  if (selected.length === 0) return;

  // Phase 1: fetch all students (popup must stay open — fast OTUS calls only)
  groupPickerRun.disabled = true;
  groupPickerRun.textContent = "Загружаем студентов…";
  showStatus(`Загружаем данные для ${selected.length} групп(ы)…`);

  let groups;
  try {
    groups = await Promise.all(
      selected.map(async (group) => {
        const students = await fetchGroupStudents(group.id);
        return {
          id: group.id,
          title: group.title,
          studentCount: students.length,
          prompt: buildGroupAnalyticsPrompt(students),
        };
      })
    );
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Не удалось загрузить данные студентов.",
      true
    );
    groupPickerRun.disabled = false;
    groupPickerRun.textContent = "Анализировать";
    return;
  }

  // Phase 2: hand off to server
  closeGroupPicker();
  showStatus("Передаём задание серверу…");

  const jobId = `analysis-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const result = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGES.START_GROUP_ANALYSIS,
    payload: { jobId, groups },
  });

  if (!result?.ok) {
    showStatus(result?.error ?? "Не удалось запустить анализ на сервере.", true);
    setActionsDisabled(false);
    return;
  }

  saveJobMeta(jobId, selected.map((g) => g.title));
  setActionsDisabled(false);

  // Show job panel and start polling
  const initialJob = await fetchJobStatus(jobId);
  renderJobPanel(initialJob, selected.map((g) => g.title));
  startPolling(jobId);
  showStatus("Анализ запущен. Можете закрыть окно — прогресс сохранится.");
});

function renderGroupList(groups) {
  groupPickerList.replaceChildren();

  if (groups.length === 0) {
    const empty = document.createElement("div");
    empty.className = "group-picker-empty";
    empty.textContent = "Нет доступных групп.";
    groupPickerList.append(empty);
    updatePickerRunButton();
    return;
  }

  for (const group of groups) {
    const item = document.createElement("div");
    item.className = "group-picker-item";
    item.setAttribute("role", "listitem");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `grp-${group.id}`;
    checkbox.dataset.groupId = String(group.id);
    checkbox.addEventListener("change", updatePickerRunButton);

    const label = document.createElement("label");
    label.htmlFor = `grp-${group.id}`;
    label.textContent = group.title;
    label.title = group.title;

    item.append(checkbox, label);
    groupPickerList.append(item);
  }

  updatePickerRunButton();
}

function updatePickerRunButton() {
  const checked = groupPickerList.querySelectorAll(
    'input[type="checkbox"]:checked'
  );
  const count = checked.length;
  groupPickerRun.disabled = count === 0;
  groupPickerRun.textContent =
    count > 0 ? `Анализировать (${count})` : "Анализировать";
}

function closeGroupPicker() {
  groupPickerPanel.hidden = true;
  groupPickerRun.textContent = "Анализировать";
  for (const button of scoringButtons) button.hidden = false;
}

function setActionsDisabled(disabled) {
  for (const button of actionButtons) button.disabled = disabled;
  saveHomeworkFolderButton.disabled = disabled;
  homeworkFolderInput.disabled = disabled;
}

function showStatus(
  message,
  isError = false,
  isSuccess = false,
  details = null
) {
  statusElement.replaceChildren(document.createTextNode(message));
  if (details && typeof details === "object") {
    const disclosure = document.createElement("details");
    disclosure.className = "status-details";
    const summary = document.createElement("summary");
    summary.textContent = "Показать детали";
    const content = document.createElement("pre");
    content.textContent = JSON.stringify(details, null, 2);
    disclosure.append(summary, content);
    statusElement.append(document.createElement("br"), disclosure);
  }
  statusElement.className = `status${isError ? " error" : isSuccess ? " success" : ""}`;
}
