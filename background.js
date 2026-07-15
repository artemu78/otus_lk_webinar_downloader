import {
  buildLessonApiUrl,
  findWebinarDownloadUrl,
  sanitizeDownloadFilename,
  findStudentSurname,
  findStudentMessages,
} from "./lib.js";

const LOCAL_COMMAND_URL = "http://127.0.0.1:8765/commands";

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadItem.byExtensionId !== chrome.runtime.id) return;

  suggest({
    filename: sanitizeDownloadFilename(downloadItem.filename),
    conflictAction: "uniquify",
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DOWNLOAD_HOMEWORK_MATERIALS") {
    downloadHomeworkMaterials(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Downloading homework materials failed", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Непредвиденная ошибка.",
        });
      });

    return true;
  }

  if (message?.type === "OPEN_HOMEWORK_FOLDER") {
    openHomeworkFolder(message.payload)
      .then((path) => sendResponse({ ok: true, path }))
      .catch((error) => {
        console.error("Opening homework folder failed", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Непредвиденная ошибка.",
        });
      });

    return true;
  }

  if (message?.type === "OPEN_GOOGLE_SHEET") {
    openGoogleSheet()
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((error) => {
        console.error("Opening Google Sheets failed", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Непредвиденная ошибка.",
        });
      });

    return true;
  }

  if (message?.type === "GOOGLE_SHEET_READY") {
    shouldShowSheetInstruction(_sender.tab?.id)
      .then((showInstruction) => sendResponse({ showInstruction }))
      .catch(() => sendResponse({ showInstruction: false }));

    return true;
  }

  if (message?.type !== "DOWNLOAD_WEBINAR") return false;

  downloadWebinar(message.payload)
    .then((downloadId) => sendResponse({ ok: true, downloadId }))
    .catch((error) => {
      console.error("OTUS webinar download failed", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Непредвиденная ошибка.",
      });
    });

  return true;
});

async function fetchOtusJson(url, description) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`[fetchOtusJson]: ${description} (${response.status}).`);
  }
  return response.json();
}

async function openHomeworkFolder(ids) {
  const context = await getHomeworkContext(ids);
  const result = await sendLocalCommand({ command: "open_folder", ...context.folder });
  return result.path;
}

async function downloadHomeworkMaterials(ids) {
  const { folder, messagePayload } = await getHomeworkContext(ids);
  const messages = findStudentMessages(messagePayload, ids.studentId);
  const result = await sendLocalCommand({
    command: "clone_student_materials",
    ...folder,
    messages,
  });
  return { path: result.path, repository: result.repository };
}

async function getHomeworkContext(ids) {
  const messagePayload = await fetchOtusJson(
    `https://otus.ru/api/teacher-lk/homework/msg/${encodeURIComponent(ids.studentId)}/${encodeURIComponent(ids.homeworkId)}/`,
    "Не удалось получить чат домашней работы",
  );
  const surname = findStudentSurname(messagePayload, ids.studentId);

  const homeworkUrl = `https://otus.ru/api/teacher-lk/homework/put/${encodeURIComponent(ids.studentId)}/${encodeURIComponent(ids.homeworkId)}/?`;
  const homeworkData = await fetchOtusJson(
    homeworkUrl,
    "Не удалось получить данные домашней работы url=" + homeworkUrl,
  );
  const groupId = homeworkData?.data?.homework?.group_id;

  const groupUrl = `https://otus.ru/api/teacher-lk/homework/journal/${groupId}/?groupId=${groupId}`;
  const groupData = await fetchOtusJson(
    groupUrl,
    "Не удалось получить данные группы",
  );
  // groupData.data.group.title contains group code like "AI_Dev_Tools_2025-10"
  const groupCode = groupData?.data?.group?.title;
  const homeworkNumber = groupData.data.homeworks.findIndex((item) => {return item.id==ids.homeworkId});

  if (homeworkNumber === -1) {
    throw new Error(`Домашняя работа id=${ids.homeworkId} не найдена в url=${groupUrl}`);
  }

  return {
    folder: { groupCode, surname, homeworkNumber: homeworkNumber + 1 },
    messagePayload,
  };
}

async function sendLocalCommand(command) {
  let response;
  try {
    response = await fetch(LOCAL_COMMAND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch {
    throw new Error(
      "Локальный сервер недоступен. Запустите его командой npm run local-server.",
    );
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    throw new Error(result?.error ?? `Локальный сервер вернул ошибку ${response.status}.`);
  }
  return result;
}

async function openGoogleSheet() {
  const tab = await chrome.tabs.create({ url: "https://sheets.new" });
  if (typeof tab.id !== "number") {
    throw new Error("Не удалось открыть новую Google Таблицу.");
  }

  await chrome.storage.session.set({ pendingGoogleSheetTabId: tab.id });
  return tab.id;
}

async function shouldShowSheetInstruction(tabId) {
  if (typeof tabId !== "number") return false;

  const { pendingGoogleSheetTabId } = await chrome.storage.session.get(
    "pendingGoogleSheetTabId",
  );
  if (pendingGoogleSheetTabId !== tabId) return false;

  await chrome.storage.session.remove("pendingGoogleSheetTabId");
  return true;
}

async function downloadWebinar(ids) {
  const apiUrl = buildLessonApiUrl(ids);
  const response = await fetch(apiUrl, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("OTUS отклонил запрос. Войдите в аккаунт и попробуйте снова.");
    }
    throw new Error(`Не удалось получить данные занятия (${response.status}).`);
  }

  const payload = await response.json();
  const downloadUrl = findWebinarDownloadUrl(payload);
  return chrome.downloads.download({
    url: downloadUrl,
    saveAs: true,
  });
}
