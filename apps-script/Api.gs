/**
 * Kas Eunoia — web app & fungsi yang dipanggil dari browser (google.script.run).
 * Fungsi berawalan "api" bisa dipanggil siapa pun yang membuka web app;
 * fungsi bendahara wajib membawa token sesi dari apiLogin().
 */

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.namaKas = getSettings_().NAMA_KAS || 'Kas Eunoia';
  return t.evaluate()
    .setTitle(t.namaKas)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) { return HtmlService.createHtmlOutputFromFile(name).getContent(); }

// ---------- cache ----------

function cacheVersion_() {
  return PropertiesService.getScriptProperties().getProperty('CACHE_VER') || '0';
}
function clearCache_() {
  PropertiesService.getScriptProperties().setProperty('CACHE_VER', String(+cacheVersion_() + 1));
}
function computeCached_() {
  return computeKas(loadData_());
}

// ---------- auth ----------

function apiLogin(pin) {
  var cache = CacheService.getScriptCache();
  var fails = +(cache.get('pin_fails') || 0);
  if (fails >= 10) throw new Error('Terlalu banyak percobaan. Coba lagi 15 menit lagi.');
  var S = getSettings_();
  if (!S.PIN_HASH) throw new Error('PIN belum diset. Pemilik spreadsheet: menu Kas Eunoia → Ganti PIN.');
  if (hashPin_(String(pin || ''), S.PIN_SALT) !== S.PIN_HASH) {
    cache.put('pin_fails', String(fails + 1), 900);
    Utilities.sleep(800);
    throw new Error('PIN salah.');
  }
  cache.remove('pin_fails');
  var token = Utilities.getUuid();
  cache.put('sess_' + token, '1', 6 * 3600);
  log_('login', 'bendahara masuk');
  return token;
}

function requireAdmin_(token) {
  if (!token || !CacheService.getScriptCache().get('sess_' + token)) throw new Error('Sesi bendahara habis — masukkan PIN lagi.');
}

// ---------- payload ----------

function publicPayload_(r, S) {
  var khusus = loadKhususList_();
  return {
    namaKas: S.NAMA_KAS || 'Kas Eunoia',
    namaBendahara: S.NAMA_BENDAHARA || '',
    rekeningInfo: S.REKENING_INFO || '',
    today: r.today, bulanIni: r.bulanIni, mulai: r.mulai, bankUntil: r.bankUntil,
    saldo: r.saldo,
    cashflow: r.cashflow,
    pengeluaran: r.pengeluaran,
    expected: r.expected,
    matriks: r.matriks,
    perKavling: r.perKavling.map(function (k) {
      return { kavling: k.kavling, nama: k.nama, aktif: k.aktif, tarifSekarang: k.tarifSekarang, kredit: k.kredit,
        tunggakan: k.tunggakan, totalTunggakan: k.totalTunggakan, lunasSampai: k.lunasSampai };
    }),
    khusus: khusus.map(function (k) {
      return { id: k.id, nama: k.nama, nominal: k.nominal, mulai: k.mulai, deadline: k.deadline, aktif: k.aktif, bayar: r.khususPaid[k.id] || {} };
    }),
    mutasi: r.mutasi.map(function (m) {
      return { id: m.id, tanggal: m.tanggal, jenis: m.jenis, nominal: m.nominal, pihak: m.pihak, berita: m.berita,
        kelas: m.kelas, kategori: m.kategori, kavling: m.kavling, bulan: m.bulan, flag: m.flag, cara: m.cara };
    }).reverse(),
    klaimMenunggu: r.klaim.filter(function (k) { return k.status === 'menunggu'; }).map(function (k) {
      return { id: k.id, tanggal: k.tanggal, jalur: k.jalur, tipe: k.tipe, kavling: k.kavling, bulan: k.bulan,
        nominal: k.nominal, kategori: k.kategori, adaBukti: !!k.bukti };
    })
  };
}

function loadKhususList_() {
  return readTable_('IuranKhusus').map(function (k) {
    return { id: k.id, nama: k.nama, nominal: +k.nominal, mulai: k.mulai, deadline: k.deadline, aktif: isTrue_(k.aktif) };
  });
}

