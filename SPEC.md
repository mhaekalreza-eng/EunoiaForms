# Kas Eunoia — Spec v1

Sistem kas perumahan berbasis Google Sheets + Apps Script web app. Bahasa Indonesia, mobile-first, transparan penuh.

## 1. Prinsip

- **Bank adalah sumber kebenaran.** Klaim warga/bendahara hanya "klaim" sampai dicocokkan dengan mutasi BCA.
- **Satu baris = satu bulan iuran.** Klaim multi-bulan otomatis dipecah (tabel `Alokasi`).
- **Biaya bank otomatis** jadi pengeluaran, tanpa input manual.
- **Tanpa password untuk warga**, PIN untuk menu bendahara, transparansi penuh untuk angka.
- **Siap rotasi bendahara:** semua konfigurasi ada di tab `Settings`, bukan di kode.

## 2. Tab Spreadsheet (database)

| Tab | Isi | Diisi oleh |
|---|---|---|
| `Rumah` | kavling, nama perwakilan, tarif/bulan, berlaku_mulai, daftar nama rekening dikenal (dipisah `;`), aktif | Bendahara (Settings) |
| `Tarif` | riwayat tarif per kavling (contoh: Kav. 22 = 380.000 mulai 2026-01) | Bendahara |
| `Klaim` | semua submission: id, waktu, jalur (`warga`/`bendahara`), kavling, tipe, nominal, tanggal transfer, bulan yang diklaim, bukti (opsional), catatan, status | Web app |
| `Mutasi` | baris mutasi BCA hasil parsing: id, tanggal, keterangan mentah, pengirim/penerima, berita, CR/DB, nominal, saldo, sumber (PDF/paste), batch import | Import (Claude) |
| `Alokasi` | hasil pemecahan: mutasi/klaim → kavling × bulan iuran × nominal, atau → kategori pengeluaran | Script (matcher) + override manual |
| `Pengeluaran` | daftar pengeluaran final (dari mutasi DB + klaim bendahara), kategori, penerima, bulan beban | Script |
| `Expected` | pengeluaran rutin: nama, nominal, tanggal jatuh tempo, kategori, pola penerima (contoh: Sampah 960.000 tgl 5; Gaji Satpam 2.000.000 tgl 5) | Bendahara |
| `IuranKhusus` | kampanye (THR, 17-an): nama, nominal/rumah, deadline | Bendahara |
| `Utang` | utang kas ke bendahara (tombokan) dan pelunasannya | Bendahara |
| `Saldo` | snapshot saldo dari setiap statement (saldo awal/akhir, periode) | Import |
| `Settings` | PIN (hash), email bendahara aktif, nama kas, toleransi matching, tanggal reminder | Bendahara |
| `Log` | audit trail: siapa/kapan/apa (import, override, ubah PIN) | Script |

## 3. Jalur Data Masuk

### 3.1 Warga (tanpa login)
Form web app: pilih kavling → centang bulan (multi, boleh bulan lalu/depan) → nominal terisi otomatis (tarif × jumlah bulan, bisa diubah) → tanggal transfer → bukti (**opsional**) → catatan.
Hasil: 1 baris `Klaim` + N baris `Alokasi` berstatus `Klaim`.

### 3.2 Bendahara (PIN)
- Pengeluaran: kategori, penerima, nominal, tanggal, bulan beban, sumber dana (`Rekening kas` / `Uang pribadi → utang kas`), bukti opsional.
- Tombokan / pelunasan utang.
- Iuran khusus (buat kampanye).
- Tagging manual mutasi yang tidak ter-match.
- Settings & ganti PIN.

### 3.3 Statement BCA (PIN)
Dua jalur, hasil sama (JSON transaksi terstruktur → layar review → Confirm):
- **A. Upload PDF di dashboard** → Apps Script kirim PDF ke Anthropic API (key di Script Properties) → JSON.
- **B. Lewat chat Claude** → Claude parsing → POST ke endpoint `doPost` (dikunci token di Script Properties), atau paste JSON ke kotak import.

Dedup per (tanggal, nominal, CR/DB, keterangan, saldo) supaya import ulang statement yang sama aman.
Validasi: saldo awal + ΣCR − ΣDB = saldo akhir (sesuai ringkasan BCA); kalau tidak cocok, import ditolak.

## 4. Klasifikasi & Matching

Urutan aturan untuk setiap baris mutasi:

