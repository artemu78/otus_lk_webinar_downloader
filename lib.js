const LESSON_PATH_RE = /^\/teacher-lk\/programs\/(\d+)\/(\d+)(?:\/|$)/;
const HOMEWORK_PATH_RE = /^\/teacher-lk\/homework\/(\d+)\/(\d+)(?:\/|$)/;
const GROUP_RE = /^(.*)-(\d{4}-\d{2})$/;
const COURSE_DIRECTORY_NAMES = new Map([
  ["ai-dev-tools", "AI_Dev_Tools"],
  ["ai-agents", "AI_Agents"],
  ["dev-ai-agents", "DEV-AI-Agents"],
]);

const CYRILLIC_TO_LATIN = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E",
  Ж: "Zh", З: "Z", И: "I", Й: "I", К: "K", Л: "L", М: "M",
  Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U",
  Ф: "F", Х: "Kh", Ц: "Ts", Ч: "Ch", Ш: "Sh", Щ: "Shch",
  Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu", Я: "Ya",
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e",
  ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

export function parseLessonUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Адрес активной вкладки некорректен.");
  }

  if (url.protocol !== "https:" || url.hostname !== "otus.ru") {
    throw new Error("Сначала откройте страницу занятия в кабинете преподавателя OTUS.");
  }

  const match = url.pathname.match(LESSON_PATH_RE);
  if (!match) {
    throw new Error("Не удалось определить программу и занятие по этому адресу.");
  }

  return { programId: match[1], lessonId: match[2] };
}

export function parseHomeworkUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Адрес активной вкладки некорректен.");
  }

  if (url.protocol !== "https:" || url.hostname !== "otus.ru") {
    throw new Error("Сначала откройте домашнюю работу в кабинете преподавателя OTUS.");
  }

  const match = url.pathname.match(HOMEWORK_PATH_RE);
  if (!match) {
    throw new Error("Не удалось определить студента и домашнюю работу по этому адресу.");
  }

  return { studentId: match[1], homeworkId: match[2] };
}

export function findAssignedHomework(payload, { studentId, homeworkId }) {
  const items = payload?.data?.items;
  if (!Array.isArray(items)) {
    throw new Error("В списке назначенных работ отсутствует массив data.items.");
  }

  const item = items.find(
    (candidate) =>
      String(candidate?.user_id) === String(studentId) &&
      String(candidate?.homework_id) === String(homeworkId),
  );
  if (!item) {
    throw new Error("Эта работа не найдена в списке назначенных домашних работ.");
  }
  if (typeof item.group !== "string" || !item.group.trim()) {
    throw new Error("У найденной домашней работы не указана группа.");
  }

  return item;
}

export function findStudentSurname(payload, studentId) {
  const chat = payload?.data?.chat;
  if (!Array.isArray(chat)) {
    throw new Error("В ответе домашней работы отсутствует массив data.chat.");
  }

  const message = chat.find(
    (candidate) => String(candidate?.actor?.id) === String(studentId),
  );
  const surname = message?.actor?.lname;
  if (typeof surname !== "string" || !surname.trim()) {
    throw new Error("Не удалось найти фамилию студента в чате домашней работы.");
  }

  return surname.trim();
}

export function findStudentMessages(payload, studentId) {
  const chat = payload?.data?.chat;
  if (!Array.isArray(chat)) {
    throw new Error("В ответе домашней работы отсутствует массив data.chat.");
  }

  const messages = chat.filter(
    (candidate) => String(candidate?.actor?.id) === String(studentId),
  );
  if (messages.length === 0) {
    throw new Error("В чате домашней работы не найдены сообщения студента.");
  }
  return messages;
}

export function transliterateFolderPart(value) {
  const transliterated = [...String(value).normalize("NFC")]
    .map((character) => CYRILLIC_TO_LATIN[character] ?? character)
    .join("");
  const safe = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  if (!safe || safe === "." || safe === "..") {
    throw new Error("Не удалось преобразовать фамилию в безопасное имя папки.");
  }
  return safe;
}

export function splitGroupCode(group) {
  const match = String(group).trim().match(GROUP_RE);
  if (!match || !match[1]) {
    throw new Error("Группа должна оканчиваться кодом в формате YYYY-MM.");
  }
  return { courseCode: match[1], groupCode: match[2] };
}

