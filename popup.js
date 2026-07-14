import { parseLessonUrl } from "./lib.js";

const lessonElement = document.querySelector("#lesson");
const downloadButton = document.querySelector("#download");
const statusElement = document.querySelector("#status");
let lessonIds;

initialize();

async function initialize() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    lessonIds = parseLessonUrl(tab?.url ?? "");
    lessonElement.textContent = `Program ${lessonIds.programId} · Lesson ${lessonIds.lessonId}`;
    downloadButton.disabled = false;
  } catch (error) {
    lessonElement.textContent = "No OTUS lesson detected";
    showStatus(error instanceof Error ? error.message : "Unexpected error.", true);
  }
}

downloadButton.addEventListener("click", async () => {
  if (!lessonIds) return;

  downloadButton.disabled = true;
  downloadButton.textContent = "Starting…";
  showStatus("Fetching lesson data…");

  try {
    const result = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_WEBINAR",
      payload: lessonIds,
    });
    if (!result?.ok) throw new Error(result?.error ?? "Download failed.");
    showStatus("Download started.", false, true);
  } catch (error) {
    showStatus(error instanceof Error ? error.message : "Unexpected error.", true);
  } finally {
    downloadButton.disabled = false;
    downloadButton.textContent = "Download webinar";
  }
});

function showStatus(message, isError = false, isSuccess = false) {
  statusElement.textContent = message;
  statusElement.className = `status${isError ? " error" : isSuccess ? " success" : ""}`;
}
