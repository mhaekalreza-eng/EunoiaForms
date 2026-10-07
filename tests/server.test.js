// Tes ujung-ke-ujung kode server di mock Apps Script:
// setup → import seed → dashboard → klaim warga → input bendahara → tag → reminder.
// Jalankan: node tests/server.test.js [path/seed.json]
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createGas } = require('./gas-mock');

const seedPath = process.argv[2] || path.join(__dirname, 'fixtures', 'seed-sample.json');
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const g = createGas({ now: '2026-10-07T03:00:00Z' });

const notes = g.setup();
assert(notes.some(n => n.includes('Trigger')), 'setup memasang trigger');
g.setPin_('1234');

// Import seed lewat jalur doPost (jalur B otomatis).
g.__props.IMPORT_TOKEN = 'tok';
const bad = JSON.parse(g.doPost({ postData: { contents: JSON.stringify({ token: 'salah' }) } }));
assert.strictEqual(bad.ok, false);
const res = JSON.parse(g.doPost({ postData: { contents: JSON.stringify(Object.assign({ token: 'tok' }, seed)) } }));
assert(res.ok, res.error);

// Import ulang statement yang sama tidak menggandakan mutasi.
const before = g.readTable_('Mutasi').length;
g.commitImport_({ statements: [seed.statements[0]] }, 'tes');
assert.strictEqual(g.readTable_('Mutasi').length, before, 'import ulang idempoten');

// Statement rusak ditolak.
const broken = JSON.parse(JSON.stringify(seed.statements[0]));
broken.transaksi[0].nominal += 1;
assert.throws(() => g.commitImport_({ statements: [broken] }, 'tes'), /Import dibatalkan/);

let pub = JSON.parse(g.apiPublic());
const lastSaldo = seed.statements[seed.statements.length - 1].saldo_akhir;
assert.strictEqual(pub.saldo.terkonfirmasi, lastSaldo);
assert.strictEqual(pub.saldo.estimasi, lastSaldo);

// Login.
assert.throws(() => g.apiLogin('0000'), /PIN salah/);
const token = g.apiLogin('1234');

// Klaim warga setelah statement terakhir → estimasi naik, status menunggu.
const kav = seed.rumah[1].kavling;
g.apiSubmitKlaim({ kavling: kav, tipe: 'iuran', bulan: ['2026-11', '2026-12'], nominal: 600000, tanggal: '2026-10-05', catatan: 'tes' });
pub = JSON.parse(g.apiPublic());
assert.strictEqual(pub.saldo.estimasi, Math.round((lastSaldo + 600000) * 100) / 100, 'estimasi termasuk klaim');
assert.strictEqual(pub.klaimMenunggu.length, 1);
assert.strictEqual(pub.matriks[kav]['2026-11'].status, 'klaim');
assert(g.__sent.some(m => m.subj.includes('Klaim baru')), 'bendahara dapat email');

// Input bendahara: pengeluaran dari uang pribadi → utang kas.
g.apiSubmitBendahara(token, { tipe: 'pengeluaran', kategori: 'Perbaikan/Maintenance', nominal: 150000, tanggal: '2026-10-06', sumber_dana: 'pribadi' });
pub = JSON.parse(g.apiPublic());
assert.strictEqual(pub.saldo.utangBendahara, 150000);

// Tag manual pada item review pertama.
let admin = JSON.parse(g.apiAdmin(token));
const item = admin.review.find(r => r.jenis === 'mutasi' && r.arah === 'CR');
if (item) {
  g.apiTag(token, { mutasi_id: item.id, tipe: 'pemasukan_lain', kategori: 'Tes' }, {});
  admin = JSON.parse(g.apiAdmin(token));
  assert(!admin.review.some(r => r.id === item.id), 'item hilang dari review setelah di-tag');
}

// Reminder harian (7 Okt): rutin bulan ini belum dibayar → email.
g.__sent.length = 0;
const sent = g.dailyJob();
console.log('dailyJob:', sent);

// Laporan WA.
const wa = g.apiLaporanWa('2026-09');
assert(wa.includes('Laporan'));
console.log('\n' + wa + '\n');

// Preview import JSON lewat UI.
const prev = JSON.parse(g.apiImportJson(token, JSON.stringify({ statements: [seed.statements[0]] })));
assert(prev.preview[0].errors.length === 0 && prev.preview[0].warnings.length === 1);
const commit = g.apiCommitImport(token, prev.key);
assert(commit.ok);

// Sesi kedaluwarsa / token salah ditolak.
assert.throws(() => g.apiAdmin('bukan-token'), /Sesi bendahara habis/);

console.log('Semua tes server lulus ✓');
module.exports = { g, token };

// Import ulang tidak menghapus nomor WA / alias rekening yang diisi lewat Pengaturan.
{
  const kavX = seed.rumah[0].kavling;
  g.apiSimpanRumah(token, { kavling: kavX, nama: seed.rumah[0].nama, rekening: 'ALIAS BARU', wa: '08123456789' });
  g.commitImport_({ rumah: seed.rumah, statements: [] }, 'tes');
  const r = g.readTable_('Rumah').find(x => x.kavling === kavX);
  assert.strictEqual(String(r.wa), '628123456789');
  assert(String(r.rekening).includes('ALIAS BARU'));
  console.log('Import ulang mempertahankan WA & alias ✓');
}
