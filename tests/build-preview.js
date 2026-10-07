// Bangun satu file HTML mandiri untuk pratinjau Kas Eunoia (tanpa server Google).
// Data dihitung dari seed lalu dianonimkan: nama warga & pengirim diganti "Warga Kav. N".
// Pemakaian: node tests/build-preview.js <seed.json> <output.html>
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');

const [seedPath, outPath] = process.argv.slice(2);
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const g = createGas({ now: '2026-10-07T03:00:00Z' });
g.setup();
g.commitImport_(seed, 'preview');

// Peta alias rekening → kavling untuk anonimisasi.
const alias = [];
for (const r of seed.rumah) for (const a of r.rekening || []) alias.push([a.toUpperCase(), r.kavling]);
const BENDAHARA = (seed.settings && seed.settings.NAMA_REKENING_BENDAHARA || '').toUpperCase();
function anonPihak(p) {
  const up = String(p || '').toUpperCase();
  if (!up) return '';
  if (BENDAHARA && up.startsWith(BENDAHARA.slice(0, 10))) return 'Bendahara';
  const hit = alias.find(([a]) => up.startsWith(a.slice(0, 10)) || a.startsWith(up.slice(0, 10)));
  if (hit) return 'Warga ' + hit[1];
  if (/BUDI/.test(up)) return 'Petugas sampah';
  if (/DOMPET ANAK BANGSA/.test(up)) return 'GoPay';
  return 'Pengirim lain';
}
const namaWarga = seed.rumah.map(r => [r.nama, 'Warga ' + r.kavling]);
function anonText(s) { let t = String(s); for (const [n, w] of namaWarga) t = t.split(n).join(w); return t; }

const pub = JSON.parse(g.apiPublic());
pub.perKavling.forEach(k => { k.nama = 'Warga ' + k.kavling; });
pub.mutasi.forEach(m => {
  // Transfer gaji ke rekening Kav. 22 tetap terbaca sebagai gaji satpam.
  m.pihak = m.jenis === 'DB' && m.kategori === 'Gaji Satpam' ? 'Satpam' : m.jenis === 'DB' && m.kategori === 'THR' ? 'Satpam (THR)' : anonPihak(m.pihak);
  m.berita = '';
});
const form = JSON.parse(g.apiFormInfo());
form.rumah.forEach(r => { r.nama = 'Warga ' + r.kavling; });
const laporan = {};
for (const c of pub.cashflow) laporan[c.bulan] = anonText(g.apiLaporanWa(c.bulan));

// google.script.run palsu: data dibekukan, aksi tulis ditolak dengan pesan jelas.
const stub = `<script>
(function () {
  var DATA = ${JSON.stringify({ apiPublic: JSON.stringify(pub), apiFormInfo: JSON.stringify(form), laporan })};
  function make(ok, ko) {
    var api = {
      withSuccessHandler: function (h) { return make(h, ko); },
      withFailureHandler: function (h) { return make(ok, h); }
    };
    var answer = function (fn, args) {
      if (fn === 'apiPublic' || fn === 'apiFormInfo') return { value: DATA[fn] };
      if (fn === 'apiLaporanWa') return { value: DATA.laporan[args[0]] || '' };
      if (fn === 'apiSubmitKlaim') return { error: 'Ini pratinjau: konfirmasi tidak dikirim. Di web app asli, klaim langsung tercatat.' };
      if (fn === 'apiLogin') return { error: 'Menu bendahara tidak aktif di pratinjau.' };
      return { error: 'Tidak tersedia di pratinjau.' };
    };
    ['apiPublic', 'apiFormInfo', 'apiLaporanWa', 'apiSubmitKlaim', 'apiLogin', 'apiAdmin'].forEach(function (fn) {
      api[fn] = function () {
        var args = arguments, res = answer(fn, args);
        setTimeout(function () { res.error ? ko && ko(new Error(res.error)) : ok && ok(res.value); }, 120);
      };
    });
    return api;
  }
  window.google = { script: { run: make(null, null) } };
})();
</script>`;

const dir = path.join(__dirname, '..', 'apps-script');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
const index = read('Index.html').replace('<?= tabAwal ?>', 'bayar');
const head = index.slice(index.indexOf('<head>') + 6, index.indexOf('</head>'))
  .replace(/<base[^>]*>\s*/, '').replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '')
  .replace(/<title>.*?<\/title>/, '<title>Kas Eunoia</title>')
  .replace("<?!= include('Css'); ?>", read('Css.html'));
const body = index.slice(index.indexOf('>', index.indexOf('<body')) + 1, index.indexOf('</body>'))
  .replace(/<\?= namaKas \?>/g, 'Kas Eunoia')
  .replace('<?= bayarOn ?>', 'on')
  .replace('<?= logo ?>', g.LOGO_DATA_URI)
  .replace('<?!= hero ?>', () => g.heroHtml_('#'))
  .replace("<?!= include('App'); ?>", () => stub + g.include('App'));

const html = head.trim() + '\n' + body.trim() + '\n';
fs.writeFileSync(outPath, html);
console.log('wrote', outPath, Math.round(html.length / 1024) + ' KB');