export function courseCodeToDirectory(courseCode) {
  const knownName = COURSE_DIRECTORY_NAMES.get(courseCode.toLowerCase());
  if (knownName) return knownName;

  return courseCode
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("_");
}

export function buildHomeworkFolderPath(group, surname) {
  const { courseCode, groupCode } = splitGroupCode(group);
  const courseDirectory = courseCodeToDirectory(courseCode);
  const studentDirectory = transliterateFolderPart(surname);
  return `/Users/artemreva/projects/otus/${courseDirectory}/${groupCode}/${studentDirectory}`;
}

export function buildLessonApiUrl({ programId, lessonId }) {
  const pathProgramId = encodeURIComponent(programId);
  const pathLessonId = encodeURIComponent(lessonId);
  const url = new URL(
    `/api/teacher-lk/programs/${pathProgramId}/lesson/${pathLessonId}/`,
    "https://otus.ru",
  );
  url.searchParams.set("lessonId", lessonId);
  url.searchParams.set("programId", programId);
  return url.toString();
}

export function findWebinarDownloadUrl(payload) {
  const media = payload?.data?.lesson?.media;
  if (!Array.isArray(media)) {
    throw new Error("В ответе для занятия отсутствует список медиафайлов.");
  }

  const webinar = media.find(
    (item) => item?.type === "webinar" && item?.is_private === false,
  );
  const downloadUrl = webinar?.attrs?.download_url;

  if (typeof downloadUrl !== "string" || downloadUrl.length === 0) {
    throw new Error(
      "Для этого занятия не найдена доступная запись вебинара.",
    );
  }

  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    throw new Error("Адрес записи вебинара некорректен.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Адрес записи вебинара использует неподдерживаемый протокол.");
  }

  return parsed.toString();
}

export function sanitizeDownloadFilename(encodedName) {
  let decodedName;
  try {
    decodedName = decodeURIComponent(encodedName);
  } catch {
    decodedName = encodedName;
  }

  const safeName = decodedName
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F\u007F]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();

  return safeName || "webinar";
}

function getUserName(user) {
  return user.fullname || user.name || "Unknown";
}

function getAttendedIds(lesson) {
  return new Set([
    ...lesson.onlineUsers.map((user) => user.id),
    ...lesson.offlineUsers.map((user) => user.id),
  ]);
}

