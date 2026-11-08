# goose-webui-server

A small Swift/Vapor server that hosts the goose desktop UI as a webui and
proxies ACP traffic to a (possibly remote) `goosed` backend.

It is a port of `ui/desktop/scripts/web-test-server.js`, which is the proven
reference implementation. If behavior diverges from that file, that file is
correct.

## What it does

1. Serves the webui static files (Vite build output of `ui/desktop`)
2. `GET /goose/acp-url` — returns the tokened ACP WebSocket URL the browser connects to
3. `GET /goose/config` — returns the per-deployment config the renderer expects
4. Proxies `GET /status` to goosed
5. Proxies WebSocket `/acp` to goosed (frame-level relay)

## Build & run

Requires Swift 5.9+.

```bash
# on the host machine
# 1. copy the vite build output into Public/
mkdir -p Public
cp -r path/to/ui/desktop/dist/* Public/

# 2. build & run
GOOSED_HOST=dibputer \
GOOSED_PORT=3284 \
GOOSE_SERVER_SECRET_KEY=$(cat dibputer.secret) \
GOOSE_WORKING_DIR=/home/user/goose-workdir \
WEBUI_PORT=3285 \
swift run
```

Open `http://<host>:3285`.

## Configuration (environment)

| Variable | Required | Meaning |
|---|---|---|
| `GOOSED_HOST` | no (default 127.0.0.1) | host running goosed |
| `GOOSED_PORT` | no (default 3284) | goosed port |
| `GOOSE_SERVER_SECRET_KEY` | yes | goosed's secret (same value as its `GOOSE_SERVER__SECRET_KEY`) |
| `GOOSE_WORKING_DIR` | no (default /) | cwd sent for new chats; must exist on the goosed host |
| `WEBUI_PORT` | no (default 3285) | port this server listens on |
| `GOOSED_CERT_PATH` | no | PEM of goosed's self-signed cert, used as the only trust root (pinning) |

If `GOOSED_CERT_PATH` is unset, the goosed TLS cert is not verified (fine on a
trusted network; not fine otherwise).

## Autostart

### Linux (systemd)

`/etc/systemd/system/goose-webui.service`:

```ini
[Unit]
Description=Goose WebUI server
After=network-online.target
Wants=network-online.target

[Service]
User=goose
WorkingDirectory=/opt/goose-webui
Environment=GOOSED_HOST=dibputer
Environment=GOOSED_PORT=3284
EnvironmentFile=/opt/goose-webui/goose-webui.env   # holds GOOSE_SERVER_SECRET_KEY, GOOSE_WORKING_DIR
ExecStart=/opt/goose-webui/.build/release/goose-webui-server
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Build in release mode once (`swift build -c release`), then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now goose-webui
```

### macOS (launchd)

`~/Library/LaunchAgents/com.goose.webui.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.goose.webui</string>
  <key>WorkingDirectory</key><string>/opt/goose-webui</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/goose-webui/.build/release/goose-webui-server</string>
  </array>
  <key>EnvironmentVariables</key><dict>
    <key>GOOSED_HOST</key><string>dibputer</string>
    <key>GOOSED_PORT</key><string>3284</string>
    <key>GOOSE_SERVER_SECRET_KEY</key><string>PASTE_SECRET_HERE</string>
    <key>GOOSE_WORKING_DIR</key><string>/Users/you/goose-workdir</string>
    <key>WEBUI_PORT</key><string>3285</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/goose-webui.log</string>
  <key>StandardErrorPath</key><string>/tmp/goose-webui.err.log</string>
</dict></plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.goose.webui.plist
```

## Notes / known gaps

- The WebSocket relay is frame-level (text/binary/close). If goosed ever uses
  permessage-deflate compression negotiated with the browser, results may
  degrade; disable compression on the upstream proxy if issues appear.
- HTTPS termination for the webui itself (so `wss://` is used end to end) is
  best done with nginx/Caddy in front of this server; the `acp-url` endpoint
  already emits `wss` when it sees `X-Forwarded-Proto: https`.
- This server trusts its network. Add real auth at this layer before exposing
  it beyond a trusted perimeter.