1. **Biaya/bunga bank** (otomatis):
   - `BIAYA ADM` → Pengeluaran `Biaya Bank` (admin bulanan)
   - `BI-FAST DB … BIAYA TXN` → Pengeluaran `Biaya Bank` (biaya transfer), ditautkan ke transfer induknya
   - `BUNGA` → Pemasukan `Bunga Bank`
   - `PAJAK BUNGA` → Pengeluaran `Biaya Bank`
   - `DB OTOMATIS` → **flag** (perlu dicek manual)
2. **DB ke penerima rutin** (pola di `Expected`) → kategori rutin (contoh: `BUDI ADI IRAWAN` → Sampah; `RACHDIAZ` DB → Gaji Satpam). Nominal kelipatan (4.000.000 = 2× gaji) → dialokasikan ke beberapa bulan.
3. **CR dari pengirim dikenal** (`Rumah.nama_rekening`) →
   - cari klaim kavling itu dengan nominal sama dalam ±7 hari → ✅ `Match`, alokasi ikut klaim;
   - tidak ada klaim → buat alokasi otomatis ke **bulan tertunggak paling lama** dulu, sisa ke bulan berikutnya;
   - nominal bukan kelipatan tarif → ⚠️ `Mismatch`, sisa jadi **kredit** kavling.
4. **CR dengan berita yang menyebut kavling/nama** (contoh: transfer terusan dari rekening bendahara "Asep kav 9 Des Jan") → usulan alokasi, perlu konfirmasi.
5. **Iuran khusus aktif + nominal = nominal kampanye** (contoh: 180.000 saat THR) → alokasi ke kampanye.
6. Sisanya → ❓ `Belum dikenali` (contoh: GoPay "DOMPET ANAK BANGSA"), bendahara tag manual; nama pengirim bisa langsung ditambahkan ke `Rumah` supaya bulan depan otomatis.

Status klaim: ✅ Terverifikasi bank · ⏳ Klaim (belum ada statement) · ⚠️ Mismatch · ❌ Tidak ditemukan di bank (setelah statement periode itu masuk).

Iuran bulan yang dibayar sebelum 2026 (prepaid) diimport sebagai `Lunas (prepaid < 2026)`.

## 5. Dashboard (publik, tanpa login)

- **Saldo** (toggle):
  - Terkonfirmasi — saldo akhir statement terakhir, "per DD/MM/YYYY"
  - Estimasi — terkonfirmasi + klaim masuk − klaim keluar setelah tanggal statement
  - Proyeksi akhir bulan — estimasi − expected yang belum dibayar bulan ini
  - Ditampilkan terpisah: **Utang kas ke bendahara**
- **Grafik cashflow** — bar masuk vs keluar per bulan (basis tanggal transaksi) + garis saldo
- **Matriks per kavling** — kavling × bulan iuran, hijau/kuning/merah/abu (prepaid)
- **Breakdown pengeluaran** per kategori
- **Daftar transaksi** dengan status verifikasi (bukti foto hanya untuk bendahara)
- Filter tahun

## 6. Laporan

- Tombol **Copy laporan WA** (ringkasan teks bulanan)
- **PDF** satu halaman per bulan
- **Laporan serah terima** tahunan (saldo, utang, tunggakan per kavling, daftar pengeluaran)

## 7. Reminder

- **Warga — tanggal 27:** dashboard bendahara menampilkan kavling yang belum lunas bulan depan + tombol WhatsApp (`wa.me`) dengan pesan terisi; bendahara klik kirim.
- **Bendahara — tanggal 3 & 5, lalu harian** sampai expected (Sampah, Gaji Satpam) ter-match di mutasi atau ada klaim bendahara: email + event Google Calendar.
- **Bendahara — import statement:** email tiap awal bulan kalau statement bulan lalu belum masuk.

## 8. Teknis

- Container-bound Apps Script di spreadsheet baru "Kas Eunoia", milik akun bendahara saat ini.
- Web app: *Execute as: Me*, *Who has access: Anyone*.
- Script Properties: `ANTHROPIC_API_KEY`, `IMPORT_TOKEN`.
- PIN disimpan sebagai hash (SHA-256 + salt) di `Settings`; sesi bendahara pakai token sementara.
- Serah terima: transfer kepemilikan spreadsheet → bendahara baru jalankan menu **Setup** (buat ulang trigger, ganti PIN, ganti API key/email).
- Deploy: copy-paste file ke editor Apps Script (tanpa install), atau `clasp`.
- Data mutasi/PDF tidak pernah di-commit ke repo (`private/` di-gitignore).
