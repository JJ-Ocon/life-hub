// Minimaler statischer Dateiserver ohne Abhaengigkeiten, fuer lokales Testen der PWA.
// Laeuft ueber HTTPS (selbstsigniertes Zertifikat) - Service Worker/PWA-Installation
// verlangen einen "sicheren Kontext", den ein einfacher HTTP-Server im LAN nicht erfuellt.
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8443;
const CERT_DIR = path.join(__dirname, 'certs');
const hasCert = fs.existsSync(path.join(CERT_DIR, 'cert.pem')) && fs.existsSync(path.join(CERT_DIR, 'key.pem'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function handleRequest(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

if (hasCert) {
  const options = {
    cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
    key: fs.readFileSync(path.join(CERT_DIR, 'key.pem')),
  };
  https.createServer(options, handleRequest).listen(PORT, () => {
    console.log(`HTTPS-Server läuft: https://localhost:${PORT}`);
  });

  // Bequemlichkeits-Redirect: wer versehentlich http:// aufruft, landet automatisch auf https://
  const HTTP_PORT = process.env.HTTP_PORT || 8080;
  http.createServer((req, res) => {
    const host = (req.headers.host || 'localhost').split(':')[0];
    res.writeHead(301, { Location: `https://${host}:${PORT}${req.url}` });
    res.end();
  }).listen(HTTP_PORT, () => {
    console.log(`HTTP-Redirect läuft: http://localhost:${HTTP_PORT} -> https://localhost:${PORT}`);
  });
} else {
  http.createServer(handleRequest).listen(PORT, () => {
    console.log(`Kein Zertifikat gefunden (tools/certs/) - Server läuft unverschlüsselt: http://localhost:${PORT}`);
  });
}
