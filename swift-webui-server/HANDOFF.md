# Handoff: Deploy the goose webui on the SwiftServer host

You are picking up a **completed and verified** project. Everything below was
implemented and tested end-to-end on a Windows host ("dibputer") running
goosed, with the desktop frontend served to a browser through a proxy. Your
job is to reproduce that setup as a Swift/Vapor server on the SwiftServer
host. There is no design work left — this is a faithful port of a working
reference implementation.

## Proven architecture

```
Browser (Vite build of ui/desktop, unmodified)
   │  http(s) static files
   │  GET /goose/acp-url   → {"acpUrl": "<ws|wss>://<host>/acp?token=<secret>"}
   │  GET /goose/config    → {"GOOSE_WORKING_DIR": "<dir>"}
   │  ws(s)://…/acp?token=…        (ACP over WebSocket)
   ▼
WebUI host (Vapor)  ← the thing you are building
   │  proxy /acp (WS relay) and /status (HTTP)
   ▼
goosed on dibputer:  goose serve --platform desktop --enable-scheduler \
                       --host 0.0.0.0 --port 3284 --tls
                       (secret in GOOSE_SERVER__SECRET_KEY env)
```

The frontend is the **unmodified goose desktop renderer**. It runs in a plain
browser because two small shims install themselves when Electron's preload is
absent. Do not modify the desktop frontend beyond what already exists.

## Existing code (all verified working)

- `ui/desktop/src/web/electronShim.ts` — `window.electron` +
  `window.appConfig` replacement for browsers. TypeScript-checked against the
  preload interface. Settings go to localStorage (preload already had a
  localStorage-first path).
- `ui/desktop/src/web/bootstrap.ts` — installs shims, fetches
  `/goose/acp-url` and `/goose/config` from same origin.
- `ui/desktop/src/renderer.tsx` — calls `bootstrapWeb()` before mounting
  (guarded: no-op when running inside Electron).
- `ui/desktop/scripts/web-test-server.js` — **the reference implementation.**
  A ~110-line Node server: static files + 2 bootstrap endpoints + HTTP proxy
  + WebSocket relay. Every behavior of the Vapor port should match this file.
  If in doubt, copy its behavior, not your assumptions.
- `ui/desktop/scripts/web-test-server.cmd` — Windows launcher reading the
  secret from a file into the env.
- `swift-webui-server/` — a first-cut Vapor implementation (Package.swift,
  Sources/goose-webui-server/main.swift). **It has never been compiled.**
  Expect minor API friction on first `swift build`; the behavioral spec is the
  Node file above.

## The exact contracts (learned by live testing — do not reinvent)

1. **Backend probe (desktop parity).** goosed answers:
   - `GET https://<goosed>/status` → 200 `ok` (no auth)
   - `GET https://<goosed>/acp` with header `X-Secret-Key: <secret>` →
     **HTTP 406 means the secret was accepted.** 401/403 means wrong secret.
   Your server does not strictly need to probe, but the `acp-url` endpoint
   should only hand out URLs to a backend it has verified.

2. **WebSocket auth.** The browser connects to
   `ws(s)://<webui-host>/acp?token=<secret>`. The token arrives as a **query
   parameter** on the WS handshake. Your relay forwards it; goosed validates
   it. Do not change the parameter name (`token`).

