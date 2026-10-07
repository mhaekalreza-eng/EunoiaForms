/**
 * Kas Eunoia — import mutasi BCA.
 *  A. PDF diupload di web app → Claude API → JSON statement
 *  B. JSON dari Claude (chat) → paste di web app, atau POST ke doPost dengan IMPORT_TOKEN
 * Kedua jalur berakhir di commitImport_(), yang memvalidasi saldo sebelum menulis.
 */

var STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rekening', 'periode', 'saldo_awal', 'total_cr', 'total_db', 'saldo_akhir', 'transaksi'],
  properties: {
    rekening: { type: 'string' },
    periode: { type: 'string', description: 'YYYY-MM' },
    saldo_awal: { type: 'number' },
    total_cr: { type: 'number' },
    total_db: { type: 'number' },
    saldo_akhir: { type: 'number' },
    transaksi: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tanggal', 'jenis', 'nominal', 'keterangan', 'pihak', 'berita'],
        properties: {
          tanggal: { type: 'string', description: 'YYYY-MM-DD, tanggal di kolom TANGGAL' },
          jenis: { type: 'string', enum: ['CR', 'DB'] },
          nominal: { type: 'number' },
          keterangan: { type: 'string' },
          pihak: { type: 'string' },
          berita: { type: 'string' }
        }
      }
    }
  }
};

var PDF_PROMPT = [
  'Ini e-Statement rekening BCA. Ekstrak SEMUA baris transaksi, urut sesuai dokumen, lewati baris SALDO AWAL.',
  'Aturan per baris:',
  '- tanggal: YYYY-MM-DD dari kolom TANGGAL dan PERIODE statement.',
  '- jenis: "DB" jika nominal diberi tanda DB, selain itu "CR".',
  '- nominal: angka mutasi (bukan saldo), tanpa pemisah ribuan.',
  '- keterangan: teks kolom KETERANGAN baris pertama, mis. "TRSF E-BANKING CR", "BI-FAST DB BIF TRANSFER KE", "BI-FAST DB BIF BIAYA TXN KE", "BIAYA ADM", "BUNGA", "DB OTOMATIS CREDITCARD/PL PYMT".',
  '- pihak: nama pengirim/penerima (biasanya baris terakhir rincian, terpotong 18 huruf, mis. "RACHDIAZ JUDHA DAR"). Kosong untuk BIAYA ADM/BUNGA. Abaikan "MyBCA" dan kode bank 3 digit.',
  '- berita: catatan transfer dari pengirim (baris rincian selain angka ulang, kode bank, nama pihak, dan "TANGGAL :"). Gabungkan baris yang terpotong.',
  'Ringkasan: saldo_awal, total_cr (MUTASI CR), total_db (MUTASI DB), saldo_akhir dari blok ringkasan di akhir statement.',
  'Jangan menebak: salin angka persis.'
].join('\n');

function claudeParsePdf_(base64) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Anthropic API key belum disimpan (menu Kas Eunoia → Simpan Anthropic API key).');
  var S = getSettings_();
  var body = {
    model: S.MODEL_CLAUDE || 'claude-opus-5-5',
    max_tokens: 16000,
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: STATEMENT_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: PDF_PROMPT }
      ]
    }]
  };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var json = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + (json.error && json.error.message || res.getContentText().slice(0, 300)));
  if (json.stop_reason === 'refusal') throw new Error('Claude menolak memproses dokumen ini. Coba jalur B (lewat chat Claude).');
  if (json.stop_reason === 'max_tokens') throw new Error('Statement terlalu panjang untuk sekali baca. Coba jalur B.');
  var text = (json.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
  var st = JSON.parse(text);
  st.transaksi.forEach(function (t, i) { t.urutan = i + 1; });
  return st;
}

/** Validasi satu statement. Return daftar error (kosong = valid). */
function validateStatement_(st) {
  var err = [];
  if (!/^\d{4}-\d{2}$/.test(st.periode || '')) err.push('periode harus YYYY-MM');
  var cr = 0, db = 0;
  (st.transaksi || []).forEach(function (t, i) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.tanggal || '')) err.push('baris ' + (i + 1) + ': tanggal');
    else if (t.tanggal.slice(0, 7) !== st.periode) err.push('baris ' + (i + 1) + ': tanggal di luar periode');
    if (t.jenis !== 'CR' && t.jenis !== 'DB') err.push('baris ' + (i + 1) + ': jenis');
    if (!(+t.nominal > 0)) err.push('baris ' + (i + 1) + ': nominal');
    if (t.jenis === 'CR') cr += +t.nominal; else db += +t.nominal;
  });
  cr = Math.round(cr * 100) / 100; db = Math.round(db * 100) / 100;
  if (st.total_cr !== undefined && Math.abs(cr - st.total_cr) > 0.005) err.push('jumlah CR ' + cr + ' ≠ ringkasan ' + st.total_cr);
  if (st.total_db !== undefined && Math.abs(db - st.total_db) > 0.005) err.push('jumlah DB ' + db + ' ≠ ringkasan ' + st.total_db);
  if (Math.abs(+st.saldo_awal + cr - db - +st.saldo_akhir) > 0.005) err.push('saldo awal + CR − DB ≠ saldo akhir');
  return err;
}

