# Kas Eunoia

Buku kas perumahan berbasis Google Sheets + Apps Script. Fiturnya:

- **Warga** konfirmasi bayar lewat web app, tanpa login. Bisa langsung banyak bulan, bukti transfer opsional.
- **Bendahara** (pakai PIN) input pengeluaran, tombokan, dan pelunasan utang, upload mutasi BCA, lalu review hasil matching.
- **Mutasi BCA** dibaca Claude, dari PDF yang diupload di web app atau lewat chat. Semua transaksi otomatis dicocokkan ke kavling dan bulan. Biaya admin dan transfer otomatis tercatat sebagai pengeluaran.
- **Dashboard publik**: saldo (bank / estimasi / proyeksi akhir bulan), utang ke bendahara, grafik, matriks iuran per kavling, iuran khusus (THR, dll).
- **Laporan**: teks WA siap paste, PDF bulanan, PDF serah terima tahunan.
- **Reminder**: email ke bendahara H-2 lalu tiap hari sampai sampah & gaji satpam terbayar. Event Google Calendar bulanan. Tiap tanggal 27, daftar link WhatsApp untuk mengingatkan warga.

Spesifikasi lengkap: [`SPEC.md`](SPEC.md).

## Struktur

```
apps-script/       kode yang dipasang ke Apps Script
  Engine.js        logika matching & alokasi (fungsi murni, dites di Node)
  Db.js            baca/tulis tab spreadsheet
  Setup.js         menu, setup, PIN, trigger, import data lama
  Import.js        import mutasi (Claude API / JSON / doPost)
  Api.js           web app & fungsi yang dipanggil dari browser
  Reports.js       laporan WA/PDF & reminder
  Index.html, Css.html, App.html   tampilan web app
  appsscript.json  manifest
tools/parse_bca.py parser PDF e-Statement BCA → JSON import (butuh pdftotext)
tests/             mock Apps Script + tes server + preview UI lokal
```

## Pemasangan (copy-paste, tanpa install apa pun)

1. Buat **Google Spreadsheet baru**, beri nama "Kas Eunoia".
2. Buka **Extensions → Apps Script**.
3. Untuk setiap file `.js` di `apps-script/`: klik **+ → Script**, beri nama sama tanpa ekstensi (mis. `Engine`), lalu tempel isinya. File `Code.gs` bawaan boleh dihapus.
4. Untuk setiap file `.html`: klik **+ → HTML**, beri nama `Index`, `Css`, dan `App`, lalu tempel isinya.
5. Buka **Project Settings → centang "Show appsscript.json"**, lalu ganti isi `appsscript.json` dengan file dari repo.
6. Kembali ke spreadsheet dan refresh. Menu **Kas Eunoia** akan muncul.
7. **Kas Eunoia → 1. Setup**. Izinkan akses yang diminta: Sheets, Drive (bukti & PDF), Gmail (reminder), Calendar, dan request eksternal (Claude API).
8. **Kas Eunoia → 2. Ganti PIN bendahara**.
9. **Kas Eunoia → 3. Simpan Anthropic API key** (opsional, untuk upload PDF langsung di web app).
10. **Deploy → New deployment → Web app**, dengan *Execute as: Me* dan *Who has access: Anyone*. Salin URL-nya.
11. Buka URL web app → tab **Bendahara** → masukkan PIN → **Import mutasi → B. Tempel JSON**. Tempel file seed (data rumah, tarif, pengeluaran rutin, mutasi Jan–Sep 2026, klasifikasi manual) → **Cek JSON → Simpan ke kas**.
12. Di tab **Bendahara → Pengaturan**, isi nomor WA tiap kavling supaya tombol reminder langsung membuka chat yang tepat.
13. Tutup Google Form lama: **Settings → Responses → Accepting responses: off**, dengan pesan "Konfirmasi iuran sekarang lewat: \<URL web app\>".

> Setiap kali kode diubah: **Deploy → Manage deployments → Edit → Version: New version**, supaya URL tetap sama.

### Pakai `clasp` (opsional)

Butuh Node.js. Installer resmi Node di Mac/Windows biasanya minta password admin. Alternatifnya [nvm](https://github.com/nvm-sh/nvm) (Mac/Linux) atau `fnm`, yang bisa dipasang tanpa admin. Setelah Node ada, clasp tidak perlu diinstall global:

```bash
npx @google/clasp login
npx @google/clasp clone <SCRIPT_ID> --rootDir apps-script   # sekali, untuk membuat .clasp.json
npx @google/clasp push
```

## Import mutasi tiap bulan

- **A. Upload PDF** di web app (Bendahara → Import mutasi). Claude membaca PDF, kamu cek hasilnya, lalu simpan. Statement yang saldo awal + masuk − keluar ≠ saldo akhir otomatis ditolak.
- **B. Lewat chat Claude**: kirim PDF ke Claude, minta "format import Kas Eunoia", lalu tempel JSON-nya di web app. Atau buat token lewat **Kas Eunoia → Buat token import**, dan Claude bisa langsung POST ke URL web app.
- **Lokal**: `python3 tools/parse_bca.py statement.pdf > import.json`.

Import ulang periode yang sama mengganti data periode itu, tidak menggandakan.

## Serah terima bendahara

1. Bendahara lama: **Bendahara → Laporan → PDF serah terima**.
2. Transfer kepemilikan spreadsheet ke bendahara baru (Share → Make owner). Script, folder bukti, dan trigger ikut pindah setelah langkah 3.
3. Bendahara baru: **Kas Eunoia → Setup** (memasang ulang trigger & kalender di akunnya), **Ganti PIN**, **Simpan API key**, deploy ulang web app.
4. Perbarui `NAMA_BENDAHARA`, `EMAIL_BENDAHARA`, `NAMA_REKENING_BENDAHARA`, dan `REKENING_INFO` di Pengaturan.

## Pengembangan

```bash
npm test                                            # tes server di mock Apps Script (data sintetis)
node tests/server.test.js private/seed.json         # tes dengan data asli (tidak di-commit)
CHART_JS=path/chart.umd.js node tests/preview-server.js [seed.json] 8787   # preview UI lokal, PIN 1234
```

Folder `private/` dan semua `*.pdf` di-gitignore: mutasi bank dan nama warga tidak pernah masuk repo.
