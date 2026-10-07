/**
 * Kas Eunoia — mesin klasifikasi, matching, dan alokasi.
 *
 * Fungsi murni: tidak menyentuh SpreadsheetApp, supaya bisa dites di Node
 * (lihat tests/engine.test.js). Semua hasil dihitung ulang dari data mentah
 * setiap kali, jadi tidak ada state tersembunyi yang bisa "nyangkut".
 */

var BULAN_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

var MONTH_WORDS = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2, peb: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, ags: 8, agus: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, septmber: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11, nop: 11,
  des: 12, desember: 12, dec: 12, december: 12
};

var KATEGORI_PENGELUARAN = ['Gaji Satpam', 'Sampah', 'Biaya Bank', 'THR', 'Perbaikan/Maintenance', 'Acara', 'Lain-lain'];

// ---------- util tanggal & teks ----------

function ymOf(dateStr) { return String(dateStr).slice(0, 7); }

function addMonths(ym, n) {
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + '-' + (m < 9 ? '0' : '') + (m + 1);
}

/** Jumlah bulan dari a sampai b, inklusif (a=2026-01, b=2026-03 → 3). */
function monthsInclusive(a, b) {
  return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)) + 1;
}

function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

function lastDayOf(ym) {
  var d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0));
  return d.toISOString().slice(0, 10);
}

function labelBulan(ym) { return BULAN_ID[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4); }

function normName(s) { return String(s || '').toUpperCase().replace(/[^A-Z]/g, ''); }

/** Nama di mutasi BCA terpotong 18 karakter; cocokkan dua arah sebagai prefix. */
function nameMatches(pihak, alias) {
  var a = normName(pihak), b = normName(alias);
  if (!a || !b || Math.min(a.length, b.length) < 5) return false;
  return a.indexOf(b) === 0 || b.indexOf(a) === 0;
}

function round2(x) { return Math.round(x * 100) / 100; }

// ---------- saran dari berita transfer ----------

/**
 * Tebak kavling & bulan dari berita transfer, contoh "Asep kav 9 Des Jan"
 * atau "Iuran Bulan 8,9,10,11,12". Hanya saran — tidak pernah dipakai otomatis.
 */
function parseBerita(berita, tanggal, rumah) {
  var text = String(berita || '').toLowerCase();
  var out = { kavling: '', bulan: [] };
  var km = text.match(/(?:kav(?:ling)?|no)\.?\s*(\d{1,3})/) || text.match(/[a-z](\d{1,2})\b/);
  if (km) {
    var cand = 'Kav. ' + (+km[1]);
    if (rumah.some(function (r) { return r.kavling === cand; })) out.kavling = cand;
  }
  if (!out.kavling) {
    var hits = rumah.filter(function (r) {
      return String(r.nama || '').toLowerCase().replace(/\b(pak|bu|ibu|bapak)\b/g, '')
        .split(/[^a-z]+/).some(function (w) { return w.length >= 4 && text.indexOf(w) >= 0; });
    });
    if (hits.length === 1) out.kavling = hits[0].kavling;
  }
  var nums = [];
  var mb = text.match(/bulan\s+([\d,\s]+)/);
  if (mb) nums = mb[1].split(/[,\s]+/).filter(Boolean).map(Number).filter(function (n) { return n >= 1 && n <= 12; });
  text.split(/[^a-z]+/).forEach(function (w) { if (MONTH_WORDS[w]) nums.push(MONTH_WORDS[w]); });
  // Kata bulan yang menempel ("AgsTSeptOkt", "JuniJuli26").
  if (!nums.length) {
    var re = /(januari|februari|maret|april|juni|juli|agustus|september|oktober|november|desember|jan|feb|mar|apr|mei|jun|jul|ags|agt|agu|aug|sept|sep|okt|oct|nov|des|dec)/g, m;
    while ((m = re.exec(text))) nums.push(MONTH_WORDS[m[1]]);
  }
  var base = ymOf(tanggal), seen = {};
  nums.forEach(function (n) {
    // Pilih tahun yang membuat bulan itu paling dekat ke tanggal transfer (−10..+12 bulan).
    var y = +base.slice(0, 4), best = null;
    [y - 1, y, y + 1].forEach(function (yy) {
      var ym = yy + '-' + (n < 10 ? '0' : '') + n;
      var diff = monthsInclusive(base, ym) - 1;
      if (diff >= -10 && diff <= 12 && (best === null || Math.abs(diff) < Math.abs(best.diff))) best = { ym: ym, diff: diff };
    });
    if (best && !seen[best.ym]) { seen[best.ym] = 1; out.bulan.push(best.ym); }
  });
  out.bulan.sort();
  return out;
}

