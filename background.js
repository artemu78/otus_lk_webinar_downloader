import {
  buildLessonApiUrl,
  findWebinarDownloadUrl,
  sanitizeDownloadFilename,
  findStudentSurname,
  findStudentMessages,
  findStudentStaticFiles,
} from "./lib.js";
import {
  EXTENSION_MESSAGES,
  GOOGLE_SHEET_URL,
  LOCAL_COMMANDS,
  LOCAL_SERVER,
  SESSION_STORAGE_KEYS,
} from "./constants.js";

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (downloadItem.byExtensionId !== chrome.runtime.id) return;

  suggest({
    filename: sanitizeDownloadFilename(downloadItem.filename),
    conflictAction: "uniquify",
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === EXTENSION_MESSAGES.DOWNLOAD_HOMEWORK_MATERIALS) {
    downloadHomeworkMaterials(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => {
        console.error("Downloading homework materials failed", error);
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Непредвиденная ошибка.",
          ...(error?.details ? { details: error.details } : {}),
        });
      });

    return true;
  }

  if (message?.type === EXTENSION_MESSAGES.OPEN_HOMEWORK_FOLDER) {
    openHomeworkFolder(message.payload)
      .then((path) => sendResponse({ ok: true, path }))
      .catch((error) => {
        console.error("Opening homework folder failed", error);
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Непредвиденная ошибка.",
        });
      });

    return true;
  }

  if (message?.type === EXTENSION_MESSAGES.OPEN_HOMEWORK_WARP) {
    runHomeworkPathCommand(message.payload, LOCAL_COMMANDS.OPEN_WARP)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendHomeworkError("Opening Warp failed", error, sendResponse)
      );
    return true;
  }

  if (message?.type === EXTENSION_MESSAGES.READ_HOMEWORK_RESULTS) {
    runHomeworkPathCommand(message.payload, LOCAL_COMMANDS.READ_LATEST_ANALYSIS)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) =>
        sendHomeworkError(
          "Reading homework results failed",
          error,
          sendResponse
        )
      );
    return true;
  }

  if (message?.type === EXTENSION_MESSAGES.OPEN_GOOGLE_SHEET) {
    openGoogleSheet()
      .then((tabId) => sendResponse({ ok: true, tabId }))
      .catch((error) => {
        console.error("Opening Google Sheets failed", error);
        sendResponse({
          ok: false,
          error:
            error instanceof Error ? error.message : "Непредвиденная ошибка.",
        });
      });

    return true;
  }

  if (message?.type === EXTENSION_MESSAGES.GOOGLE_SHEET_READY) {
    shouldShowSheetInstruction(_sender.tab?.id)
      .then((showInstruction) => sendResponse({ showInstruction }))
      .catch(() => sendResponse({ showInstruction: false }));

    return true;
  }

  if (message?.type !== EXTENSION_MESSAGES.DOWNLOAD_WEBINAR) return false;

  downloadWebinar(message.payload)
    .then((downloadId) => sendResponse({ ok: true, downloadId }))
    .catch((error) => {
      console.error("OTUS webinar download failed", error);
      sendResponse({
        ok: false,
        error:
          error instanceof Error ? error.message : "Непредвиденная ошибка.",
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
  const folder = await getHomeworkFolder(ids);
  const result = await sendLocalCommand({
    command: LOCAL_COMMANDS.OPEN_FOLDER,
    ...folder,
  });
  return result.path;
}

async function downloadHomeworkMaterials(ids) {
  const messagePayload = await getHomeworkMessages(ids);
  const context =
    typeof ids?.cachedPath === "string" && ids.cachedPath
      ? {
          staticFiles: findStudentStaticFiles(messagePayload, ids.studentId),
        }
      : await getHomeworkContext(ids, messagePayload);
  const folder =
    typeof ids?.cachedPath === "string" && ids.cachedPath
      ? { path: ids.cachedPath }
      : context.folder;
  const messages = findStudentMessages(messagePayload, ids.studentId);
  let result;
  try {
    result = await sendLocalCommand({
      command: LOCAL_COMMANDS.CLONE_STUDENT_MATERIALS,
      ...folder,
      messages,
    });
  } catch (error) {
    if (context.staticFiles.length > 0) {
      const saved = await saveHomeworkStaticFiles(folder, context.staticFiles);
      return {
        path: saved.path,
        staticFileCount: saved.savedCount,
        skippedStaticFiles: saved.skippedCount,
      };
    }
    throw error;
  }
  if (result.zipUrl) {
    const archiveResponse = await fetch(result.zipUrl, {
      credentials: "include",
    });
    if (!archiveResponse.ok) {
      throw new Error(
        `Не удалось скачать ZIP-архив (${archiveResponse.status}).`
      );
    }
    const archive = await archiveResponse.arrayBuffer();
    const extraction = await sendZipToLocalServer(result.path, archive);
    const saved = await saveHomeworkStaticFiles(
      { path: result.path },
      context.staticFiles
    );
    return {
      path: result.path,
      skippedExisting: extraction.skippedExisting,
      staticFileCount: saved.savedCount,
      skippedStaticFiles: saved.skippedCount,
    };
  }
  const saved = await saveHomeworkStaticFiles(
    { path: result.path },
    context.staticFiles
  );
  return {
    path: result.path,
    repository: result.repository,
    staticFileCount: saved.savedCount,
    skippedStaticFiles: saved.skippedCount,
  };
}

async function runHomeworkPathCommand(ids, command) {
  const folder = await getHomeworkFolder(ids);
  return sendLocalCommand({ command, ...folder });
}

function sendHomeworkError(prefix, error, sendResponse) {
  console.error(prefix, error);
  sendResponse({
    ok: false,
    error: error instanceof Error ? error.message : "Непредвиденная ошибка.",
    ...(error?.details ? { details: error.details } : {}),
  });
}

async function getHomeworkFolder(ids, existingMessagePayload) {
  if (typeof ids?.cachedPath === "string" && ids.cachedPath) {
    return { path: ids.cachedPath };
  }
  return (await getHomeworkContext(ids, existingMessagePayload)).folder;
}

async function getHomeworkMessages(ids) {
  return fetchOtusJson(
    `https://otus.ru/api/teacher-lk/homework/msg/${encodeURIComponent(ids.studentId)}/${encodeURIComponent(ids.homeworkId)}/`,
    "Не удалось получить чат домашней работы"
  );
}

async function getHomeworkContext(ids, existingMessagePayload) {
  const messagePayload =
    existingMessagePayload ?? (await getHomeworkMessages(ids));
  const surname = findStudentSurname(messagePayload, ids.studentId);
  const staticFiles = findStudentStaticFiles(messagePayload, ids.studentId);

  const homeworkUrl = `https://otus.ru/api/teacher-lk/homework/put/${encodeURIComponent(ids.studentId)}/${encodeURIComponent(ids.homeworkId)}/?`;
  const homeworkData = await fetchOtusJson(
    homeworkUrl,
    "Не удалось получить данные домашней работы url=" + homeworkUrl
  );
  const groupId = homeworkData?.data?.homework?.group_id;

  const groupUrl = `https://otus.ru/api/teacher-lk/homework/journal/${groupId}/?groupId=${groupId}`;
  const groupData = await fetchOtusJson(
    groupUrl,
    "Не удалось получить данные группы"
  );
  // groupData.data.group.title contains group code like "AI_Dev_Tools_2025-10"
  const groupCode = groupData?.data?.group?.title;
  const homeworkNumber = groupData.data.homeworks.findIndex((item) => {
    return item.id == ids.homeworkId;
  });

  if (homeworkNumber === -1) {
    throw new Error(
      `Домашняя работа id=${ids.homeworkId} не найдена в url=${groupUrl}`
    );
  }

  return {
    folder: { groupCode, surname, homeworkNumber: homeworkNumber + 1 },
    messagePayload,
    staticFiles,
  };
}

async function saveHomeworkStaticFiles(folder, files) {
  const saved = [];
  for (const { url, filename } of files) {
    const download = await fetch(url, { credentials: "include" });
    if (!download.ok) {
      throw new Error(`Не удалось скачать файл ${filename} (${download.status}).`);
    }
    const response = await fetch(LOCAL_SERVER.STATIC_FILE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-OTUS-Student-Path": folder.path ?? "",
        "X-OTUS-Student-Folder": encodeURIComponent(JSON.stringify(folder)),
        "X-OTUS-File-Name": encodeURIComponent(sanitizeDownloadFilename(filename)),
      },
      body: await download.arrayBuffer(),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error ?? `Не удалось сохранить файл ${filename}.`);
    }
    saved.push(result);
  }
  return {
    path: saved[0]?.path ?? folder.path,
    savedCount: saved.filter((item) => !item.skippedExisting).length,
    skippedCount: saved.filter((item) => item.skippedExisting).length,
  };
}

async function sendLocalCommand(command) {
  let response;
  try {
    response = await fetch(LOCAL_SERVER.COMMANDS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
  } catch {
    throw new Error(
      "Локальный сервер недоступен. Запустите его командой npm run local-server."
    );
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    const error = new Error(
      result?.error ?? `Локальный сервер вернул ошибку ${response.status}.`
    );
    error.details = result?.details;
    throw error;
  }
  return result;
}

async function sendZipToLocalServer(folderPath, archive) {
  let response;
  try {
    response = await fetch(LOCAL_SERVER.ZIP_EXTRACTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "X-OTUS-Student-Path": folderPath,
      },
      body: archive,
    });
  } catch {
    throw new Error(
      "Локальный сервер недоступен. Запустите его командой npm run local-server."
    );
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result?.ok !== true) {
    throw new Error(
      result?.error ?? `Локальный сервер вернул ошибку ${response.status}.`
    );
  }
  return result;
}

async function openGoogleSheet() {
  const tab = await chrome.tabs.create({ url: GOOGLE_SHEET_URL });
  if (typeof tab.id !== "number") {
    throw new Error("Не удалось открыть новую Google Таблицу.");
  }

  await chrome.storage.session.set({
    [SESSION_STORAGE_KEYS.PENDING_GOOGLE_SHEET_TAB_ID]: tab.id,
  });
  return tab.id;
}

async function shouldShowSheetInstruction(tabId) {
  if (typeof tabId !== "number") return false;

  const key = SESSION_STORAGE_KEYS.PENDING_GOOGLE_SHEET_TAB_ID;
  const pendingGoogleSheetTabId = (await chrome.storage.session.get(key))[key];
  if (pendingGoogleSheetTabId !== tabId) return false;

  await chrome.storage.session.remove(key);
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
      throw new Error(
        "OTUS отклонил запрос. Войдите в аккаунт и попробуйте снова."
      );
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