/** Ringkasan untuk layar review sebelum commit. */
function previewImport_(payload) {
  var saldoLama = {};
  readTable_('Saldo').forEach(function (s) { saldoLama[s.periode] = s; });
  return (payload.statements || []).map(function (st) {
    var prev = saldoLama[addMonths(st.periode, -1)];
    var warn = [];
    if (prev && Math.abs(+prev.saldo_akhir - +st.saldo_awal) > 0.005) warn.push('Saldo awal tidak sama dengan saldo akhir bulan sebelumnya (' + prev.saldo_akhir + ')');
    if (saldoLama[st.periode]) warn.push('Periode ini sudah pernah diimport — akan diganti');
    return { periode: st.periode, saldo_awal: st.saldo_awal, saldo_akhir: st.saldo_akhir, total_cr: st.total_cr, total_db: st.total_db,
      jumlah: (st.transaksi || []).length, errors: validateStatement_(st), warnings: warn, transaksi: st.transaksi };
  });
}

/**
 * Tulis payload ke spreadsheet. payload: {statements:[...], rumah?, tarif?, expected?, khusus?, tags?, settings?}
 * Statement yang tidak valid menggagalkan seluruh import.
 */
function commitImport_(payload, sumber) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var preview = previewImport_(payload);
    var bad = preview.filter(function (p) { return p.errors.length; });
    if (bad.length) throw new Error('Import dibatalkan: ' + bad.map(function (p) { return p.periode + ' → ' + p.errors.join(', '); }).join(' | '));
    var batch = nowStr_();
    var done = [];
    (payload.statements || []).forEach(function (st) {
      deleteRowsWhere_('Mutasi', function (m) { return m.periode === st.periode; });
      appendRows_('Mutasi', st.transaksi.map(function (t, i) {
        var urut = t.urutan || i + 1;
        return { id: st.periode + '-' + ('0' + urut).slice(-2), periode: st.periode, urutan: urut, tanggal: t.tanggal, jenis: t.jenis,
          nominal: +t.nominal, keterangan: t.keterangan || '', pihak: t.pihak || '', berita: t.berita || '',
          saldo: t.saldo === null || t.saldo === undefined ? '' : t.saldo, batch: batch };
      }));
      upsert_('Saldo', 'periode', { periode: st.periode, saldo_awal: +st.saldo_awal, total_cr: +st.total_cr, total_db: +st.total_db,
        saldo_akhir: +st.saldo_akhir, sumber: sumber, diimport: batch });
      done.push(st.periode + ' (' + st.transaksi.length + ' transaksi)');
    });
    if (payload.settings) Object.keys(payload.settings).forEach(function (k) {
      if (k === 'PIN_HASH' || k === 'PIN_SALT') return;
      setSetting_(k, payload.settings[k]);
    });
    (payload.rumah || []).forEach(function (r) {
      upsert_('Rumah', 'kavling', { kavling: r.kavling, nama: r.nama, rekening: r.rekening || [], wa: r.wa || '', aktif: r.aktif === false ? 'FALSE' : 'TRUE' });
    });
    if (payload.tarif) replaceTable_('Tarif', payload.tarif);
    (payload.expected || []).forEach(function (e) { e.aktif = e.aktif === false ? 'FALSE' : 'TRUE'; upsert_('Expected', 'id', e); });
    (payload.khusus || []).forEach(function (k) { k.aktif = k.aktif === false ? 'FALSE' : 'TRUE'; upsert_('IuranKhusus', 'id', k); });
    var tagIds = Object.keys(payload.tags || {});
    tagIds.forEach(function (id) {
      var t = payload.tags[id];
      upsert_('Tag', 'mutasi_id', { mutasi_id: id, tipe: t.tipe, kavling: t.kavling || '', bulan: t.bulan || [], kategori: t.kategori || '',
        khusus_id: t.khusus_id || '', catatan: t.catatan || '', waktu: batch });
    });
    log_('import', { sumber: sumber, statements: done, tags: tagIds.length });
    clearCache_();
    try { refreshViews(); } catch (e) { /* tampilan sheet opsional */ }
    return { ok: true, pesan: 'Diimport: ' + (done.join(', ') || '-') + (tagIds.length ? '; ' + tagIds.length + ' tag' : '') };
  } finally {
    lock.releaseLock();
  }
}

/** Jalur B otomatis: POST JSON {token, statements:[...]} ke URL web app. */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('IMPORT_TOKEN');
    if (!expected || body.token !== expected) throw new Error('Token import salah atau belum dibuat.');
    delete body.token;
    out = body.dryRun ? { ok: true, preview: previewImport_(body).map(function (p) { delete p.transaksi; return p; }) }
      : commitImport_(body, 'api');
  } catch (err) {
    out = { ok: false, error: err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
