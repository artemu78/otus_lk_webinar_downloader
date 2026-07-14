# Project instructions

- After implementing any feature, bump the extension version in `manifest.json` as part of the same change.
- Use a patch version bump by default unless the user requests a specific version or the change requires a minor or major SemVer bump.

## Project purpose

This is a dependency-free Google Chrome extension (Manifest V3) for OTUS
employees. It helps them work in the OTUS teacher portal: navigate webinar
records, download recordings, build attendance reports, and open the local
folder associated with a student's homework.

The browser extension cannot access arbitrary local files or execute operating
system commands directly. A separate local Node.js web server receives a small,
allowlisted command set from the extension and executes those commands locally.
At present it supports creating and opening a student's homework folder in
Finder.

## High-level architecture

1. `popup.html`, `popup.css`, and `popup.js` provide the extension UI. The popup
   inspects the active OTUS URL and switches between lesson actions and the
   homework-folder action. It also generates attendance TSV in the browser and
   copies it to the clipboard.
2. `background.js` is the Manifest V3 service worker and privileged coordinator.
   It receives messages from the popup/content script, calls authenticated OTUS
   APIs with the user's current browser session, starts Chrome downloads, opens
   Google Sheets, and forwards local commands to the localhost server.
3. `lib.js` contains pure/shared domain logic: OTUS URL parsing, API URL
   construction, webinar selection, attendance collection and TSV generation,
   student/group lookup, transliteration, and homework-folder path construction.
4. `sheets-instruction.js` is a content script for Google Sheets. It shows the
   paste instruction only for the new sheet opened by the extension; the service
   worker correlates that tab using `chrome.storage.session`.
5. `local-server/server.js` is the dependency-free local command bridge. It
   listens on `127.0.0.1:8765`; `POST /commands` accepts the allowlisted
   `open_folder` command, creates the directory if needed, validates that the
   requested and resolved paths remain under the configured OTUS projects root,
   and invokes `/usr/bin/open` without a shell. `GET /health` is available for
   diagnostics.
6. `manifest.json` declares the popup, background worker, Google Sheets content
   script, Chrome permissions, and host access to OTUS and the localhost server.

Main request flow:

`OTUS page -> popup.js -> chrome.runtime message -> background.js -> OTUS API / Chrome API / local-server -> result shown in popup`

Attendance reports are the exception: `popup.js` calls the data collectors in
`lib.js` directly, writes the resulting TSV to the clipboard, then asks the
service worker to open `sheets.new`.

## Security and operational boundaries

- OTUS API requests rely on the current authenticated Chrome session; no OTUS
  credentials are stored by this project.
- Keep OS command execution in the local server, never in extension code. New
  commands must be explicitly allowlisted and must not interpolate input into a
  shell command.
- Keep the server bound to loopback and preserve its Chrome-extension origin
  check, request-size limit, absolute-path validation, realpath/symlink checks,
  and allowed-root restriction.
- The default local root is `/Users/artemreva/projects/otus`; it can be changed
  with `OTUS_PROJECTS_ROOT`. Host and port can be changed with
  `OTUS_COMMAND_HOST` and `OTUS_COMMAND_PORT`.

## Development map

- Run tests: `npm test`
- Start the local command server: `npm run local-server`
- Tests use Node's built-in test runner and live under `test/`.
- There is no build step or third-party runtime dependency; load the repository
  directory as an unpacked extension in `chrome://extensions`.
- When changing URL formats, API payload handling, table generation, path
  construction, or server commands, update the corresponding tests in `test/`.
- When adding extension capabilities, keep `manifest.json` permissions and host
  permissions as narrow as possible.
