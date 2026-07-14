# OTUS Webinar Downloader

Dependency-free Chrome Manifest V3 extension. On an OTUS teacher lesson page it:

1. Extracts the program and lesson IDs from the active tab URL.
2. Fetches the authenticated lesson API response.
3. Selects the first media item with `type === "webinar"` and `is_private === false`.
4. Starts the recording download through Chrome's Downloads API.
5. Generates either attendance report, copies it as TSV, and opens a new Google
   spreadsheet with a short paste instruction.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this directory.
4. Open a URL shaped like `https://otus.ru/teacher-lk/programs/3616/127815/...` while signed in.
5. Click the extension icon and choose the required action.

For either attendance report, wait while the extension collects the program data.
It will copy the completed table and open a blank Google spreadsheet. Paste into
the selected `A1` cell with **Cmd+V** on macOS or **Ctrl+V** on Windows/Linux.

## Test

```sh
npm test
```

The extension requests access to the active tab, clipboard writing, Chrome
downloads, session storage, `https://otus.ru/*`, and Google Spreadsheets pages.
The Google Spreadsheets content script only displays the paste instruction in a
new sheet opened by the extension.
