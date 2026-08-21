# Local command server

The extension sends local OS commands to this dependency-free Node.js server.
It listens only on `127.0.0.1` and accepts folders located below the matching
OTUS or Hexlet root configured in `.env`.

Start it from the repository root:

```sh
cp .env.example .env
# Edit .env and replace OPENROUTER_API_KEY with your key.
npm run local-server
```

The `.env` file is required. The server exits with setup instructions when it
is absent or when an OpenRouter setting is empty. `.env` is ignored by Git;
`.env.example` documents the required values.

Supported endpoints:

- `GET /health` — server health check.
- `POST /commands` with `open_folder`, `groupCode`, `surname`, and
  `homeworkNumber` — build the platform-specific path below
  `DEFAULT_ALLOWED_ROOT`, create the directory when necessary, validate it, and
  open it in Finder.
- `POST /commands` with `open_warp` and the folder parameters or a cached
  absolute `path` — validate the folder and invoke `/usr/bin/open` with a
  `warp://action/new_tab?path=...` URL.
- `POST /commands` with `read_latest_analysis` and the folder parameters or a
  cached absolute `path` — read the newest `.txt` file directly inside the
  folder's `analyze_result` directory.
- `POST /commands` with `clone_student_materials`, the same folder parameters,
  and the student's messages — use OpenRouter to find a GitHub link or ZIP archive.
  GitHub PRs are resolved with `gh` and cloned through the SSH host alias from
  `GITHUB_SSH_HOST`; ZIP archives are downloaded by the extension with the
  authenticated Chrome session, then unpacked without overwriting existing files
  after path and symbolic-link checks.
- The same commands with `platform: "hexlet"` and `githubUrl` build
  `DEFAULT_ALLOWED_ROOT_HEXLET/homeworks/<owner>/<repository>`. The clone command
  uses that URL directly and does not call OpenRouter.
- `POST /static-file` — accepts a supported static attachment only from the
  extension, resolves the same student folder, and stores it without overwriting
  an existing file.

Environment variables:

- `OTUS_COMMAND_HOST` (default `127.0.0.1`)
- `OTUS_COMMAND_PORT` (default `8765`)
- `DEFAULT_ALLOWED_ROOT` is required and defines the local OTUS projects root.
- `DEFAULT_ALLOWED_ROOT_HEXLET` is required and defines the local Hexlet projects root.
- `OPENROUTER_API_KEY`, `OPENROUTER_URL`, `OPENROUTER_MODEL`, and
  `GITHUB_SSH_HOST` are required in `.env`. The example uses
  `GITHUB_SSH_HOST=artemreva-hub`, which must match a `Host` entry in
  `~/.ssh/config`.

The server never passes paths or URLs through a shell. It invokes `/usr/bin/open`
and `git`/`gh` with argument arrays after checking both the requested and resolved path.
Cached absolute paths are accepted only when they remain under the root selected
by the command platform; `analyze_result` is also checked after symlink resolution.

For `clone_student_materials`, the server writes structured lines prefixed with
`[student-materials]` to stdout. They include a flow ID, OpenRouter status,
extracted and normalized URLs, PR source resolution, the exact safe `gh`
argument array, target folder, completion, and errors. API keys and student
message contents are never logged.
When OpenRouter parsing fails, diagnostics distinguish an invalid HTTP response
body from invalid assistant content and include response metadata, finish
reasons, lengths, and a whitespace-normalized preview capped at 400 characters.
The preview is emitted only for malformed data; API keys are never logged.
