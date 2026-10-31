// Minimaler statischer Server für docs/ (verhält sich wie GitHub Pages: /pfad/ -> /pfad/index.html, 404.html)
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..', 'docs');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };
function server(port) {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      let f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      if (fs.existsSync(f) && fs.statSync(f).isDirectory()) {
        if (!p.endsWith('/')) { rsp.writeHead(301, { Location: p + '/' }); return rsp.end(); }
        f = path.join(f, 'index.html');
      }
      if (!fs.existsSync(f)) { rsp.writeHead(404, { 'Content-Type': TYPES['.html'] }); return rsp.end(fs.readFileSync(path.join(ROOT, '404.html'))); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      rsp.end(fs.readFileSync(f));
    }).listen(port, '127.0.0.1', () => res(s));
  });
}
module.exports = { server };
if (require.main === module) server(+process.argv[2] || 8080).then(s => console.log('läuft auf', s.address().port));
