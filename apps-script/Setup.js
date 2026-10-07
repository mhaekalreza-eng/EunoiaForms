/**
 * Kas Eunoia — setup, menu spreadsheet, PIN, trigger, dan import data lama.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kas Eunoia')
    .addItem('1. Setup / perbaiki tab & trigger', 'menuSetup')
    .addItem('2. Ganti PIN bendahara', 'menuGantiPin')
    .addItem('3. Simpan Anthropic API key', 'menuApiKey')
    .addItem('Buat token import (untuk Claude)', 'menuImportToken')
    .addSeparator()
    .addItem('Hitung ulang tab Hasil & Matriks', 'refreshViews')
    .addItem('Import prepaid dari spreadsheet lama', 'menuImportLegacy')
    .addItem('Kirim reminder sekarang (tes)', 'dailyJob')
    .addToUi();
}

function menuSetup() {
  var res = setup();
  SpreadsheetApp.getUi().alert('Setup selesai.\n\n' + res.join('\n') +
    '\n\nLangkah berikut: Ganti PIN, simpan API key, lalu Deploy → New deployment → Web app.');
}

/** Buat tab yang belum ada, isi default Settings, pasang trigger harian. Aman dijalankan ulang. */
function setup() {
  var notes = [];
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); notes.push('Tab dibuat: ' + name); }
    var head = SHEETS[name];
    if (head.length) {
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
      head.forEach(function (h, i) {
        if (TEXT_COLS.indexOf(h) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      });
    }
  });
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);

  var existing = getSettings_();
  SETTINGS_DEFAULT.forEach(function (d) {
    if (!(d[0] in existing)) { appendRows_('Settings', [{ key: d[0], value: d[1], keterangan: d[2] }]); }
  });
  if (!readTable_('Tarif').length) appendRows_('Tarif', [{ kavling: '*', mulai: '2026-01', nominal: 300000 }]);

  var S = getSettings_();
  if (!S.EMAIL_BENDAHARA) setSetting_('EMAIL_BENDAHARA', Session.getEffectiveUser().getEmail());
  if (!S.FOLDER_ID) {
    var folder = DriveApp.createFolder('Kas Eunoia — bukti & laporan');
    setSetting_('FOLDER_ID', folder.getId());
    notes.push('Folder Drive dibuat: ' + folder.getName());
  }

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyJob').timeBased().everyDays(1).atHour(7).inTimezone('Asia/Jakarta').create();
  notes.push('Trigger harian 07:00 WIB dipasang (reminder).');

  try {
    notes.push(ensureCalendarEvent_());
  } catch (e) {
    notes.push('Kalender dilewati: ' + e.message);
  }
  if (!getSettings_().PIN_HASH) notes.push('⚠️ PIN belum diset — jalankan menu "Ganti PIN bendahara".');
  log_('setup', notes);
  return notes;
}

/** Event bulanan tanggal 5 di Google Calendar pemilik, dengan notifikasi H-2 dan hari H. */
function ensureCalendarEvent_() {
  var S = getSettings_();
  var cal = CalendarApp.getDefaultCalendar();
  if (S.KALENDER_EVENT_ID) {
    try { if (cal.getEventSeriesById(S.KALENDER_EVENT_ID)) return 'Event kalender sudah ada.'; } catch (e) { /* dibuat ulang */ }
  }
  var exp = readTable_('Expected').filter(function (e) { return isTrue_(e.aktif); });
  var day = exp.length ? Math.min.apply(null, exp.map(function (e) { return +e.tgl || 5; })) : 5;
  var names = exp.map(function (e) { return e.nama; }).join(' & ') || 'Sampah & Gaji Satpam';
  var now = new Date();
  var first = new Date(now.getFullYear(), now.getMonth() + (now.getDate() > day ? 1 : 0), day, 9, 0, 0);
  var series = cal.createAllDayEventSeries('Kas Eunoia: bayar ' + names, first,
    CalendarApp.newRecurrence().addMonthlyRule().onlyOnMonthDay(day),
    { description: 'Reminder otomatis Kas Eunoia. Email harian berhenti setelah pembayaran terlihat di mutasi atau diinput di menu Bendahara.' });
  series.addPopupReminder(2 * 24 * 60);
  series.addPopupReminder(0);
  setSetting_('KALENDER_EVENT_ID', series.getId());
  return 'Event kalender bulanan tanggal ' + day + ' dibuat.';
}

// ---------- PIN ----------

function hashPin_(pin, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function setPin_(pin) {
  if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN harus 4–8 digit angka.');
  var salt = Utilities.getUuid();
  setSetting_('PIN_SALT', salt);
  setSetting_('PIN_HASH', hashPin_(String(pin), salt));
  log_('ganti_pin', 'PIN diganti');
}

function menuGantiPin() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('PIN bendahara baru', '4–8 digit angka. Bagikan hanya ke bendahara.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  setPin_(r.getResponseText().trim());
  ui.alert('PIN tersimpan.');
}

function menuApiKey() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Anthropic API key', 'Disimpan di Script Properties (tidak terlihat di spreadsheet). Kosongkan untuk menghapus.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var key = r.getResponseText().trim();
  var props = PropertiesService.getScriptProperties();
  if (key) props.setProperty('ANTHROPIC_API_KEY', key); else props.deleteProperty('ANTHROPIC_API_KEY');
  log_('api_key', key ? 'disimpan' : 'dihapus');
  ui.alert(key ? 'API key tersimpan.' : 'API key dihapus.');
}

