import Vapor
import WebSocketKit
import NIOCore
import NIOSSL

// The three jobs of the webui host, mirroring scripts/web-test-server.js:
//   1. serve the vite dist/ output as static files
//   2. GET /goose/acp-url and /goose/config bootstrap endpoints
//   3. reverse-proxy /acp (WebSocket) and /status to goosed

// MARK: - Configuration (env vars)

let goosedHost = Environment.get("GOOSED_HOST") ?? "127.0.0.1"
let goosedPort = Int(Environment.get("GOOSED_PORT") ?? "3284")!
let serverSecret = Environment.get("GOOSE_SERVER_SECRET_KEY")!
let workingDir = Environment.get("GOOSE_WORKING_DIR") ?? "/"
let listenPort = Int(Environment.get("WEBUI_PORT") ?? "3285")!
// Pin goosed's self-signed cert exactly like the desktop app does.
let goosedCertFingerprint = Environment.get("GOOSED_CERT_FINGERPRINT")

let goosedBase = "https://\(goosedHost):\(goosedPort)"

// MARK: - App

var env = try Vapor.Environment(name: "goose-webui", arguments: ["vapor"])
let app = try await Application(env)
defer { app.shutdown() }

if goosedCertFingerprint == nil {
    app.logger.warning("GOOSED_CERT_FINGERPRINT not set; goosed TLS cert will not be pinned")
}

// 1. Static files from Public/ (copy ui/desktop/dist/* here)
app.middleware.use(FileMiddleware(publicDirectory: app.directory.publicDirectory))

// 2. Bootstrap endpoints. The ws scheme follows the inbound request so the
// browser never speaks TLS to a plain port (the one gotcha from testing).
app.get("goose", "acp-url") { req -> [String: String?] in
    let isHttps = req.headers["X-Forwarded-Proto"].first == "https"
        || req.url.string?.hasPrefix("https") == true
    let wsScheme = isHttps ? "wss" : "ws"
    let host = req.headers.host.first ?? "127.0.0.1:\(listenPort)"
    return ["acpUrl": "\(wsScheme)://\(host)/acp?token=\(serverSecret)"]
}

app.get("goose", "config") { req -> [String: String] in
    ["GOOSE_WORKING_DIR": workingDir]
}

// 3a. HTTP proxy: /status
app.get("status") { req async throws -> Response in
    try await proxyHTTP(req, path: "/status")
}

// 3b. WebSocket proxy: /acp. The browser upgrades to us; we connect to goosed
// with the token, then relay frames both directions.
app.webSocket("acp") { req, downstream in
    guard let token = req.url.queryParameters.get("token") else {
        _ = downstream.close()
        return
    }
    guard token == serverSecret else {
        _ = downstream.close(code: .goingAway)
        return
    }
    connectUpstream(downstream: downstream, logger: app.logger)
}

app.logger.info("webui listening on port \(listenPort), proxying to \(goosedBase)")
try await app.http.server.shared.start(port: listenPort)
try await app.asyncShutdown()

// MARK: - HTTP proxy

func proxyHTTP(_ req: Request, path: String) async throws -> Response {
    var clientRequest = ClientRequest(
        method: req.method,
        url: URI(string: "\(goosedBase)\(path)"),
        headers: forwardedHeaders(req)
    )
    if let body = req.body.data {
        clientRequest.body = .init(string: String(buffer: body))
    }
    let upstream = try await req.client.send(clientRequest)
    let response = Response(status: upstream.status, headers: upstream.headers, body: upstream.body)
    response.headers.replaceOrAdd(name: "connection", value: "close")
    return response
}

func forwardedHeaders(_ req: Request) -> HTTPHeaders {
    var headers = HTTPHeaders()
    let hopByHop: Set<String> = [
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailer", "transfer-encoding", "upgrade", "host", "origin",
    ]
    for (name, value) in req.headers where !hopByHop.contains(name.lowercased()) {
        headers.add(name: name, value: value)
    }
    headers.replaceOrAdd(name: "host", value: "\(goosedHost):\(goosedPort)")
    return headers
}

// MARK: - WebSocket relay

func connectUpstream(downstream: WebSocket, logger: Logger) {
    var tlsConfig = TLSConfiguration.forClient(
        certificateVerification: goosedCertFingerprint == nil ? .noVerification : .fullVerification
    )
    if goosedCertFingerprint != nil {
        // Pin goosed's self-signed cert by making it the only trust root.
        // Export the cert the desktop app already trusts (matching
        // certFingerprint in settings) to the path in GOOSED_CERT_PATH.
        let certPath = Environment.get("GOOSED_CERT_PATH") ?? "Certificates/goosed.pem"
        do {
            let pem = try String(contentsOfFile: certPath, encoding: .utf8)
            let cert = try NIOSSLCertificate(source: .pem(pem))
            tlsConfig.trustRoots = .certificates([.init(cert)])
        } catch {
            logger.error("could not load pinned cert at \(certPath): \(error)")
        }
    }
    let url = URI(
        string: "\(goosedBase.replacingOccurrences(of: "https", with: "wss"))/acp?token=\(serverSecret)"
    )

    WebSocketClient(
        eventLoopGroup: downstream.eventLoop,
        configuration: .init(tlsConfiguration: tlsConfig)
    ).connect(
        url: url,
        onUpgrade: { upstream in
            relay(downstream: downstream, upstream: upstream, logger: logger)
        }
    ).whenFailure { error in
        logger.error("goosed ws connect failed: \(error)")
        _ = downstream.close()
    }
}

func relay(downstream: WebSocket, upstream: WebSocket, logger: Logger) {
    func pipe(_ from: WebSocket, _ to: WebSocket) {
        from.onText { _, text in _ = to.send(text) }
        from.onBinary { _, data in _ = to.send(raw: data, opcode: .binary) }
        from.onClose { _ in _ = to.close() }
    }
    pipe(downstream, upstream)
    pipe(upstream, downstream)
}