function quoteTsv(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

function toSheetFormula(names) {
  if (!names) return '""';
  const escaped = names.replace(/"/g, '""');
  return `"=SUBSTITUTE(""${escaped}"", "", "", CHAR(10))"`;
}

export function buildSummaryTableTSV({ lessonCache, masterStudents }) {
  const header = [
    "Lesson Title",
    "Online Count",
    "Online Names",
    "Offline Count",
    "Offline Names",
    "Did Not Come Count",
    "Did Not Come Names",
    "Poll Count",
    "Poll Names",
  ];

  const rows = lessonCache.map((lesson) => {
    const attendedIds = getAttendedIds(lesson);
    const absentNames = [...masterStudents.entries()]
      .filter(([id]) => !attendedIds.has(id))
      .map(([, name]) => name);
    const pollUsers = new Map();

    for (const poll of lesson.polls) {
      for (const stat of poll.stats || []) {
        for (const answer of stat.answers || []) {
          for (const user of answer.users || []) {
            if (user?.id && !pollUsers.has(user.id)) {
              pollUsers.set(user.id, getUserName(user));
            }
          }
        }
      }
    }

    const onlineNames = lesson.onlineUsers.map(getUserName).join(", ");
    const offlineNames = lesson.offlineUsers.map(getUserName).join(", ");
    const offlineCount = lesson.offlineUsers.length || lesson.rawOfflineCounter;

    return [
      quoteTsv(lesson.title),
      lesson.onlineUsers.length,
      toSheetFormula(onlineNames),
      offlineCount,
      toSheetFormula(offlineNames),
      absentNames.length,
      toSheetFormula(absentNames.join(", ")),
      pollUsers.size,
      toSheetFormula([...pollUsers.values()].join(", ")),
    ].join("\t");
  });

  return [header.join("\t"), ...rows].join("\n");
}

export function buildAttendanceTableTSV({ lessonCache, masterStudents }) {
  const header = [
    "Student Name",
    ...lessonCache.map((lesson, index) =>
      quoteTsv(`L${index + 1}: ${lesson.title || ""}`),
    ),
  ];

  const rows = [...masterStudents.entries()].map(([studentId, studentName]) => {
    const attendance = lessonCache.map((lesson) =>
      getAttendedIds(lesson).has(studentId) ? '"🟢"' : '"🔴"',
    );
    return [quoteTsv(studentName), ...attendance].join("\t");
  });

  return [header.join("\t"), ...rows].join("\n");
}

export async function collectWebinarData(
  programId,
  fetchImpl = fetch,
  onProgress = () => {},
) {
  if (!programId) {
    throw new Error("Не указан идентификатор программы.");
  }

  const requestOptions = {
    credentials: "include",
    headers: { Accept: "application/json" },
  };
  onProgress("1/3 Получаем данные программы… Не закрывайте окно");
  const courseData = await fetchImpl(
    `https://otus.ru/api/teacher-lk/programs/${programId}/get/?id=${programId}`,
    requestOptions,
  ).then((response) => response.json());
  const lessons = courseData.data.modules.flatMap(
    (module) => module.lessons || [],
  );

  const lessonCache = [];

  for (const [index, lesson] of lessons.entries()) {
    onProgress(
      `2/3 Получаем данные занятий… (${index + 1}/${lessons.length}). Не закрывайте окно`,
    );
    const lessonData = await fetchImpl(
      `https://otus.ru/api/teacher-lk/programs/${programId}/lesson/${lesson.id}/?lessonId=${lesson.id}&programId=${programId}`,
      requestOptions,
    ).then((response) => response.json());
    lessonCache.push({
      id: lesson.id,
      title: lesson.title,
      scheduleId: lessonData.data?.schedules?.[0]?.id,
      polls: lessonData.data?.polls || [],
    });
  }

  const masterStudents = new Map();

  for (const [index, lesson] of lessonCache.entries()) {
    onProgress(
      `3/3 Получаем данные посещаемости… (${index + 1}/${lessonCache.length}). Не закрывайте окно`,
    );

    let onlineUsers = [];
    let offlineUsers = [];
    let rawOfflineCounter = 0;

    if (lesson.scheduleId) {
      const visitorsData = await fetchImpl(
        `https://otus.ru/api/teacher-lk/schedules/${lesson.scheduleId}/visitors/?id=${lesson.scheduleId}`,
        requestOptions,
      ).then((response) => response.json());
      const visitorData = visitorsData.data || {};

      onlineUsers = visitorData.online || [];
      offlineUsers =
        visitorData.offline ||
        visitorData.record?.users ||
        visitorData.recorded ||
        [];
      rawOfflineCounter = visitorData.record?.counter || 0;

      [...onlineUsers, ...offlineUsers].forEach((user) => {
        if (user?.id) {
          masterStudents.set(user.id, getUserName(user));
        }
      });
    }

    Object.assign(lesson, {
      onlineUsers,
      offlineUsers,
      rawOfflineCounter,
    });
  }

  return { lessonCache, masterStudents };
}

export async function generateSummaryTableTSV(
  programId,
  fetchImpl = fetch,
  onProgress,
) {
  return buildSummaryTableTSV(
    await collectWebinarData(programId, fetchImpl, onProgress),
  );
}

export async function generateAttendanceTableTSV(
  programId,
  fetchImpl = fetch,
  onProgress,
) {
  return buildAttendanceTableTSV(
    await collectWebinarData(programId, fetchImpl, onProgress),
  );
}

export async function generateWebinarTables(programId, fetchImpl = fetch) {
  const webinarData = await collectWebinarData(programId, fetchImpl);
  return {
    table1TSV: buildSummaryTableTSV(webinarData),
    table2TSV: buildAttendanceTableTSV(webinarData),
  };
}

export async function extractWebinarData() {
  const programId = window.location.href.split("/")[5];
  if (!programId) {
    console.error("Program ID not found in URL.");
    return;
  }

  console.log(
    `Fetching data for program: ${programId}. This might take a minute...`,
  );

  try {
    const { table1TSV, table2TSV } = await generateWebinarTables(programId);

    // --- FINAL OUTPUT ---
    console.log("\n\n=== COPY THE TEXT BELOW INTO GOOGLE SHEETS ===");
    console.log("--- TABLE 1: SUMMARY ---");
    console.log(table1TSV);
    console.log("\n\n--- TABLE 2: ATTENDANCE MATRIX ---");
    console.log(table2TSV);
  } catch (error) {
    console.error("Failed to fetch or parse data:", error);
  }
}
