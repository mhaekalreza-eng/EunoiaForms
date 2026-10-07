/**
 * Kas Eunoia — akses spreadsheet.
 * Setiap tab adalah tabel dengan header di baris 1. Kolom tanggal/bulan
 * disimpan sebagai teks supaya Sheets tidak mengubahnya jadi Date.
 */

var SHEETS = {
  Settings: ['key', 'value', 'keterangan'],
  Rumah: ['kavling', 'nama', 'rekening', 'wa', 'aktif'],
  Tarif: ['kavling', 'mulai', 'nominal'],
  Expected: ['id', 'nama', 'kategori', 'nominal', 'tgl', 'pola', 'mulai', 'aktif'],
  IuranKhusus: ['id', 'nama', 'nominal', 'mulai', 'deadline', 'aktif'],
  Mutasi: ['id', 'periode', 'urutan', 'tanggal', 'jenis', 'nominal', 'keterangan', 'pihak', 'berita', 'saldo', 'batch'],
  Saldo: ['periode', 'saldo_awal', 'total_cr', 'total_db', 'saldo_akhir', 'sumber', 'diimport'],
  Klaim: ['id', 'waktu', 'jalur', 'tipe', 'kavling', 'bulan', 'nominal', 'tanggal', 'kategori', 'penerima',
    'sumber_dana', 'khusus_id', 'bukti', 'catatan', 'dihapus'],
  Tag: ['mutasi_id', 'tipe', 'kavling', 'bulan', 'kategori', 'khusus_id', 'catatan', 'waktu'],
  Hasil: ['tanggal', 'arah', 'nominal', 'pihak', 'berita', 'kelas', 'kategori', 'kavling', 'bulan', 'cara', 'flag', 'alasan'],
  Matriks: [],
  Log: ['waktu', 'aksi', 'detail']
};

// Kolom yang selalu teks (format '@').
var TEXT_COLS = ['id', 'periode', 'tanggal', 'mulai', 'deadline', 'bulan', 'kavling', 'mutasi_id', 'waktu', 'wa', 'key', 'value', 'khusus_id'];

var SETTINGS_DEFAULT = [
  ['NAMA_KAS', 'Kas Eunoia', 'Judul web app'],
  ['NAMA_BENDAHARA', '', 'Nama bendahara aktif (tampil di laporan)'],
  ['EMAIL_BENDAHARA', '', 'Email penerima reminder (kosong = email pemilik spreadsheet)'],
  ['NAMA_REKENING_BENDAHARA', '', 'Nama rekening pribadi bendahara persis seperti di mutasi BCA (18 huruf pertama)'],
  ['REKENING_INFO', '', 'Teks rekening tujuan untuk warga, contoh: BCA 1234567890 a.n. Nama'],
  ['MULAI_TRACKING', '2026-01', 'Bulan pertama yang dilacak (YYYY-MM)'],
  ['TOLERANSI_HARI', '7', 'Selisih hari maksimal antara klaim dan mutasi'],
  ['TGL_REMINDER_WARGA', '27', 'Tanggal pengingat iuran ke warga'],
  ['UTANG_AWAL', '0', 'Utang kas ke bendahara sebelum MULAI_TRACKING'],
  ['MODEL_CLAUDE', 'claude-opus-5-5', 'Model untuk membaca PDF statement'],
  ['PIN_HASH', '', 'Jangan diedit manual — pakai menu Kas Eunoia → Ganti PIN'],
  ['PIN_SALT', '', ''],
  ['FOLDER_ID', '', 'Folder Drive untuk bukti transfer & laporan (dibuat otomatis)'],
  ['KALENDER_EVENT_ID', '', 'Dibuat otomatis oleh Setup']
];

function ss_() { return SpreadsheetApp.getActive(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" tidak ada. Jalankan menu Kas Eunoia → Setup.');
  return sh;
}

function cellToString_(v, col) {
  if (v instanceof Date) {
    var s = Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
    return (col === 'mulai' || col === 'periode') ? s.slice(0, 7) : s;
  }
  return v;
}

/** Baca tab jadi array objek. */
function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var o = { _row: i + 1 };
    head.forEach(function (h, j) { if (h) o[h] = cellToString_(row[j], h); });
    rows.push(o);
  }
  return rows;
}

