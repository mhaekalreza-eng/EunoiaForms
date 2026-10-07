// Server lokal untuk preview UI: menyajikan Index.html dengan shim google.script.run
// yang memanggil kode server di mock Apps Script. Jalankan: node tests/preview-server.js [seed.json] [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const seedPath = process.argv[2] || path.join(__dirname, 'fixtures', 'seed-sample.json');
const port = +process.argv[3] || 8787;
const g = createGas({ now: '2026-10-07T03:00:00Z' });
g.setup(); g.setPin_('1234');
g.commitImport_(JSON.parse(fs.readFileSync(seedPath, 'utf8')), 'preview');

const dir = path.join(__dirname, '..', 'apps-script');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const shim = `<script>
window.google = { script: { run: (function make(ok, ko) {
  return new Proxy({}, { get(_, fn) {
    if (fn === 'withSuccessHandler') return h => make(h, ko);
    if (fn === 'withFailureHandler') return h => make(ok, h);
    return (...args) => fetch('/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) }).then(r => r.json())
      .then(r => r.error ? ko && ko(new Error(r.error)) : ok && ok(r.value));
  } });
})() } };
</script>`;
function page() {
  const nama = g.getSettings_().NAMA_KAS;
  return read('Index.html')
    .replace(/<\?!= include\('Css'\); \?>/, read('Css.html'))
    .replace(/<\?!= include\('App'\); \?>/, () => shim + (vendor ? '<script>window.__CHART_SRC = "/chart.js";</script>' : '') + g.include('App'))
    .replace(/<\?= namaKas \?>/g, nama);
}
const vendor = process.env.CHART_JS; // salinan Chart.js lokal (opsional, untuk preview offline)
http.createServer((req, res) => {
  if (vendor && req.url === '/chart.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(fs.readFileSync(vendor)); return; }
  if (req.method === 'POST' && req.url.startsWith('/rpc/')) {
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const fn = req.url.slice(5);
      let out;
      try { out = { value: g[fn](...JSON.parse(body)) }; } catch (e) { out = { error: e.message }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page());
}).listen(port, () => console.log('preview on http://localhost:' + port));
