# goose-webui HANDOFF REPLY — dibputer state + topology clarification
_2026-11-08, from the dibputer-side session (author of `goose-webui-HANDOFF.md`)_
_Responds to `goose-webui-HANDOFF-UPDATE-2026-11-08.md`. Read that first, then this._

## TL;DR for whoever maintains either deployment

1. **The two webuis are intentional and are NOT duplicates.** Each front door
   serves a different goose agent (different goosed instance, different
   working dir, different secret, different browser session). Do not "unify"
   them. See topology below.
2. Each webui now self-identifies in the UI (Settings → version shows
   `1.58.0 · dibputer` / `· swiftserver`-style label) via
   `GOOSE_WEBUI_ID` in the `/goose/config` response.
3. dibputer has completed the same TLS upgrade swiftserver did: https on
   3285, plain http on 3286 is redirect-only. Verified end-to-end by Dib.

## Authoritative topology (supersedes "which host runs what" in both prior docs)

| | dibputer (Windows) | swiftserver (container) |
|---|---|---|
| Webui front door | `web-test-server.js` (Node), port 3285 **https** / 3286 http→301 | `webui-server.js` (Node port of the same file), same port scheme |
| Serves dist/ | built 2026-11-08 ~10:15 local — **current** | copied 2026-11-08 ~01:2x UTC — **one rebuild behind** (see below) |
| Backend agent | `goose serve` spawned on dibputer, `https://127.0.0.1:3284`, working dir `g:\Source\goose` | container's `goose serve`, `https://127.0.0.1:3284`, working dir `/home/goose` |
| Secret | `C:\Users\nepha\GooseRemote\dibputer.secret` | container env `GOOSE_SERVER__SECRET_KEY` |
| Secret delivery | launcher `.cmd` reads file into env | container env directly |
| Autostart | `HKCU\...\Run\GooseWebUI` (no elevation needed) | manual `docker exec` pending a compose hook (open item) |
| Cert | `ui/desktop/scripts/webui-cert.pem` + `-key.pem`, SAN: IP 192.168.42.50, 127.0.0.1, DNS dibputer, CN=dibputer-webui/O=goose, 10yr | in-container cert, CN=swiftserver-webui |

The secrets are different **by design** — the two agents are separate. Do not
copy one secret to the other host.

## What changed on dibputer this session (2026-11-08)

1. **Agent identity (item #2 requested by Dib).**
   - `/goose/config` now also returns `GOOSE_WEBUI_ID` (server env
     `GOOSE_WEBUI_ID`, default `dibputer`).
   - The web shim's `getVersion()` returns `<build> · <GOOSE_WEBUI_ID>`; the
     id also prints to the browser console at bootstrap
     (`[goose webui] agent: …`). Purpose: the two webuis look identical but
     talk to different agents — the label is the disambiguator.
   - Frontend rebuilt; bundle hash changed.
2. **TLS upgrade, mirroring swiftserver's design.**
   - Server now serves HTTPS on 3285 when `webui-cert.pem`/`webui-key.pem`
     exist next to the script; wss/ws scheme is derived from
     `req.socket.encrypted` (plus X-Forwarded-Proto) — the dibputer bug where
     a `wss://` URL was served from an `http://` page cannot recur.
   - Plain HTTP listener moved to 3286, 301-redirect-only to https:3285.
   - Dib verified in-browser: cert acceptance → chat works → version shows
     the dibputer identity.
   - Origin header is still stripped on the WS upgrade (goosed 403s unknown
     origins; the front door is the trust boundary).

### Debugging note worth keeping (from the TLS rollout)
Edge's "website sent unusual and incorrect credentials" error = TLS handshake
against a plain-HTTP port (i.e. `https://…:3286`), NOT a cert problem. A bad
cert shows an interstitial with "Proceed". Also: the first cert was generated
with an empty subject due to `-subj "//CN=…"` passed through cmd (MSYS
escaping mistake) — regenerated with `-subj "/CN=dibputer-webui/O=goose"`.
Keep `-subj` single-slashed when invoking openssl from cmd/PowerShell.

## Action item for the swiftserver side (small)

The frontend bundle on swiftserver predates the identity feature:
1. Recopy `ui/desktop/dist/*` (post-2026-11-08 rebuild) to
   `/home/goose/webui/dist/` (smbclient recipe in the update doc works).
2. Make the swiftserver front door include `GOOSE_WEBUI_ID: "swiftserver"`
   in its `/goose/config` response (and start it with the env var).
3. Verify: Settings version shows `· swiftserver`; console shows the agent line.

Until step 1 lands, swiftserver keeps working fully — it just lacks the
identity label.

## Status of previously open items

- Swift/Vapor port (`swift-webui-server/`): **retired as a deployment plan**
  (Dib's decision, Node front door chosen). Kept in the repo as reference
  material. Do not "finish" it unless asked.
- Autostart-after-container-recreate on swiftserver: still open, still the
  highest-value next change (compose post_start hook; needs Dib's sudo).
- Trust model: unchanged — any LAN browser that loads either front door gets
  a token. Fine for the trusted home LAN; revisit before wider exposure.
- Repo hygiene: all webui work (shims, scripts, certs are gitignored? —
  check before committing) is still uncommitted on dibputer. A single commit
  remains the cheapest insurance.

## Doc authority order (for future agents)

1. This reply (topology + current state)
2. `goose-webui-HANDOFF-UPDATE-2026-11-08.md` (swiftserver deployment facts)
3. `goose-webui-HANDOFF.md` (contracts + acceptance checklist — still the test script)

Where they conflict on "what is deployed", the later document wins; where
they conflict on "how the contracts behave", verify against
`ui/desktop/scripts/web-test-server.js` — it remains canonical.