// ---------- mesin utama ----------

/**
 * @param {Object} d data mentah: settings, rumah, tarif, expected, khusus,
 *   mutasi, saldo, klaim, tags (map mutasi_id → tag), today (yyyy-mm-dd)
 * @return {Object} hasil lengkap untuk dashboard, review, dan reminder
 */
function computeKas(d) {
  var S = d.settings || {};
  var MULAI = S.MULAI_TRACKING || '2026-01';
  var TOL = +S.TOLERANSI_HARI || 7;
  var BENDAHARA = S.NAMA_REKENING_BENDAHARA || '';
  var today = d.today;
  var curYm = ymOf(today);

  var rumah = (d.rumah || []).filter(function (r) { return r.kavling; });
  var aktif = rumah.filter(function (r) { return r.aktif !== false; });
  var tags = d.tags || {};

  /** Tarif per kavling: aturan khusus kavling menang atas aturan umum ('*'). */
  function tarif(kav, ym) {
    var rows = (d.tarif || []).filter(function (t) { return t.kavling === kav || t.kavling === '*'; });
    function latest(list) {
      return list.filter(function (t) { return t.mulai <= ym; })
        .sort(function (a, b) { return a.mulai < b.mulai ? 1 : -1; })[0];
    }
    var best = latest(rows.filter(function (t) { return t.kavling === kav; })) || latest(rows.filter(function (t) { return t.kavling === '*'; }));
    if (!best) best = rows.slice().sort(function (a, b) { return a.mulai < b.mulai ? -1 : 1; })[0];
    return best ? +best.nominal : 0;
  }

  function kavlingOfPihak(pihak) {
    var hit = rumah.filter(function (r) {
      return (r.rekening || []).some(function (a) { return nameMatches(pihak, a); });
    });
    return hit.length === 1 ? hit[0].kavling : '';
  }
  function isBendahara(pihak) { return BENDAHARA && nameMatches(pihak, BENDAHARA); }

  // Status bulan per kavling: paid[kav][ym] = {status, nominal, sumber}
  var paid = {}, kredit = {};
  rumah.forEach(function (r) { paid[r.kavling] = {}; kredit[r.kavling] = 0; });
  var alokasi = [];

  function nextUnpaid(kav, from) {
    var ym = from < MULAI ? MULAI : from;
    for (var i = 0; i < 600; i++) {
      if (!paid[kav][ym]) return ym;
      ym = addMonths(ym, 1);
    }
    return ym;
  }

  /** Alokasikan uang iuran ke bulan-bulan; sisa jadi kredit. Return {bulan, sisa, mismatch}. */
  function allocateIuran(kav, amount, preferred, meta, status) {
    if (!paid[kav]) { paid[kav] = {}; kredit[kav] = 0; }
    var pool = amount + (kredit[kav] || 0);
    kredit[kav] = 0;
    var months = [], mismatch = false;
    var expect = 0;
    (preferred || []).forEach(function (ym) { expect += tarif(kav, ym); });
    if (preferred && preferred.length && Math.abs(expect - amount) > 0.5) mismatch = true;

    var queue = (preferred || []).slice().sort();
    var cursor = null;
    while (true) {
      var ym = null;
      while (queue.length) {
        var q = queue.shift();
        if (!paid[kav][q]) { ym = q; break; }
        mismatch = true; // bulan yang diklaim sudah lunas → geser
      }
      if (!ym) ym = nextUnpaid(kav, cursor || MULAI);
      var t = tarif(kav, ym);
      if (!t || pool + 0.5 < t) break;
      paid[kav][ym] = { status: status, nominal: t, sumber: meta.sumber_id };
      alokasi.push({ sumber: meta.sumber, sumber_id: meta.sumber_id, tanggal: meta.tanggal, tipe: 'iuran',
        kavling: kav, bulan: ym, kategori: 'Iuran', nominal: t, status: status });
      months.push(ym);
      pool -= t;
      cursor = ym;
    }
    pool = round2(pool);
    if (pool > 0.5) {
      kredit[kav] = pool;
      mismatch = true;
    }
    return { bulan: months, sisa: pool, mismatch: mismatch };
  }

  // ---- siapkan klaim ----
  var klaim = (d.klaim || []).map(function (k) {
    var o = {};
    for (var key in k) o[key] = k[key];
    o.bulan = (k.bulan || []).slice().sort();
    o.status = '';
    o.mutasi_id = '';
    return o;
  });
  var klaimById = {};
  klaim.forEach(function (k) { klaimById[k.id] = k; });

  // Prepaid sebelum periode tracking: tandai lunas lebih dulu.
  klaim.filter(function (k) { return k.jalur === 'prepaid'; }).forEach(function (k) {
    k.bulan.forEach(function (ym) {
      if (!paid[k.kavling]) { paid[k.kavling] = {}; kredit[k.kavling] = 0; }
      if (!paid[k.kavling][ym]) {
        paid[k.kavling][ym] = { status: 'prepaid', nominal: tarif(k.kavling, ym), sumber: k.id };
        alokasi.push({ sumber: 'klaim', sumber_id: k.id, tanggal: k.tanggal, tipe: 'iuran', kavling: k.kavling,
          bulan: ym, kategori: 'Iuran', nominal: tarif(k.kavling, ym), status: 'prepaid' });
      }
    });
    k.status = 'prepaid';
  });

  function findKlaim(pred, m) {
    var best = null, bestGap = 1e9;
    klaim.forEach(function (k) {
      if (k.mutasi_id || k.jalur === 'prepaid' || !pred(k)) return;
      if (Math.abs(+k.nominal - m.nominal) > 0.5) return;
      var gap = Math.abs(daysBetween(k.tanggal || m.tanggal, m.tanggal));
      if (gap <= TOL && gap < bestGap) { best = k; bestGap = gap; }
    });
    return best;
  }

  var khusus = (d.khusus || []).filter(function (k) { return k.aktif !== false; });
  var khususPaid = {}; // khusus_id → {kav: nominal}
  khusus.forEach(function (k) { khususPaid[k.id] = {}; });
  function khususFor(m, kav) {
    var hit = null;
    khusus.forEach(function (k) {
      if (hit || Math.abs(+k.nominal - m.nominal) > 0.5) return;
      var end = k.deadline ? String(k.deadline) : '9999-12-31';
      if (m.tanggal < String(k.mulai) || daysBetween(end, m.tanggal) > TOL) return;
      if (kav && khususPaid[k.id][kav]) return;
      hit = k;
    });
    return hit;
  }

  var expected = (d.expected || []).filter(function (e) { return e.aktif !== false; });

  // ---- proses mutasi berurutan ----
  var mutasi = (d.mutasi || []).slice().sort(function (a, b) {
    return a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : String(a.id) < String(b.id) ? -1 : 1;
  });
  var out = [];

  mutasi.forEach(function (m0) {
    var m = {};
    for (var key in m0) m[key] = m0[key];
    m.nominal = +m.nominal;
    m.kelas = 'review'; m.kategori = ''; m.kavling = ''; m.bulan = []; m.cara = 'auto';
    m.alasan = ''; m.saran = null; m.klaim_id = ''; m.flag = '';
    var ket = String(m.keterangan || '').toUpperCase();
    var tag = tags[m.id];

    function asPengeluaran(kategori, catatan) {
      m.kelas = kategori === 'Biaya Bank' ? 'biaya_bank' : 'pengeluaran';
      m.kategori = kategori;
      alokasi.push({ sumber: 'mutasi', sumber_id: m.id, tanggal: m.tanggal, tipe: m.kelas, kavling: '',
        bulan: ymOf(m.tanggal), kategori: kategori, nominal: m.nominal, status: 'bank', catatan: catatan || '' });
    }
    function asIuran(kav, preferred) {
      var r = allocateIuran(kav, m.nominal, preferred, { sumber: 'mutasi', sumber_id: m.id, tanggal: m.tanggal }, 'lunas');
      m.kelas = 'iuran'; m.kategori = 'Iuran'; m.kavling = kav; m.bulan = r.bulan;
      if (r.mismatch) {
        m.flag = 'mismatch';
        m.alasan = r.sisa > 0 ? 'Sisa ' + r.sisa + ' jadi kredit ' + kav : 'Nominal tidak sama dengan klaim bulan';
      }
    }
    function asKhusus(k, kav) {
      m.kelas = 'khusus'; m.kategori = k.nama; m.kavling = kav || ''; m.khusus_id = k.id;
      if (kav) khususPaid[k.id][kav] = (khususPaid[k.id][kav] || 0) + m.nominal;
      alokasi.push({ sumber: 'mutasi', sumber_id: m.id, tanggal: m.tanggal, tipe: 'khusus', kavling: kav || '',
        bulan: ymOf(m.tanggal), kategori: k.nama, nominal: m.nominal, status: 'lunas' });
    }
    function asSimple(kelas, kategori) {
      m.kelas = kelas; m.kategori = kategori;
      alokasi.push({ sumber: 'mutasi', sumber_id: m.id, tanggal: m.tanggal, tipe: kelas, kavling: '',
        bulan: ymOf(m.tanggal), kategori: kategori, nominal: m.nominal, status: 'bank' });
    }

    // 1. Tag manual menang atas semua aturan.
    if (tag && tag.tipe) {
      m.cara = 'tag';
      m.catatan_tag = tag.catatan || '';
      if (tag.tipe === 'iuran' && tag.kavling) asIuran(tag.kavling, tag.bulan && tag.bulan.length ? tag.bulan : null);
      else if (tag.tipe === 'khusus') {
        var kk = khusus.filter(function (k) { return k.id === tag.khusus_id; })[0];
        if (kk) asKhusus(kk, tag.kavling); else asSimple('pemasukan_lain', tag.kategori || 'Iuran khusus');
      }
      else if (tag.tipe === 'pengeluaran') asPengeluaran(tag.kategori || 'Lain-lain', tag.catatan);
      else if (tag.tipe === 'tombokan') asSimple('tombokan', 'Tombokan bendahara');
      else if (tag.tipe === 'pelunasan') asSimple('pelunasan', 'Pelunasan utang ke bendahara');
      else if (tag.tipe === 'pemasukan_lain') asSimple('pemasukan_lain', tag.kategori || 'Pemasukan lain');
      else if (tag.tipe === 'abaikan') { m.kelas = 'abaikan'; m.kategori = 'Diabaikan'; }
      out.push(m);
      return;
    }

    // 2. Biaya & bunga bank.
    if (m.jenis === 'CR' && /^BUNGA\b/.test(ket)) { asSimple('bunga', 'Bunga Bank'); out.push(m); return; }
    if (m.jenis === 'DB' && (/BIAYA ADM/.test(ket) || /BIAYA TXN/.test(ket) || /PAJAK/.test(ket))) {
      asPengeluaran('Biaya Bank', /TXN/.test(ket) ? 'Biaya transfer' : /PAJAK/.test(ket) ? 'Pajak bunga' : 'Biaya admin bulanan');
      out.push(m); return;
    }

    if (m.jenis === 'DB') {
      if (isBendahara(m.pihak)) {
        var kp = findKlaim(function (k) { return k.jalur === 'bendahara' && k.tipe === 'pelunasan'; }, m);
        if (kp) { kp.mutasi_id = m.id; m.klaim_id = kp.id; }
        asSimple('pelunasan', 'Pelunasan utang ke bendahara');
        out.push(m); return;
      }
      // Klaim bendahara (lebih spesifik) dulu, baru pola pengeluaran rutin.
      var kb = findKlaim(function (k) {
        return k.jalur === 'bendahara' && k.tipe === 'pengeluaran' && k.sumber_dana !== 'pribadi';
      }, m);
      if (kb) {
        kb.mutasi_id = m.id; m.klaim_id = kb.id; m.cara = 'klaim';
        asPengeluaran(kb.kategori || 'Lain-lain', kb.catatan);
        out.push(m); return;
      }
      var exp = expected.filter(function (e) { return e.pola && nameMatches(m.pihak, e.pola); })[0];
      if (exp) {
        asPengeluaran(exp.kategori, exp.nama);
        var units = m.nominal / +exp.nominal;
        if (Math.abs(units - Math.round(units)) > 0.01) { m.flag = 'mismatch'; m.alasan = 'Bukan kelipatan ' + exp.nominal; }
        out.push(m); return;
      }
      m.alasan = /DB OTOMATIS/.test(ket) ? 'Auto-debit — cek ke BCA, harusnya tidak ada' : 'Pengeluaran belum dikategorikan';
      m.flag = /DB OTOMATIS/.test(ket) ? 'cek' : '';
      out.push(m); return;
    }

    // CR
    if (isBendahara(m.pihak)) {
      var kt = findKlaim(function (k) { return k.jalur === 'bendahara' && k.tipe === 'tombokan'; }, m);
      if (kt) { kt.mutasi_id = m.id; m.klaim_id = kt.id; m.cara = 'klaim'; asSimple('tombokan', 'Tombokan bendahara'); out.push(m); return; }
      var kw = findKlaim(function (k) { return k.tipe === 'iuran' && k.jalur !== 'bendahara'; }, m);
      if (kw) {
        kw.mutasi_id = m.id; m.klaim_id = kw.id; m.cara = 'klaim';
        asIuran(kw.kavling, kw.bulan);
        m.alasan = 'Diteruskan lewat rekening bendahara';
        out.push(m); return;
      }
      m.alasan = 'Transfer dari rekening bendahara: iuran siapa, atau tombokan?';
      m.saran = parseBerita(m.berita, m.tanggal, rumah);
      out.push(m); return;
    }

    var kav = kavlingOfPihak(m.pihak);
    if (kav) {
      var k1 = khususFor(m, kav);
      var kc = findKlaim(function (k) { return k.kavling === kav && (k.tipe === 'iuran' || k.tipe === 'khusus') && k.jalur !== 'bendahara'; }, m);
      if (kc && kc.tipe === 'khusus') {
        kc.mutasi_id = m.id; m.klaim_id = kc.id; m.cara = 'klaim';
        var kk2 = khusus.filter(function (k) { return k.id === kc.khusus_id; })[0] || k1;
        if (kk2) asKhusus(kk2, kav); else asSimple('pemasukan_lain', 'Iuran khusus');
        out.push(m); return;
      }
      if (kc) {
        kc.mutasi_id = m.id; m.klaim_id = kc.id; m.cara = 'klaim';
        asIuran(kav, kc.bulan);
        out.push(m); return;
      }
      if (k1) { asKhusus(k1, kav); out.push(m); return; }
      // Bulan di berita hanya dipakai kalau totalnya pas; warga sering menulis
      // "satpam feb, sampah maret" untuk satu kali iuran.
      var sar = parseBerita(m.berita, m.tanggal, rumah), pas = 0;
      sar.bulan.forEach(function (ym) { pas += tarif(kav, ym); });
      asIuran(kav, sar.bulan.length && Math.abs(pas - m.nominal) < 0.5 ? sar.bulan : null);
      out.push(m); return;
    }

    // Pengirim tidak dikenal: coba cocokkan ke klaim warga mana pun.
    var ku = findKlaim(function (k) { return (k.tipe === 'iuran' || k.tipe === 'khusus') && k.jalur !== 'bendahara'; }, m);
    if (ku) {
      ku.mutasi_id = m.id; m.klaim_id = ku.id; m.cara = 'klaim';
      if (ku.tipe === 'khusus') {
        var kk3 = khusus.filter(function (k) { return k.id === ku.khusus_id; })[0];
        if (kk3) asKhusus(kk3, ku.kavling); else asSimple('pemasukan_lain', 'Iuran khusus');
      } else asIuran(ku.kavling, ku.bulan);
      m.flag = 'pengirim_baru';
      m.alasan = 'Pengirim "' + m.pihak + '" belum terdaftar — simpan sebagai rekening ' + ku.kavling + '?';
      out.push(m); return;
    }
    var k2 = khususFor(m, '');
    m.saran = parseBerita(m.berita, m.tanggal, rumah);
    if (k2) m.saran.khusus_id = k2.id;
    m.alasan = 'Pengirim tidak dikenal' + (k2 ? ' (nominal sama dengan ' + k2.nama + ')' : '');
    out.push(m);
  });

  // ---- status klaim yang tidak ketemu di bank ----
  var lastSaldo = (d.saldo || []).slice().sort(function (a, b) { return a.periode < b.periode ? -1 : 1; }).pop() || null;
  var bankUntil = lastSaldo ? lastDayOf(lastSaldo.periode) : '0000-00-00';
  var utangPribadi = 0;

  klaim.forEach(function (k) {
    if (k.status) return;
    if (k.mutasi_id) { k.status = 'terverifikasi'; return; }
    if (k.jalur === 'bendahara' && k.tipe === 'pengeluaran' && k.sumber_dana === 'pribadi') {
      k.status = 'pribadi';
      utangPribadi += +k.nominal;
      alokasi.push({ sumber: 'klaim', sumber_id: k.id, tanggal: k.tanggal, tipe: 'pengeluaran', kavling: '',
        bulan: ymOf(k.tanggal), kategori: k.kategori || 'Lain-lain', nominal: +k.nominal, status: 'pribadi' });
      return;
    }
    k.status = (k.tanggal || '') <= bankUntil ? 'tidak_ditemukan' : 'menunggu';
  });

  // Klaim iuran yang menunggu statement: tandai bulan sebagai "klaim" (kuning), tanpa memakai kredit.
  klaim.forEach(function (k) {
    if (k.status !== 'menunggu' || k.tipe !== 'iuran' || !k.kavling) return;
    k.bulan.forEach(function (ym) {
      if (paid[k.kavling] && !paid[k.kavling][ym]) {
        paid[k.kavling][ym] = { status: 'klaim', nominal: tarif(k.kavling, ym), sumber: k.id };
      }
    });
  });

  // ---- pengeluaran rutin (expected) ----
  function expectedStatus(asOfYm, includePending) {
    return expected.map(function (e) {
      var units = 0;
      alokasi.forEach(function (a) {
        if ((a.tipe === 'pengeluaran') && a.kategori === e.kategori && a.status !== 'menunggu') units += a.nominal / +e.nominal;
      });
      if (includePending) {
        klaim.forEach(function (k) {
          if (k.status === 'menunggu' && k.jalur === 'bendahara' && k.tipe === 'pengeluaran' && k.kategori === e.kategori) {
            units += +k.nominal / +e.nominal;
          }
        });
      }
      units = Math.floor(units + 0.01);
      var due = Math.max(0, monthsInclusive(e.mulai, asOfYm));
      return { id: e.id, nama: e.nama, kategori: e.kategori, nominal: +e.nominal, tgl: +e.tgl,
        terbayar: units, jatuhTempo: due, selisih: units - due, lunasBulanIni: units >= due };
    });
  }
  var expNow = expectedStatus(curYm, true);

  // ---- saldo ----
  var pendingIn = 0, pendingOut = 0;
  klaim.forEach(function (k) {
    if (k.status !== 'menunggu') return;
    if (k.jalur === 'bendahara') {
      if (k.tipe === 'tombokan') pendingIn += +k.nominal;
      if (k.tipe === 'pelunasan' || (k.tipe === 'pengeluaran' && k.sumber_dana !== 'pribadi')) pendingOut += +k.nominal;
    } else pendingIn += +k.nominal;
  });
  var konfirmasi = lastSaldo ? +lastSaldo.saldo_akhir : 0;
  var estimasi = round2(konfirmasi + pendingIn - pendingOut);
  var kurangRutin = 0;
  expNow.forEach(function (e) { if (e.selisih < 0) kurangRutin += -e.selisih * e.nominal; });
  var tombokan = 0, pelunasan = 0;
  out.forEach(function (m) {
    if (m.kelas === 'tombokan') tombokan += m.nominal;
    if (m.kelas === 'pelunasan') pelunasan += m.nominal;
  });
  var utang = round2((+S.UTANG_AWAL || 0) + tombokan + utangPribadi - pelunasan);

  // ---- cashflow per bulan (basis tanggal transaksi) ----
  var cf = {};
  out.forEach(function (m) {
    var ym = ymOf(m.tanggal);
    if (!cf[ym]) cf[ym] = { bulan: ym, masuk: 0, keluar: 0, saldo_akhir: null };
    if (m.jenis === 'CR') cf[ym].masuk += m.nominal; else cf[ym].keluar += m.nominal;
  });
  (d.saldo || []).forEach(function (s) {
    if (!cf[s.periode]) cf[s.periode] = { bulan: s.periode, masuk: 0, keluar: 0, saldo_akhir: null };
    cf[s.periode].saldo_akhir = +s.saldo_akhir;
  });
  var cashflow = Object.keys(cf).sort().map(function (k) {
    var c = cf[k]; c.masuk = round2(c.masuk); c.keluar = round2(c.keluar); return c;
  });

  // ---- pengeluaran per kategori per tahun ----
  var pengeluaran = {};
  alokasi.forEach(function (a) {
    if (a.tipe !== 'pengeluaran' && a.tipe !== 'biaya_bank') return;
    var y = String(a.bulan).slice(0, 4);
    pengeluaran[y] = pengeluaran[y] || {};
    pengeluaran[y][a.kategori] = round2((pengeluaran[y][a.kategori] || 0) + a.nominal);
  });
  out.forEach(function (m) {
    if (m.kelas === 'review' && m.jenis === 'DB') {
      var y = m.tanggal.slice(0, 4);
      pengeluaran[y] = pengeluaran[y] || {};
      pengeluaran[y]['Belum dikategorikan'] = round2((pengeluaran[y]['Belum dikategorikan'] || 0) + m.nominal);
    }
  });

  // ---- matriks kavling × bulan ----
  var matriks = {};
  rumah.forEach(function (r) {
    var row = {};
    Object.keys(paid[r.kavling] || {}).forEach(function (ym) { row[ym] = paid[r.kavling][ym]; });
    matriks[r.kavling] = row;
  });
  function tunggakan(kav, uptoYm) {
    var list = [];
    for (var ym = MULAI; ym <= uptoYm; ym = addMonths(ym, 1)) {
      var p = paid[kav] && paid[kav][ym];
      if (!p) list.push({ bulan: ym, nominal: tarif(kav, ym) });
    }
    return list;
  }

  var perKavling = rumah.map(function (r) {
    var t = tunggakan(r.kavling, curYm);
    var lunasSampai = null;
    for (var ym = MULAI; paid[r.kavling] && paid[r.kavling][ym] && paid[r.kavling][ym].status !== 'klaim'; ym = addMonths(ym, 1)) lunasSampai = ym;
    return { kavling: r.kavling, nama: r.nama, aktif: r.aktif !== false, wa: r.wa || '',
      tarifSekarang: tarif(r.kavling, curYm), kredit: round2(kredit[r.kavling] || 0),
      tunggakan: t, totalTunggakan: t.reduce(function (s, x) { return s + x.nominal; }, 0), lunasSampai: lunasSampai };
  });

  // ---- antrean review ----
  var review = [];
  out.forEach(function (m) {
    if (m.kelas === 'review' || m.flag) review.push({ jenis: 'mutasi', id: m.id, tanggal: m.tanggal, nominal: m.nominal,
      arah: m.jenis, pihak: m.pihak, berita: m.berita, keterangan: m.keterangan, alasan: m.alasan, saran: m.saran,
      flag: m.flag || 'review', kelas: m.kelas, kavling: m.kavling });
  });
  klaim.forEach(function (k) {
    if (k.status === 'tidak_ditemukan') review.push({ jenis: 'klaim', id: k.id, tanggal: k.tanggal, nominal: +k.nominal,
      kavling: k.kavling, bulan: k.bulan, alasan: 'Klaim tidak ditemukan di mutasi bank (statement sudah sampai ' + bankUntil + ')',
      flag: 'tidak_ditemukan', jalur: k.jalur, tipe: k.tipe, catatan: k.catatan });
  });

  return {
    today: today, bulanIni: curYm, mulai: MULAI,
    saldo: { terkonfirmasi: konfirmasi, perTanggal: lastSaldo ? bankUntil : null, estimasi: estimasi,
      proyeksi: round2(estimasi - kurangRutin), utangBendahara: utang, masukMenunggu: round2(pendingIn),
      keluarMenunggu: round2(pendingOut), kurangRutin: kurangRutin },
    cashflow: cashflow,
    pengeluaran: pengeluaran,
    matriks: matriks,
    perKavling: perKavling,
    kredit: kredit,
    expected: expNow,
    expectedStatus: expectedStatus,
    mutasi: out,
    klaim: klaim,
    khususPaid: khususPaid,
    alokasi: alokasi,
    review: review,
    bankUntil: bankUntil,
    tarif: tarif,
    tunggakan: tunggakan
  };
}

if (typeof module !== 'undefined') {
  module.exports = { computeKas: computeKas, parseBerita: parseBerita, addMonths: addMonths,
    monthsInclusive: monthsInclusive, nameMatches: nameMatches, labelBulan: labelBulan, lastDayOf: lastDayOf };
}