function menuImportToken() {
  var token = Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('IMPORT_TOKEN', token);
  log_('import_token', 'token baru dibuat');
  SpreadsheetApp.getUi().alert('Token import baru (token lama tidak berlaku):\n\n' + token +
    '\n\nBerikan ke Claude bersama URL web app untuk import otomatis lewat chat.');
}

// ---------- tampilan di spreadsheet ----------

/** Tulis tab Hasil (klasifikasi tiap mutasi) dan Matriks (kavling × bulan) untuk dibaca langsung di Sheets. */
function refreshViews() {
  var r = computeKas(loadData_());
  replaceTable_('Hasil', r.mutasi.slice().reverse().map(function (m) {
    return { tanggal: m.tanggal, arah: m.jenis, nominal: m.nominal, pihak: m.pihak, berita: m.berita, kelas: m.kelas,
      kategori: m.kategori, kavling: m.kavling, bulan: (m.bulan || []).join(','), cara: m.cara, flag: m.flag, alasan: m.alasan };
  }));
  var sh = sheet_('Matriks');
  sh.clear();
  var year = r.bulanIni.slice(0, 4);
  var months = [];
  for (var i = 1; i <= 12; i++) months.push(year + '-' + (i < 10 ? '0' : '') + i);
  var symbol = { lunas: '✓', prepaid: 'P', klaim: '⏳' };
  var rows = [['Kavling', 'Nama'].concat(months.map(labelBulan))];
  r.perKavling.forEach(function (k) {
    rows.push([k.kavling, k.nama].concat(months.map(function (ym) {
      var p = r.matriks[k.kavling][ym];
      if (p) return symbol[p.status] || '✓';
      if (ym < r.mulai) return '';
      return ym <= r.bulanIni ? '✗' : '';
    })));
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  sh.getRange(1, 1, 1, rows[0].length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return 'ok';
}

// ---------- import data lama ----------

function menuImportLegacy() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Import prepaid dari spreadsheet lama',
    'Tempel URL atau ID spreadsheet lama. Hanya baris "Cash In" yang ditransfer sebelum bulan mulai tracking ' +
    'TAPI untuk bulan iuran ≥ bulan mulai yang diimport (status Prepaid). Pembayaran setelah itu dibaca dari mutasi bank.',
    ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = r.getResponseText().match(/[-\w]{25,}/);
  if (!m) { ui.alert('ID spreadsheet tidak valid.'); return; }
  ui.alert(importLegacyPrepaid(m[0]));
}

var EN_MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9,
  october: 10, november: 11, december: 12 };

function legacyMonth_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM');
  var m = String(v).trim().toLowerCase().match(/^([a-z]+)\s+(\d{4})$/);
  if (!m || !EN_MONTHS[m[1]]) return null;
  return m[2] + '-' + (EN_MONTHS[m[1]] < 10 ? '0' : '') + EN_MONTHS[m[1]];
}

function legacyDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Jakarta', 'yyyy-MM-dd');
  var m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : '';
}

function importLegacyPrepaid(spreadsheetId) {
  var S = getSettings_();
  var mulai = S.MULAI_TRACKING || '2026-01';
  var src = SpreadsheetApp.openById(spreadsheetId).getSheetByName('Cash In');
  if (!src) return 'Tab "Cash In" tidak ditemukan.';
  var values = src.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).toLowerCase(); });
  var cKav = head.findIndex(function (h) { return h.indexOf('kavling') >= 0; });
  var cBulan = head.findIndex(function (h) { return h.indexOf('bulan iuran') >= 0; });
  var cNom = head.findIndex(function (h) { return h.indexOf('nominal') >= 0; });
  var cTgl = head.lastIndexOf('tanggal transfer');
  var groups = {};
  var skipped = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var kavM = String(row[cKav]).match(/Kav\.?\s*(\d+)/i);
    if (!kavM) continue;
    var tgl = legacyDate_(row[cTgl]) || legacyDate_(row[0]);
    var ym = legacyMonth_(row[cBulan]);
    if (!ym) { skipped.push('baris ' + (i + 1) + ': bulan "' + row[cBulan] + '"'); continue; }
    if (!tgl || tgl.slice(0, 7) >= mulai || ym < mulai) continue;
    var kav = 'Kav. ' + (+kavM[1]);
    var key = kav + '|' + tgl;
    groups[key] = groups[key] || { kavling: kav, tanggal: tgl, bulan: [], nominal: 0 };
    groups[key].bulan.push(ym);
    groups[key].nominal += +row[cNom] || 0;
  }
  var existing = readTable_('Klaim').filter(function (k) { return k.jalur === 'prepaid'; })
    .map(function (k) { return k.kavling + '|' + k.tanggal; });
  var rows = Object.keys(groups).filter(function (k) { return existing.indexOf(k) < 0; }).map(function (k) {
    var g = groups[k];
    return { id: 'P-' + Utilities.getUuid().slice(0, 8), waktu: nowStr_(), jalur: 'prepaid', tipe: 'iuran', kavling: g.kavling,
      bulan: g.bulan.sort(), nominal: g.nominal, tanggal: g.tanggal, catatan: 'Import dari spreadsheet lama (dibayar sebelum ' + mulai + ')' };
  });
  appendRows_('Klaim', rows);
  clearCache_();
  log_('import_legacy', { rows: rows.length, skipped: skipped });
  return rows.length + ' klaim prepaid diimport.' + (skipped.length ? '\nDilewati: ' + skipped.join('; ') : '') +
    (rows.length ? '\n' + rows.map(function (r) { return r.kavling + ': ' + r.bulan.join(', '); }).join('\n') : '');
}

function nowStr_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd HH:mm:ss'); }
