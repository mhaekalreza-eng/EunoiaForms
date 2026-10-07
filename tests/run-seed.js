// Jalankan engine dengan seed privat (private/seed-kas-eunoia.json) dan cetak ringkasan.
const { computeKas, labelBulan } = require('../apps-script/Engine.gs');
const seed = require('../private/seed-kas-eunoia.json');
const mutasi = [], saldo = [];
for (const s of seed.statements) {
  saldo.push({ periode: s.periode, saldo_awal: s.saldo_awal, saldo_akhir: s.saldo_akhir });
  for (const t of s.transaksi) mutasi.push({ ...t, id: `${s.periode}-${String(t.urutan).padStart(2, '0')}`, periode: s.periode });
}
const r = computeKas({ settings: seed.settings, rumah: seed.rumah, tarif: seed.tarif, expected: seed.expected,
  khusus: seed.khusus, mutasi, saldo, klaim: [], tags: seed.tags, today: process.argv[2] || '2026-10-07' });
console.log('SALDO', r.saldo);
console.log('EXPECTED', r.expected.map(e => `${e.nama}: ${e.terbayar}/${e.jatuhTempo} (${e.selisih})`));
console.log('PENGELUARAN', r.pengeluaran);
for (const k of r.perKavling) console.log(k.kavling.padEnd(8), k.nama.padEnd(20), 'lunas s/d', k.lunasSampai, 'kredit', k.kredit, 'tunggak', k.tunggakan.map(t => t.bulan).join(','));
console.log('KHUSUS', r.khususPaid);
console.log('REVIEW');
for (const v of r.review) console.log(' ', v.tanggal, v.arah || '', v.nominal, v.pihak || v.kavling, '|', v.berita || '', '|', v.alasan, v.saran ? JSON.stringify(v.saran) : '');
console.log('CASHFLOW', r.cashflow.map(c => `${c.bulan} +${c.masuk} -${c.keluar} =${c.saldo_akhir}`).join('\n'));