/** Dashboard publik (tanpa bukti transfer & nomor WA). */
function apiPublic() {
  var cache = CacheService.getScriptCache();
  var key = 'pub_' + cacheVersion_() + '_' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyyMMdd');
  var hit = cache.get(key);
  if (hit) return hit;
  var json = JSON.stringify(publicPayload_(computeCached_(), getSettings_()));
  if (json.length < 95000) cache.put(key, json, 600);
  return json;
}

/** Data untuk form warga. */
function apiFormInfo() {
  var d = loadData_();
  var r = computeKas(d);
  return JSON.stringify({
    rekeningInfo: d.settings.REKENING_INFO || '',
    bulanIni: r.bulanIni, mulai: r.mulai,
    rumah: r.perKavling.filter(function (k) { return k.aktif; }).map(function (k) {
      var bulan = [];
      for (var i = -12; i <= 12; i++) {
        var ym = addMonths(r.bulanIni, i);
        if (ym < r.mulai) continue;
        var p = r.matriks[k.kavling][ym];
        bulan.push({ ym: ym, tarif: r.tarif(k.kavling, ym), status: p ? p.status : '' });
      }
      return { kavling: k.kavling, nama: k.nama, bulan: bulan };
    }),
    khusus: loadKhususList_().filter(function (k) { return k.aktif; })
  });
}

function saveBukti_(file, prefix) {
  if (!file || !file.data) return '';
  if (file.data.length > 7 * 1024 * 1024) throw new Error('File bukti terlalu besar (maks ±5 MB).');
  var folder = DriveApp.getFolderById(getSettings_().FOLDER_ID);
  var blob = Utilities.newBlob(Utilities.base64Decode(file.data), file.mime || 'image/jpeg',
    prefix + '_' + (file.name || 'bukti').replace(/[^\w.\-]/g, '_'));
  return folder.createFile(blob).getUrl();
}

/** Klaim dari warga (tanpa login). */
function apiSubmitKlaim(form) {
  var rumah = readTable_('Rumah').map(function (r) { return r.kavling; });
  if (rumah.indexOf(form.kavling) < 0) throw new Error('Pilih kavling.');
  var tipe = form.tipe === 'khusus' ? 'khusus' : 'iuran';
  var bulan = (form.bulan || []).filter(function (b) { return /^\d{4}-\d{2}$/.test(b); });
  if (tipe === 'iuran' && !bulan.length) throw new Error('Centang minimal satu bulan.');
  var nominal = Math.round(+form.nominal);
  if (!(nominal > 0) || nominal > 100000000) throw new Error('Nominal tidak valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.tanggal || '')) throw new Error('Isi tanggal transfer.');
  if (tipe === 'khusus' && !form.khusus_id) throw new Error('Pilih iuran khusus.');
  var id = 'W-' + Utilities.getUuid().slice(0, 8);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var bukti = saveBukti_(form.bukti, id);
    appendRows_('Klaim', [{ id: id, waktu: nowStr_(), jalur: 'warga', tipe: tipe, kavling: form.kavling, bulan: bulan,
      nominal: nominal, tanggal: form.tanggal, khusus_id: form.khusus_id || '', bukti: bukti,
      catatan: String(form.catatan || '').slice(0, 500) }]);
  } finally { lock.releaseLock(); }
  clearCache_();
  notifyBendahara_('Klaim baru: ' + form.kavling + ' ' + rupiah_(nominal),
    form.kavling + ' mengklaim ' + rupiah_(nominal) + (bulan.length ? ' untuk ' + bulan.map(labelBulan).join(', ') : '') +
    ' (transfer ' + form.tanggal + ').\nCatatan: ' + (form.catatan || '-') + (form.bukti && form.bukti.data ? '\nBukti terlampir di Drive.' : '\nTanpa bukti.'));
  return { ok: true, id: id };
}

// ---------- bendahara ----------

