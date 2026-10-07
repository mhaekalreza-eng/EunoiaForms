/**
 * Kas Eunoia — laporan (teks WA, PDF bulanan, PDF serah terima) dan reminder.
 */

function rupiah_(n) {
  var s = Math.round(+n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-Rp ' + s.replace('-', '') : 'Rp ' + s);
}

function tglId_(iso) {
  if (!iso) return '-';
  var p = iso.split('-');
  return +p[2] + ' ' + BULAN_ID[+p[1] - 1] + ' ' + p[0];
}

function ringkasBulan_(list) {
  if (!list.length) return '';
  if (list.length === 1) return labelBulan(list[0]);
  return labelBulan(list[0]) + '–' + labelBulan(list[list.length - 1]) + ' (' + list.length + ' bln)';
}

/** Angka-angka satu bulan untuk laporan. */
function dataBulan_(r, ym) {
  var masuk = 0, keluar = 0, kat = {}, iuran = [];
  r.mutasi.forEach(function (m) {
    if (m.tanggal.slice(0, 7) !== ym) return;
    if (m.jenis === 'CR') masuk += m.nominal; else keluar += m.nominal;
    if (m.jenis === 'DB') {
      var k = m.kelas === 'review' ? 'Belum dikategorikan' : m.kelas === 'pelunasan' ? 'Pelunasan utang bendahara' : m.kategori;
      kat[k] = (kat[k] || 0) + m.nominal;
    }
    if (m.kelas === 'iuran') iuran.push(m.kavling + ' ' + ringkasBulan_(m.bulan));
    if (m.kelas === 'khusus') iuran.push(m.kavling + ' ' + m.kategori);
  });
  var saldoRow = r.cashflow.filter(function (c) { return c.bulan === ym; })[0];
  return { masuk: masuk, keluar: keluar, kategori: kat, iuran: iuran, saldoAkhir: saldoRow ? saldoRow.saldo_akhir : null };
}

function laporanWaText_(r, S, ym) {
  ym = ym || (r.bankUntil && r.bankUntil.slice(0, 7)) || r.bulanIni;
  var b = dataBulan_(r, ym);
  var lines = [];
  lines.push('*Laporan ' + (S.NAMA_KAS || 'Kas Eunoia') + ' — ' + labelBulan(ym) + '*');
  lines.push('');
  lines.push('💰 Saldo bank per ' + tglId_(r.saldo.perTanggal) + ': *' + rupiah_(r.saldo.terkonfirmasi) + '*');
  if (Math.abs(r.saldo.estimasi - r.saldo.terkonfirmasi) > 0.5) lines.push('   Estimasi termasuk klaim terbaru: ' + rupiah_(r.saldo.estimasi));
  if (r.saldo.utangBendahara) lines.push('   Utang kas ke bendahara: ' + rupiah_(r.saldo.utangBendahara));
  lines.push('');
  lines.push('📥 Masuk ' + labelBulan(ym) + ': ' + rupiah_(b.masuk));
  if (b.iuran.length) lines.push('   ' + b.iuran.join('; '));
  lines.push('📤 Keluar ' + labelBulan(ym) + ': ' + rupiah_(b.keluar));
  Object.keys(b.kategori).sort(function (a, c) { return b.kategori[c] - b.kategori[a]; }).forEach(function (k) {
    lines.push('   • ' + k + ': ' + rupiah_(b.kategori[k]));
  });
  var nunggak = r.perKavling.filter(function (k) { return k.aktif && k.tunggakan.length; });
  lines.push('');
  if (nunggak.length) {
    lines.push('⏳ Belum lunas s/d ' + labelBulan(r.bulanIni) + ':');
    nunggak.forEach(function (k) {
      lines.push('   • ' + k.kavling + ' (' + k.nama + '): ' + k.tunggakan.length + ' bln, ' + rupiah_(k.totalTunggakan));
    });
  } else lines.push('✅ Semua kavling lunas s/d ' + labelBulan(r.bulanIni));
  var url = ScriptApp.getService().getUrl();
  if (url) { lines.push(''); lines.push('Laporan lengkap: ' + url + '?tab=ringkasan'); lines.push('Konfirmasi bayar: ' + url); }
  return lines.join('\n');
}

// ---------- PDF ----------

function pdfShell_(title, body) {
  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:10pt;color:#0b0b0b;margin:24px}' +
    'h1{font-size:16pt;margin:0 0 4px}h2{font-size:12pt;margin:18px 0 6px;border-bottom:1px solid #c3c2b7;padding-bottom:2px}' +
    '.muted{color:#52514e}table{border-collapse:collapse;width:100%}td,th{padding:3px 6px;border-bottom:1px solid #e1e0d9;text-align:left}' +
    'th{font-weight:bold}td.n,th.n{text-align:right}.tiles td{border:1px solid #e1e0d9;padding:8px}.big{font-size:14pt;font-weight:bold}' +
    '.mx td{text-align:center;font-size:9pt;padding:2px}.mx td:first-child{text-align:left}' +
    '</style></head><body><h1>' + title + '</h1>' + body + '</body></html>';
}

function esc_(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

function savePdf_(html, name) {
  var S = getSettings_();
  var folder = DriveApp.getFolderById(S.FOLDER_ID);
  var old = folder.getFilesByName(name);
  while (old.hasNext()) old.next().setTrashed(true);
  var pdf = Utilities.newBlob(html, 'text/html', 'x.html').getAs('application/pdf').setName(name);
  var file = folder.createFile(pdf);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: file.getUrl(), nama: name };
}

function matriksHtml_(r, year) {
  var months = [];
  for (var i = 1; i <= 12; i++) months.push(year + '-' + (i < 10 ? '0' : '') + i);
  var sym = { lunas: '✓', prepaid: 'P', klaim: '…' };
  var h = '<table class="mx"><tr><th>Kavling</th>' + months.map(function (m) { return '<th>' + BULAN_ID[+m.slice(5) - 1] + '</th>'; }).join('') + '</tr>';
  r.perKavling.forEach(function (k) {
    h += '<tr><td>' + esc_(k.kavling + ' ' + k.nama) + '</td>' + months.map(function (ym) {
      var p = r.matriks[k.kavling][ym];
      return '<td>' + (p ? sym[p.status] || '✓' : (ym >= r.mulai && ym <= r.bulanIni ? '✗' : '')) + '</td>';
    }).join('') + '</tr>';
  });
  return h + '</table><p class="muted">✓ lunas (terverifikasi bank) · P dibayar sebelum periode tracking · … klaim menunggu statement · ✗ belum bayar</p>';
}

function buatPdfBulanan_(ym) {
  var r = computeCached_(), S = getSettings_();
  ym = ym || (r.bankUntil && r.bankUntil.slice(0, 7)) || r.bulanIni;
  var b = dataBulan_(r, ym);
  var body = '<p class="muted">Dibuat ' + tglId_(r.today) + (S.NAMA_BENDAHARA ? ' oleh ' + esc_(S.NAMA_BENDAHARA) + ' (bendahara)' : '') + '</p>' +
    '<table class="tiles"><tr><td>Saldo bank akhir ' + labelBulan(ym) + '<div class="big">' + (b.saldoAkhir === null ? '-' : rupiah_(b.saldoAkhir)) + '</div></td>' +
    '<td>Masuk<div class="big">' + rupiah_(b.masuk) + '</div></td><td>Keluar<div class="big">' + rupiah_(b.keluar) + '</div></td>' +
    '<td>Utang kas ke bendahara<div class="big">' + rupiah_(r.saldo.utangBendahara) + '</div></td></tr></table>' +
    '<h2>Pengeluaran ' + labelBulan(ym) + '</h2><table>' + Object.keys(b.kategori).map(function (k) {
      return '<tr><td>' + esc_(k) + '</td><td class="n">' + rupiah_(b.kategori[k]) + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Transaksi bank ' + labelBulan(ym) + '</h2><table><tr><th>Tgl</th><th>Pihak</th><th>Keterangan</th><th class="n">Masuk</th><th class="n">Keluar</th></tr>' +
    r.mutasi.filter(function (m) { return m.tanggal.slice(0, 7) === ym; }).map(function (m) {
      var ket = m.kelas === 'iuran' ? 'Iuran ' + m.kavling + ' ' + ringkasBulan_(m.bulan) : (m.kategori || m.alasan || '');
      return '<tr><td>' + m.tanggal.slice(8) + '</td><td>' + esc_(m.pihak) + '</td><td>' + esc_(ket) + '</td><td class="n">' +
        (m.jenis === 'CR' ? rupiah_(m.nominal) : '') + '</td><td class="n">' + (m.jenis === 'DB' ? rupiah_(m.nominal) : '') + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Status iuran ' + ym.slice(0, 4) + '</h2>' + matriksHtml_(r, ym.slice(0, 4));
  return savePdf_(pdfShell_('Laporan ' + esc_(S.NAMA_KAS || 'Kas Eunoia') + ' — ' + labelBulan(ym), body),
    'Laporan ' + (S.NAMA_KAS || 'Kas Eunoia') + ' ' + ym + '.pdf');
}

/** Ringkasan tahunan untuk serah terima bendahara. */
function buatPdfSerahTerima_(ym) {
  var r = computeCached_(), S = getSettings_();
  var year = (ym || r.bulanIni).slice(0, 4);
  var masuk = 0, keluar = 0;
  r.cashflow.forEach(function (c) { if (c.bulan.slice(0, 4) === year) { masuk += c.masuk; keluar += c.keluar; } });
  var peng = r.pengeluaran[year] || {};
  var body = '<p class="muted">Per ' + tglId_(r.today) + '. Saldo bank terkonfirmasi per ' + tglId_(r.saldo.perTanggal) + '.</p>' +
    '<table class="tiles"><tr><td>Saldo bank<div class="big">' + rupiah_(r.saldo.terkonfirmasi) + '</div></td>' +
    '<td>Utang kas ke bendahara<div class="big">' + rupiah_(r.saldo.utangBendahara) + '</div></td>' +
    '<td>Saldo bersih<div class="big">' + rupiah_(r.saldo.terkonfirmasi - r.saldo.utangBendahara) + '</div></td></tr>' +
    '<tr><td>Masuk ' + year + '<div class="big">' + rupiah_(masuk) + '</div></td><td>Keluar ' + year + '<div class="big">' + rupiah_(keluar) + '</div></td>' +
    '<td>Klaim belum terverifikasi<div class="big">' + rupiah_(r.saldo.masukMenunggu) + '</div></td></tr></table>' +
    '<h2>Pengeluaran ' + year + ' per kategori</h2><table>' + Object.keys(peng).sort(function (a, b) { return peng[b] - peng[a]; }).map(function (k) {
      return '<tr><td>' + esc_(k) + '</td><td class="n">' + rupiah_(peng[k]) + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Arus kas bulanan</h2><table><tr><th>Bulan</th><th class="n">Masuk</th><th class="n">Keluar</th><th class="n">Saldo akhir</th></tr>' +
    r.cashflow.filter(function (c) { return c.bulan.slice(0, 4) === year; }).map(function (c) {
      return '<tr><td>' + labelBulan(c.bulan) + '</td><td class="n">' + rupiah_(c.masuk) + '</td><td class="n">' + rupiah_(c.keluar) +
        '</td><td class="n">' + (c.saldo_akhir === null ? '-' : rupiah_(c.saldo_akhir)) + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Tunggakan & kredit per kavling</h2><table><tr><th>Kavling</th><th>Lunas s/d</th><th class="n">Tunggakan</th><th class="n">Kredit</th></tr>' +
    r.perKavling.map(function (k) {
      return '<tr><td>' + esc_(k.kavling + ' ' + k.nama) + '</td><td>' + (k.lunasSampai ? labelBulan(k.lunasSampai) : '-') + '</td><td class="n">' +
        (k.tunggakan.length ? k.tunggakan.length + ' bln · ' + rupiah_(k.totalTunggakan) : '-') + '</td><td class="n">' + (k.kredit ? rupiah_(k.kredit) : '-') + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Pengeluaran rutin</h2><table>' + r.expected.map(function (e) {
      return '<tr><td>' + esc_(e.nama) + ' (' + rupiah_(e.nominal) + '/bln, tgl ' + e.tgl + ')</td><td class="n">' +
        (e.selisih >= 0 ? 'lunas' + (e.selisih > 0 ? ', lebih ' + e.selisih + ' bln' : '') : 'kurang ' + (-e.selisih) + ' bln') + '</td></tr>';
    }).join('') + '</table>' +
    '<h2>Status iuran ' + year + '</h2>' + matriksHtml_(r, year) +
    '<h2>Yang masih perlu dicek</h2><p>' + (r.review.length ? r.review.length + ' item di antrean review (lihat menu Bendahara → Review).' : 'Tidak ada.') + '</p>' +
    '<h2>Serah terima</h2><p>1. Transfer kepemilikan spreadsheet "Kas Eunoia" ke bendahara baru (Share → jadikan Owner).<br>' +
    '2. Bendahara baru: menu Kas Eunoia → Setup, Ganti PIN, Simpan Anthropic API key, lalu Deploy ulang web app.<br>' +
    '3. Update Settings: NAMA_BENDAHARA, EMAIL_BENDAHARA, NAMA_REKENING_BENDAHARA, REKENING_INFO.</p>';
  return savePdf_(pdfShell_('Laporan Serah Terima ' + esc_(S.NAMA_KAS || 'Kas Eunoia') + ' ' + year, body),
    'Serah Terima ' + (S.NAMA_KAS || 'Kas Eunoia') + ' ' + year + '.pdf');
}

// ---------- reminder ----------

function reminderWargaList_(r, S, url) {
  var next = addMonths(r.bulanIni, 1);
  return r.perKavling.filter(function (k) { return k.aktif; }).map(function (k) {
    var due = r.tunggakan(k.kavling, next);
    var kredit = k.kredit || 0;
    var total = due.reduce(function (s, x) { return s + x.nominal; }, 0) - kredit;
    var msg = 'Halo ' + k.nama + ' (' + k.kavling + '), pengingat iuran ' + (S.NAMA_KAS || 'Kas Eunoia') + ' 🙏\n';
    if (due.length) {
      msg += 'Belum tercatat: ' + due.map(function (x) { return labelBulan(x.bulan); }).join(', ') + '\nTotal: ' + rupiah_(total) + '\n';
    }
    if (kredit) msg += '(sudah dipotong kredit ' + rupiah_(kredit) + ')\n';
    if (S.REKENING_INFO) msg += 'Transfer ke ' + S.REKENING_INFO + '\n';
    if (url) msg += 'Lalu konfirmasi di ' + url + '\n';
    msg += 'Kalau sudah bayar tapi masih tercatat belum, kabari ya. Terima kasih!';
    return { kavling: k.kavling, nama: k.nama, wa: k.wa || '', bulan: due.map(function (x) { return x.bulan; }), total: total,
      perlu: due.length > 0, link: 'https://wa.me/' + (k.wa || '') + '?text=' + encodeURIComponent(msg), pesan: msg };
  });
}

function notifyBendahara_(subject, body) {
  try {
    var S = getSettings_();
    var to = S.EMAIL_BENDAHARA || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, '[' + (S.NAMA_KAS || 'Kas Eunoia') + '] ' + subject, body + '\n\n' + ScriptApp.getService().getUrl());
  } catch (e) { log_('email_gagal', e.message); }
}

/** Trigger harian 07:00 WIB. */
function dailyJob() {
  var S = getSettings_();
  var r = computeKas(loadData_());
  var day = +r.today.slice(8, 10);
  var url = ScriptApp.getService().getUrl();
  var sent = [];

  // Pengeluaran rutin: H-2, lalu tiap hari sejak jatuh tempo sampai terlihat lunas.
  var belum = r.expected.filter(function (e) { return !e.lunasBulanIni && (day === e.tgl - 2 || day >= e.tgl); });
  if (belum.length) {
    var subj = (belum.some(function (e) { return day >= e.tgl; }) ? 'Belum dibayar: ' : 'Jatuh tempo ' + belum[0].tgl + ' ' + labelBulan(r.bulanIni) + ': ') +
      belum.map(function (e) { return e.nama; }).join(' & ');
    notifyBendahara_(subj, belum.map(function (e) {
      return '• ' + e.nama + ' ' + rupiah_(e.nominal) + ' — tercatat ' + e.terbayar + ' dari ' + e.jatuhTempo + ' bulan (kurang ' + (-e.selisih) + ').';
    }).join('\n') + '\n\nEmail ini berhenti setelah pembayaran terlihat di mutasi yang diimport atau diinput di menu Bendahara → Input.');
    sent.push(subj);
  }

  // Reminder warga tanggal 27: kirim daftar WA ke bendahara.
  if (day === (+S.TGL_REMINDER_WARGA || 27)) {
    var list = reminderWargaList_(r, S, url).filter(function (x) { return x.perlu; });
    notifyBendahara_('Reminder iuran warga (' + list.length + ' kavling)',
      (list.length ? 'Kavling yang belum lunas s/d ' + labelBulan(addMonths(r.bulanIni, 1)) + ':\n' +
        list.map(function (x) { return '• ' + x.kavling + ' ' + x.nama + ': ' + rupiah_(x.total) + '\n  ' + x.link; }).join('\n') +
        '\n\nKlik link untuk membuka WhatsApp dengan pesan yang sudah terisi.'
        : 'Semua kavling sudah lunas bulan depan. 🎉'));
    sent.push('reminder warga');
  }

  // Statement bulan lalu belum diimport.
  var lalu = addMonths(r.bulanIni, -1);
  if (r.bankUntil.slice(0, 7) < lalu && (day === 2 || day % 3 === 0)) {
    notifyBendahara_('Upload mutasi ' + labelBulan(lalu), 'Statement BCA terakhir yang masuk: ' + (r.saldo.perTanggal || 'belum ada') +
      '.\nUpload PDF e-Statement ' + labelBulan(lalu) + ' di menu Bendahara → Import.');
    sent.push('upload statement');
  }
  log_('daily', sent.length ? sent : 'tidak ada reminder');
  return sent;
}
