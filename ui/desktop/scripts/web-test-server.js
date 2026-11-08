// Local stand-in for the SwiftServer deployment: serves dist/ statically and
// reverse-proxies /acp + /status to goosed over TLS (self-signed cert accepted).
// Run: node scripts/web-test-server.js
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');

const GOOSED_HOST = process.env.GOOSED_HOST || '127.0.0.1';
const GOOSED_PORT = Number(process.env.GOOSED_PORT || 3284);
const SECRET =
  process.env.GOOSE_SERVER_SECRET_KEY ||
  '6a424c3552c187922c24926b2469519a5b71147c3e42285af6286b01fad08bf0';
const PORT = Number(process.env.WEBUI_PORT || 3285);
const DIST = path.join(__dirname, '..', 'dist');
const WEBUI_ID = process.env.GOOSE_WEBUI_ID || 'dibputer';
const TLS_CERT = process.env.WEBUI_TLS_CERT || path.join(__dirname, 'webui-cert.pem');
const TLS_KEY = process.env.WEBUI_TLS_KEY || path.join(__dirname, 'webui-key.pem');
const HTTP_REDIRECT_PORT = Number(process.env.WEBUI_HTTP_PORT || 3286);
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

const agent = new https.Agent({
  host: GOOSED_HOST,
  port: GOOSED_PORT,
  rejectUnauthorized: false,
});

function proxyToGoosed(req, res) {
  const upstream = https.request(
    {
      host: GOOSED_HOST,
      port: GOOSED_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${GOOSED_HOST}:${GOOSED_PORT}` },
      agent,
      rejectUnauthorized: false,
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
    }
  );
  upstream.on('error', (err) => {
    res.statusCode = 502;
    res.end(`proxy error: ${err.message}`);
  });
  req.pipe(upstream);
}

const requestHandler = (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/goose/config') {
    res.setHeader('content-type', 'application/json');
    // mirrors the config the Electron main process injects per window
    res.end(JSON.stringify({ GOOSE_WORKING_DIR: 'g:\\Source\\goose', GOOSE_WEBUI_ID: WEBUI_ID }));
    return;
  }
  if (url.pathname === '/goose/acp-url') {
    res.setHeader('content-type', 'application/json');
    // mirror the client's own scheme so wss is only used from https pages
    const wsScheme =
    req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? 'wss' : 'ws';
    res.end(JSON.stringify({ acpUrl: `${wsScheme}://${req.headers.host}/acp?token=${SECRET}` }));
    return;
  }
  if (url.pathname === '/status' || url.pathname.startsWith('/acp')) {
    proxyToGoosed(req, res);
    return;
  }
  const file = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(DIST) || !fs.existsSync(file)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
};

function handleUpgrade(req, socket) {
  const client = tls.connect({
    host: GOOSED_HOST,
    port: GOOSED_PORT,
    rejectUnauthorized: false,
  });
  const headers = { ...req.headers, host: `${GOOSED_HOST}:${GOOSED_PORT}` };
  // goosed validates the Origin header against its allowed-origins list; the
  // host has already authenticated the client, so strip it rather than
  // enumerating every LAN origin at the backend.
  delete headers.origin;
  const head =
    `${req.method} ${req.url} HTTP/1.1\r\n` +
    Object.entries(headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') +
    '\r\n\r\n';
  client.write(head);
  client.pipe(socket);
  socket.pipe(client);
  client.on('error', () => socket.destroy());
  socket.on('error', () => client.destroy());
}

const server = http.createServer(requestHandler);
server.on('upgrade', handleUpgrade);

const hasTls = fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY);
if (hasTls) {
  const tlsServer = https.createServer(
    { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
    requestHandler
  );
  tlsServer.on('upgrade', handleUpgrade);
  tlsServer.listen(PORT, () => {
    console.log(`webui (https) on https://0.0.0.0:${PORT} [agent: ${WEBUI_ID}]`);
    console.log(`proxying /acp + /status -> https://${GOOSED_HOST}:${GOOSED_PORT}`);
  });
  const redirect = http.createServer((req, res) => {
    const host = req.headers.host?.split(':')[0] ?? 'localhost';
    res.writeHead(301, { location: `https://${host}:${PORT}${req.url}` });
    res.end();
  });
  redirect.listen(HTTP_REDIRECT_PORT, () =>
    console.log(`http://0.0.0.0:${HTTP_REDIRECT_PORT} redirects to https:${PORT}`)
  );
} else {
  server.listen(PORT, () => {
    console.log(`webui (http) on http://0.0.0.0:${PORT} [agent: ${WEBUI_ID}]`);
    console.log(`proxying /acp + /status -> https://${GOOSED_HOST}:${GOOSED_PORT}`);
  });
}
