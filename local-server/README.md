# Local command server

The extension sends local macOS commands to this dependency-free Node.js server.
It listens only on `127.0.0.1` and accepts folders located below
`/Users/artemreva/projects/otus`.

Start it from the repository root:

```sh
npm run local-server
```

Supported endpoints:

- `GET /health` — server health check.
- `POST /commands` with `{"command":"open_folder","path":"/absolute/path"}` —
  create the directory when necessary, validate it, and open it in Finder.

Optional environment variables:

- `OTUS_COMMAND_HOST` (default `127.0.0.1`)
- `OTUS_COMMAND_PORT` (default `8765`)
- `OTUS_PROJECTS_ROOT` (default `/Users/artemreva/projects/otus`)

The server never passes the path through a shell. It invokes `/usr/bin/open`
with an argument array after checking both the requested and resolved path.