3. **Scheme matching (live bug #1).** If the webui is served over plain
   HTTP, the `acpUrl` must be `ws://…`, not `wss://…`. A `wss://` URL from an
   `http://` page fails in the browser (it tries TLS against a plain port).
   Derive the scheme from `X-Forwarded-Proto` / the request scheme. If you
   serve over HTTPS, `wss://` is correct.

4. **Working directory (live bug #2).** Chat creation sends `cwd` to goosed,
   which validates it is an absolute path **on the goosed host**. The renderer
   gets it from `window.appConfig.get('GOOSE_WORKING_DIR')`. The
   `/goose/config` endpoint must supply it, and the value must exist on the
   machine running goosed (for dibputer: `g:\Source\goose`).

5. **Origin header (live bug #3).** goosed validates the WS handshake
   `Origin` header against its allowed-origins list and returns **403** for
   unknown origins (e.g. LAN devices reaching the webui at
   `http://<lan-ip>:3285`). The reference proxy **strips the `Origin`
   header** before forwarding the upgrade; goosed accepts origin-less
   requests. Do the same in Swift, OR run goosed with
   `--allowed-origin <your webui origin(s)>`. Do not skip this — LAN clients
   will fail with "Unable to connect to Goose server" while localhost works,
   which is maddening to debug remotely.

6. **goosed TLS.** goosed runs with `--tls` and a self-signed cert. The
   desktop app pins it via cert fingerprint. The Swift relay should either
   pin the cert (make goosed's PEM the only trust root — the Vapor code
   sketches this via `GOOSED_CERT_PATH`) or, on a fully trusted network,
   disable verification. Fingerprint for dibputer's cert is recorded in
   `%APPDATA%\goose\settings.json` → `externalGoosed.certFingerprint`.

7. **Settings/UI state.** All renderer settings persist in browser
   localStorage via the shim. Nothing needs server-side settings storage for
   a single-user deployment. `window.appConfig` is host-supplied config (per
   user in multi-user futures), not localStorage.

## Endpoint contract summary (implement exactly)

```
GET /goose/acp-url
  → 200 {"acpUrl": "ws://<this-host>:<port>/acp?token=<secret>"}
     (wss if and only if the request arrived over https)

GET /goose/config
  → 200 {"GOOSE_WORKING_DIR": "<absolute path on goosed host>"}

GET|upgrade /acp
  → forward to wss://<goosed-host>:<goosed-port>/acp?token=<secret>
     strip Origin header; relay text/binary/close frames both directions

GET /status
  → forward to https://<goosed-host>:<goosed-port>/status

everything else
  → serve static files from the vite build output (ui/desktop/dist/*)
```

## Build the frontend bundle (done once, redo when frontend changes)

On the dev machine (Windows, from `ui/desktop`):

```
npx -y pnpm@10 install          # repo pins pnpm 10.30+, node ^24
npx -y pnpm@10 run i18n:compile
npx -y vite build --config vite.renderer.config.mts
```

Output is `ui/desktop/dist/`. Copy its contents to the Swift host's
`Public/` (or have Vapor serve it from wherever you copy it).

Note: the same bundle is the Electron renderer (the shim is a no-op there),
so building does not affect the desktop app.

## Verification plan (run these from any machine; they are the acceptance test)

Replace `<host>` with the Swift host. All commands expect plain curl.

```bash
# 1. static UI
curl -s -o /dev/null -w "%{http_code}" http://<host>:3285/          # expect 200

# 2. bootstrap endpoints
curl -s http://<host>:3285/goose/acp-url   # expect tokened ws(s) URL, scheme matches page scheme
curl -s http://<host>:3285/goose/config    # expect GOOSE_WORKING_DIR

# 3. backend reachable through proxy
curl -s http://<host>:3285/status          # expect: ok

# 4. secret accepted (desktop-parity probe)
curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Secret-Key: $(cat dibputer.secret)" \
  https://<goosed>:3284/acp                 # expect 406 (406 == accepted)

# 5. websocket upgrade WITH a foreign Origin header (the LAN bug)
curl -s -i --http1.1 \
  -H "Origin: http://<some-lan-ip>:3285" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "http://<host>:3285/acp?token=<secret>" | head -1
# expect: HTTP/1.1 101 Switching Protocols  (+ acp-connection-id header)

# 6. the real test: open http://<host>:3285 in a browser, send a chat message.
# Known-good failure signatures:
#   - "Unable to connect to Goose server"        → WS handshake failing (check 3/5, origin/scheme)
#   - "Couldn't start chat: cwd must be an absolute path" → /goose/config missing or path bad
```

## Environment variables (Vapor port)

| Var | Default | Meaning |
|---|---|---|
| `GOOSED_HOST` | 127.0.0.1 | goosed host |
| `GOOSED_PORT` | 3284 | goosed port |
| `GOOSE_SERVER_SECRET_KEY` | (required) | goosed's secret, same value it was started with |
| `GOOSE_WORKING_DIR` | / | cwd for new chats; must exist on the goosed host |
| `WEBUI_PORT` | 3285 | port Vapor listens on |
| `GOOSED_CERT_PATH` | unset | PEM of goosed cert for pinning; unset = TLS verification off |

## Current dibputer autostart (for reference / parity checks)

- webui: `HKCU\...\Run\GooseWebUI` runs
  `G:\Dev\repos\goose\ui\desktop\scripts\web-test-server.cmd` at logon
- goosed: still spawned by the desktop app today; an independent autostart
  (Task Scheduler, needs admin) would run the serve command above with the
  secret env set
- Windows firewall: inbound allow rule "Goose-WebUI" for port 3285

## Known limitations / non-goals

- Single-user, trusted-LAN trust model. The secret is handed to any browser
  that loads the page. Before exposing beyond a trusted perimeter, add auth
  at the webui layer (the bootstrap endpoints are the natural place).
- File-attachment/mention features (`listFiles`, `writeFile`,
  `selectFileOrDirectory`, ...) deliberately throw in the web shim. They are
  declared low-priority. Voice/dictation likewise.
- The Electron auto-updater, tray/window features, deep links are no-ops.
- The Swift server never touches goose logic — it is a dumb front door. All
  agent behavior lives in goosed.