function toRow_(name, obj) {
  return SHEETS[name].map(function (h) {
    var v = obj[h];
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) return v.join(h === 'rekening' ? '; ' : ',');
    return v;
  });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name);
  var rows = objs.map(function (o) { return toRow_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function updateRow_(name, rowNum, obj) {
  sheet_(name).getRange(rowNum, 1, 1, SHEETS[name].length).setValues([toRow_(name, obj)]);
}

/** Ganti seluruh isi tab (header tetap). */
function replaceTable_(name, objs) {
  var sh = sheet_(name);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, sh.getMaxColumns()).clearContent();
  appendRows_(name, objs);
}

function deleteRowsWhere_(name, pred) {
  var sh = sheet_(name);
  var rows = readTable_(name).filter(pred).map(function (r) { return r._row; }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { sh.deleteRow(r); });
  return rows.length;
}

/** Upsert berdasarkan kolom kunci. */
function upsert_(name, key, obj) {
  var existing = readTable_(name).filter(function (r) { return String(r[key]) === String(obj[key]); })[0];
  if (existing) {
    var merged = {};
    SHEETS[name].forEach(function (h) { merged[h] = obj[h] !== undefined ? obj[h] : existing[h]; });
    updateRow_(name, existing._row, merged);
  } else appendRows_(name, [obj]);
}

function getSettings_() {
  var o = {};
  readTable_('Settings').forEach(function (r) { o[r.key] = r.value === undefined ? '' : String(r.value); });
  return o;
}

function setSetting_(key, value) { upsert_('Settings', 'key', { key: key, value: String(value) }); }

function log_(aksi, detail) {
  try {
    appendRows_('Log', [{ waktu: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'),
      aksi: aksi, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }]);
  } catch (e) { /* log tidak boleh menggagalkan aksi */ }
}

function splitList_(s, sep) {
  return String(s || '').split(sep || /[;,]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function isTrue_(v) { return !(v === false || String(v).toUpperCase() === 'FALSE' || v === 0 || String(v) === '0'); }

/** Kumpulkan semua data mentah dalam bentuk yang dimengerti computeKas(). */
function loadData_() {
  var settings = getSettings_();
  var tags = {};
  readTable_('Tag').forEach(function (t) {
    tags[t.mutasi_id] = { tipe: t.tipe, kavling: t.kavling, bulan: splitList_(t.bulan, ','), kategori: t.kategori,
      khusus_id: t.khusus_id, catatan: t.catatan };
  });
  return {
    settings: settings,
    rumah: readTable_('Rumah').map(function (r) {
      return { kavling: r.kavling, nama: r.nama, rekening: splitList_(r.rekening, ';'), wa: String(r.wa || ''), aktif: isTrue_(r.aktif) };
    }),
    tarif: readTable_('Tarif').map(function (t) { return { kavling: t.kavling, mulai: t.mulai, nominal: +t.nominal }; }),
    expected: readTable_('Expected').map(function (e) {
      return { id: e.id, nama: e.nama, kategori: e.kategori, nominal: +e.nominal, tgl: +e.tgl, pola: e.pola, mulai: e.mulai, aktif: isTrue_(e.aktif) };
    }),
    khusus: readTable_('IuranKhusus').map(function (k) {
      return { id: k.id, nama: k.nama, nominal: +k.nominal, mulai: k.mulai, deadline: k.deadline, aktif: isTrue_(k.aktif) };
    }),
    mutasi: readTable_('Mutasi').map(function (m) {
      return { id: m.id, periode: m.periode, urutan: +m.urutan, tanggal: m.tanggal, jenis: m.jenis, nominal: +m.nominal,
        keterangan: m.keterangan, pihak: m.pihak, berita: m.berita, saldo: m.saldo };
    }),
    saldo: readTable_('Saldo').map(function (s) {
      return { periode: s.periode, saldo_awal: +s.saldo_awal, saldo_akhir: +s.saldo_akhir, total_cr: +s.total_cr, total_db: +s.total_db };
    }),
    klaim: readTable_('Klaim').filter(function (k) { return String(k.dihapus).toUpperCase() !== 'TRUE'; }).map(function (k) {
      return { id: k.id, waktu: k.waktu, jalur: k.jalur, tipe: k.tipe, kavling: k.kavling, bulan: splitList_(k.bulan, ','),
        nominal: +k.nominal, tanggal: k.tanggal, kategori: k.kategori, penerima: k.penerima, sumber_dana: k.sumber_dana,
        khusus_id: k.khusus_id, bukti: k.bukti, catatan: k.catatan };
    }),
    tags: tags,
    today: Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd')
  };
}