function apiAdmin(token) {
  requireAdmin_(token);
  var d = loadData_();
  var r = computeKas(d);
  var S = d.settings;
  var pub = publicPayload_(r, S);
  pub.review = r.review;
  pub.klaim = r.klaim.slice().reverse();
  pub.rumah = d.rumah;
  pub.expectedRows = d.expected;
  pub.kategori = KATEGORI_PENGELUARAN;
  pub.webAppUrl = ScriptApp.getService().getUrl();
  pub.adaApiKey = !!PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  pub.reminderWarga = reminderWargaList_(r, S, pub.webAppUrl);
  pub.settings = { REKENING_INFO: S.REKENING_INFO, NAMA_BENDAHARA: S.NAMA_BENDAHARA, EMAIL_BENDAHARA: S.EMAIL_BENDAHARA,
    TGL_REMINDER_WARGA: S.TGL_REMINDER_WARGA, NAMA_REKENING_BENDAHARA: S.NAMA_REKENING_BENDAHARA };
  pub.tags = d.tags;
  return JSON.stringify(pub);
}

/** Input bendahara: pengeluaran, tombokan, pelunasan utang. */
function apiSubmitBendahara(token, form) {
  requireAdmin_(token);
  var tipe = ['pengeluaran', 'tombokan', 'pelunasan'].indexOf(form.tipe) >= 0 ? form.tipe : null;
  if (!tipe) throw new Error('Tipe tidak dikenal.');
  var nominal = Math.round(+form.nominal);
  if (!(nominal > 0)) throw new Error('Nominal tidak valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.tanggal || '')) throw new Error('Isi tanggal.');
  var id = 'B-' + Utilities.getUuid().slice(0, 8);
  var bukti = saveBukti_(form.bukti, id);
  appendRows_('Klaim', [{ id: id, waktu: nowStr_(), jalur: 'bendahara', tipe: tipe, kavling: '', bulan: [],
    nominal: nominal, tanggal: form.tanggal, kategori: tipe === 'pengeluaran' ? (form.kategori || 'Lain-lain') : '',
    penerima: form.penerima || '', sumber_dana: tipe === 'pengeluaran' && form.sumber_dana === 'pribadi' ? 'pribadi' : 'kas',
    bukti: bukti, catatan: String(form.catatan || '').slice(0, 500) }]);
  log_('input_bendahara', { id: id, tipe: tipe, nominal: nominal });
  clearCache_();
  return { ok: true, id: id };
}

/** Tandai mutasi secara manual (dari antrean review). */
function apiTag(token, tag, opsi) {
  requireAdmin_(token);
  if (!tag || !tag.mutasi_id || !tag.tipe) throw new Error('Tag tidak lengkap.');
  upsert_('Tag', 'mutasi_id', { mutasi_id: tag.mutasi_id, tipe: tag.tipe, kavling: tag.kavling || '', bulan: tag.bulan || [],
    kategori: tag.kategori || '', khusus_id: tag.khusus_id || '', catatan: tag.catatan || '', waktu: nowStr_() });
  if (opsi && opsi.simpanRekening && tag.kavling && opsi.pihak) {
    var r = readTable_('Rumah').filter(function (x) { return x.kavling === tag.kavling; })[0];
    if (r) {
      var list = splitList_(r.rekening, ';');
      if (list.indexOf(opsi.pihak) < 0) list.push(opsi.pihak);
      r.rekening = list;
      updateRow_('Rumah', r._row, r);
    }
  }
  log_('tag', tag);
  clearCache_();
  return { ok: true };
}

function apiHapusTag(token, mutasiId) {
  requireAdmin_(token);
  deleteRowsWhere_('Tag', function (t) { return t.mutasi_id === mutasiId; });
  log_('hapus_tag', mutasiId);
  clearCache_();
  return { ok: true };
}

function apiHapusKlaim(token, id) {
  requireAdmin_(token);
  var k = readTable_('Klaim').filter(function (x) { return x.id === id; })[0];
  if (!k) throw new Error('Klaim tidak ditemukan.');
  k.dihapus = 'TRUE';
  updateRow_('Klaim', k._row, k);
  log_('hapus_klaim', id);
  clearCache_();
  return { ok: true };
}

/** Simpan alias rekening & nomor WA per kavling. */
function apiSimpanRumah(token, row) {
  requireAdmin_(token);
  var r = readTable_('Rumah').filter(function (x) { return x.kavling === row.kavling; })[0];
  if (!r) throw new Error('Kavling tidak ditemukan.');
  r.nama = row.nama || r.nama;
  r.rekening = splitList_(row.rekening, ';');
  r.wa = String(row.wa || '').replace(/[^\d]/g, '').replace(/^0/, '62');
  updateRow_('Rumah', r._row, r);
  clearCache_();
  return { ok: true };
}

function apiSimpanKhusus(token, k) {
  requireAdmin_(token);
  if (!k.nama || !(+k.nominal > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(k.mulai || '')) throw new Error('Isi nama, nominal, dan tanggal mulai.');
  var id = k.id || ('K-' + Utilities.getUuid().slice(0, 6));
  upsert_('IuranKhusus', 'id', { id: id, nama: k.nama, nominal: +k.nominal, mulai: k.mulai, deadline: k.deadline || '',
    aktif: k.aktif === false ? 'FALSE' : 'TRUE' });
  log_('iuran_khusus', k);
  clearCache_();
  return { ok: true, id: id };
}

function apiSimpanSettings(token, s) {
  requireAdmin_(token);
  ['REKENING_INFO', 'NAMA_BENDAHARA', 'EMAIL_BENDAHARA', 'TGL_REMINDER_WARGA', 'NAMA_REKENING_BENDAHARA'].forEach(function (k) {
    if (s[k] !== undefined) setSetting_(k, String(s[k]).trim());
  });
  log_('settings', s);
  clearCache_();
  return { ok: true };
}

function apiGantiPin(token, lama, baru) {
  requireAdmin_(token);
  var S = getSettings_();
  if (hashPin_(String(lama || ''), S.PIN_SALT) !== S.PIN_HASH) throw new Error('PIN lama salah.');
  setPin_(baru);
  return { ok: true };
}

// ---------- import ----------

function apiImportPdf(token, file) {
  requireAdmin_(token);
  if (!file || !file.data) throw new Error('Pilih file PDF.');
  var st = claudeParsePdf_(file.data);
  return stagePreview_({ statements: [st] }, 'pdf');
}

function apiImportJson(token, text) {
  requireAdmin_(token);
  var payload;
  try { payload = JSON.parse(text); } catch (e) { throw new Error('JSON tidak valid: ' + e.message); }
  if (!payload.statements && payload.periode) payload = { statements: [payload] };
  return stagePreview_(payload, 'json');
}

function stagePreview_(payload, sumber) {
  var key = 'imp_' + Utilities.getUuid();
  var json = JSON.stringify({ payload: payload, sumber: sumber });
  if (json.length > 95000) {
    // CacheService maks 100 KB per item; simpan di Drive sementara.
    var f = DriveApp.getFolderById(getSettings_().FOLDER_ID).createFile(key + '.json', json, 'application/json');
    CacheService.getScriptCache().put(key, 'file:' + f.getId(), 3600);
  } else CacheService.getScriptCache().put(key, json, 3600);
  return JSON.stringify({ key: key, preview: previewImport_(payload), extra: {
    rumah: (payload.rumah || []).length, tags: Object.keys(payload.tags || {}).length } });
}

function apiCommitImport(token, key) {
  requireAdmin_(token);
  var raw = CacheService.getScriptCache().get(key);
  if (!raw) throw new Error('Preview kedaluwarsa — upload ulang.');
  if (raw.indexOf('file:') === 0) {
    var f = DriveApp.getFileById(raw.slice(5));
    raw = f.getBlob().getDataAsString();
    f.setTrashed(true);
  }
  var staged = JSON.parse(raw);
  CacheService.getScriptCache().remove(key);
  return commitImport_(staged.payload, staged.sumber);
}

// ---------- laporan ----------

function apiLaporanWa(ym) { return laporanWaText_(computeCached_(), getSettings_(), ym); }

function apiLaporanPdf(token, ym, jenis) {
  requireAdmin_(token);
  return jenis === 'serahterima' ? buatPdfSerahTerima_(ym) : buatPdfBulanan_(ym);
}
