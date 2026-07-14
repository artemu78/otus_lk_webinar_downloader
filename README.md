# OTUS Webinar Downloader

Dependency-free Chrome Manifest V3 extension. On an OTUS teacher lesson page it:

1. Extracts the program and lesson IDs from the active tab URL.
2. Fetches the authenticated lesson API response.
3. Selects the first media item with `type === "webinar"` and `is_private === false`.
4. Starts the recording download through Chrome's Downloads API.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this directory.
4. Open a URL shaped like `https://otus.ru/teacher-lk/programs/3616/127815/...` while signed in.
5. Click the extension icon, then **Download webinar**.

## Test

```sh
npm test
```

The extension requests access only to the active tab, Chrome downloads, and `https://otus.ru/*`.
