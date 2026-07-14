const LESSON_PATH_RE = /^\/teacher-lk\/programs\/(\d+)\/(\d+)(?:\/|$)/;

export function parseLessonUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The active tab URL is invalid.");
  }

  if (url.protocol !== "https:" || url.hostname !== "otus.ru") {
    throw new Error("Open an OTUS teacher lesson page first.");
  }

  const match = url.pathname.match(LESSON_PATH_RE);
  if (!match) {
    throw new Error("Could not extract program and lesson IDs from this URL.");
  }

  return { programId: match[1], lessonId: match[2] };
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
    throw new Error("Lesson response does not contain a media array.");
  }

  const webinar = media.find(
    (item) => item?.type === "webinar" && item?.is_private === false,
  );
  const downloadUrl = webinar?.attrs?.download_url;

  if (typeof downloadUrl !== "string" || downloadUrl.length === 0) {
    throw new Error("No public webinar download URL was found for this lesson.");
  }

  let parsed;
  try {
    parsed = new URL(downloadUrl);
  } catch {
    throw new Error("The webinar download URL is invalid.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("The webinar download URL uses an unsupported protocol.");
  }

  return parsed.toString();
}
