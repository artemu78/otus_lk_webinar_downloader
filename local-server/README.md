# Local command server

The extension sends local macOS commands to this dependency-free Node.js server.
It listens only on `127.0.0.1` and accepts folders located below
`/Users/artemreva/projects/otus`.

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
- `POST /commands` with `{"command":"open_folder","path":"/absolute/path"}` —
  create the directory when necessary, validate it, and open it in Finder.
- `POST /commands` with `clone_student_materials`, a validated path and the
  student's messages — use OpenRouter to find a GitHub link, resolve a PR's
  source repository with `gh`, then run `git clone` with the SSH host alias from
  `GITHUB_SSH_HOST`, including when the student's message contains a UI URL.

Optional environment variables:

- `OTUS_COMMAND_HOST` (default `127.0.0.1`)
- `OTUS_COMMAND_PORT` (default `8765`)
- `OTUS_PROJECTS_ROOT` (default `/Users/artemreva/projects/otus`)
- `OPENROUTER_API_KEY`, `OPENROUTER_URL`, `OPENROUTER_MODEL`, and
  `GITHUB_SSH_HOST` are required in `.env`. The example uses
  `GITHUB_SSH_HOST=artemreva-hub`, which must match a `Host` entry in
  `~/.ssh/config`.

The server never passes paths or URLs through a shell. It invokes `/usr/bin/open`
and `git`/`gh` with argument arrays after checking both the requested and resolved path.

For `clone_student_materials`, the server writes structured lines prefixed with
`[student-materials]` to stdout. They include a flow ID, OpenRouter status,
extracted and normalized URLs, PR source resolution, the exact safe `gh`
argument array, target folder, completion, and errors. API keys and student
message contents are never logged.
