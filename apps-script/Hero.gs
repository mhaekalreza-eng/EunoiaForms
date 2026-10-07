/**
 * Kas Eunoia — hero tab Bayar yang dirender di server, supaya rekening, angka, dan tarif
 * tetap tampil walaupun JavaScript mati. JavaScript hanya menambah animasi.
 */

var LOGO_DATA_URI = 'data:image/jpeg;base64,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';

// Foto default (Unsplash License). Ganti lewat Settings → HERO_IMAGE_URL untuk foto sendiri.
var HERO_IMAGE_DEFAULT = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1100&q=70';

/** "BCA 7145127211 a.n. Nama" → {bank, nomor, tampil: "714 512 7211", nama} */
function parseRekening_(info) {
  var m = String(info || '').match(/^\s*([A-Za-z][\w ]*?)\s+(\d[\d\s.-]{5,})\s*(?:a\.?\s*n\.?\s*(.+))?$/i);
  if (!m) return null;
  var nomor = m[2].replace(/\D/g, '');
  var tampil = nomor.length === 10 ? nomor.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3') : nomor.replace(/(\d{4})(?=\d)/g, '$1 ');
  return { bank: m[1].trim(), nomor: nomor, tampil: tampil, nama: (m[3] || '').trim() };
}

var ICON_ = {
  wallet: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4"/><path d="M3 7.5v9A2.5 2.5 0 0 0 5.5 19H20a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5Z"/><circle cx="16.5" cy="14" r="1.2" fill="currentColor"/></svg>',
  house: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="m9 15 2 2 4-4"/></svg>',
  leaf: '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15Z"/><path d="M5 19 13 11"/></svg>'
};

function check_() {
  return '<svg viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="11"/><path d="M6.5 11.5 9.5 14.5 15.5 8"/></svg>';
}

/** HTML hero + statistik + tarif untuk tab Bayar. */
function heroHtml_(appUrl) {
  var S = getSettings_();
  var r = null;
  try { r = computeKas(loadData_()); } catch (e) { log_('hero_gagal', e.message); }
  var rek = parseRekening_(S.REKENING_INFO);
  var foto = S.HERO_IMAGE_URL || HERO_IMAGE_DEFAULT;
  var nama = S.NAMA_KAS || 'Kas Eunoia';

  var h = '<div class="hero-wrap"><div class="lead">';
  h += '<div class="hero-copy"><div class="eyebrow">Eunoia Residence · kas warga</div>' +
    '<h1>Iuran <span class="scribble">' + esc_(nama.replace(/^Kas\s+/i, 'Kas ')) +
    '<svg viewBox="0 0 300 20" preserveAspectRatio="none" aria-hidden="true"><path d="M4 14 C 60 4, 120 18, 180 9 S 270 6, 296 12"/></svg></span></h1>' +
    '<p>Transfer ke rekening kas, lalu kirim konfirmasi di bawah. Semua uang masuk dan keluar tercatat dari mutasi bank dan bisa dilihat semua warga.</p>' +
    '<div class="hero-actions"><a class="btn cta" href="#form-bayar">Konfirmasi pembayaran</a>' +
    '<a class="btn-ghost-link" href="' + esc_(appUrl) + '?tab=ringkasan" data-goto="ringkasan">Lihat laporan kas →</a></div></div>';

  h += '<div class="hero-media"><div class="hero-img"><div class="ph" style="background-image:url(\'' + esc_(foto) + '\')"></div>' +
    '<span class="credit">Foto: Unsplash</span></div>';
  if (rek) {
    h += '<div class="card rek"><div class="rek-head"><p class="rek-bank">' + esc_(rek.bank) + '</p><span class="small muted">rekening kas</span></div>' +
      '<div class="rek-no" id="rek-no">' + esc_(rek.tampil) + '</div>' +
      (rek.nama ? '<div class="small">a.n. ' + esc_(rek.nama) + '</div>' : '') +
      '<button class="btn" type="button" data-copy="' + esc_(rek.nomor) + '" style="margin-top:10px">Salin nomor rekening</button></div>';
  }
  h += '</div></div></div>';

  if (r) {
    var aktif = r.perKavling.filter(function (k) { return k.aktif; });
    var lunas = aktif.filter(function (k) { return !k.tunggakan.length; }).length;
    var tahun = r.bulanIni.slice(0, 4), masuk = 0;
    r.mutasi.forEach(function (m) { if ((m.kelas === 'iuran' || m.kelas === 'khusus') && m.tanggal.slice(0, 4) === tahun) masuk += m.nominal; });
    h += '<div class="stats">' +
      stat_(ICON_.wallet, r.saldo.terkonfirmasi, 'rp', 'Saldo bank' + (r.saldo.perTanggal ? ' per ' + tglId_(r.saldo.perTanggal) : '')) +
      stat_(ICON_.house, lunas, 'n', 'dari ' + aktif.length + ' rumah lunas s/d ' + labelBulan(r.bulanIni)) +
      stat_(ICON_.leaf, masuk, 'rp', 'Iuran masuk ' + tahun) + '</div>';

    var umum = r.tarif('*', r.bulanIni);
    var beda = aktif.filter(function (k) { return k.tarifSekarang !== umum; });
    var items = r.expected.map(function (e) { return esc_(e.nama) + ' ' + rupiah_(e.nominal) + '/bulan'; });
    items.push('Biaya admin & transfer bank tercatat otomatis');
    items.push('Laporan terbuka untuk semua warga');
    h += '<div class="card tarif lift"><div class="eyebrow">Iuran bulanan</div>' +
      '<div class="harga">' + rupiah_(umum) + ' <small>/ rumah / bulan</small></div>' +
      (beda.length ? '<div class="small muted">' + beda.map(function (k) { return esc_(k.kavling) + ': ' + rupiah_(k.tarifSekarang); }).join(' · ') + '</div>' : '') +
      '<ul class="checks">' + items.map(function (t) { return '<li>' + check_() + '<span>' + t + '</span></li>'; }).join('') + '</ul></div>';
  }
  return h;
}

function stat_(icon, value, fmt, label) {
  var shown = fmt === 'rp' ? rupiah_(value) : String(value);
  return '<div class="stat lift">' + icon + '<div class="num"><span class="count" data-to="' + Math.round(value) + '" data-fmt="' + fmt + '">' +
    esc_(shown) + '</span></div><div class="lbl">' + esc_(label) + '</div></div>';
}
