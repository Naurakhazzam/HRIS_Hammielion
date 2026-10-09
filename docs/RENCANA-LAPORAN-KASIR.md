# Rencana: Laporan Kasir (Settlement Shift) + Verifikasi Finance

Dokumen kerja hasil diskusi dengan user (9 Oktober 2026). Dikerjakan **per tahap**. Cara pakai:

> Baca `hris-app/docs/RENCANA-LAPORAN-KASIR.md`, kerjakan Tahap N.

Setiap tahap selesai: centang checklist di **Status**, catat nomor migrasi & commit, isi CHANGELOG,
lalu push (user selalu tes di app yang sudah di-deploy, bukan localhost). Bahasa ke user: **Bahasa
Indonesia, sederhana** — user bukan programmer.

**Jangan mulai tahap yang masih punya pertanyaan terbuka di bagian 7 tanpa konfirmasi user.**

Rencana ini sekaligus menjawab **Tahap 5 (DITUNDA) di `RENCANA-NOTA-CABANG.md`** — uang pengiriman
terverifikasi masuk Kas Masuk otomatis (lihat Tahap 4 di bawah).

---

## Status

- [ ] **Tahap 1** — Form Laporan Kasir (sisi kasir)
- [ ] **Tahap 2** — Verifikasi finance → Kas Masuk otomatis
- [ ] **Tahap 3** — "Omzet Harian" diganti nama jadi **Input Kasir Darurat** + peringatan dobel
- [ ] **Tahap 4** — Uang pengiriman terverifikasi → Kas Masuk toko asal (tanggal nota)
- [ ] **Tahap 5** — Pelunasan Buku Piutang → Kas Masuk (tanggal lunas)
- [ ] **Tahap 6** — Tanda bantu finance (piutang vs nota kiriman, kiriman gagal setelah lapor)

---

## 1. Masalah yang mau diselesaikan

Sekarang setiap shift toko melaporkan omzet lewat **grup WA**, lalu finance **mengetik ulang** ke
Kas Masuk (`keuangan/kas-masuk`). Makan waktu, rawan salah ketik. Contoh laporan WA asli:

```
settle shift 1
Tanggal : 08-10-2026
Laporan omset :
cash : Rp. 10.990.300
trf qris : Rp. 1.789.500
piutang : Rp. 5.605.308
total omset : 16.958.638        ← tidak cocok dgn penjumlahan (18.385.108) — contoh salah ketik
pengeluaran :
- konsumsi : 100.000
- kertas termal 10 : 80.000
keterangan : (+) 770
nama admin yang melaporkan : syifa (sistem lama+sistem baru)
```

Tujuan: kasir mengisi laporan **sendiri di aplikasi** (bentuknya sama dengan WA + foto struk),
finance cukup **memverifikasi**, dan Kas Masuk terisi otomatis.

---

## 2. Kondisi sekarang (dicek ke kode & database, 9 Okt 2026)

- `fin_cash_in` hanya bisa diinput role `owner/hr/finance/supervisor`. **Tidak ada user ber-role
  `supervisor`**; semua orang toko ber-role `employee` → praktis hanya finance yang input.
  Kolom: `amount` (omzet), `expense_amount`, `cash_adjustment` (selisih kasir ±), `payment_method`,
  `account_id`, `status` (`pending/approved/rejected/revisi`). **Belum ada kolom sumber.**
- Uang yang diverifikasi di tab **Uang Pengiriman** (`components/VerifikasiUangPengiriman.tsx`,
  RPC `verify_visit_payment` / `verify_nota_payment`) **tidak masuk `fin_cash_in`** — hanya ada di
  Laporan Pengiriman & Buku Piutang. Pelunasan Buku Piutang (`record_receivable_payment` →
  `fin_receivable_payments`) juga **tidak masuk `fin_cash_in`**.
- `logistics_central_loadings.origin_branch_id` + `nota_amount` = nota kiriman per cabang asal.
  Nota Gudang ada di `logistics_delivery_notes` (`note_date`, `amount`).
- Karyawan aktif per cabang: Toko Pusat (3 Kasir, 2 Pramuniaga, 1 Groomer), Toko Depan (2 Kasir),
  Raja Petshop (1 Kasir, 1 Groomer), Markas Petshop (1 Kepala Toko), Gudang (Driver, Helper,
  Kepala Gudang), Back Office (Finance, Marketing, Owner).
- Foto: bucket storage yang sudah ada `logistics-photos`, `documents`, dll.
- Toko sedang **peralihan 2 sistem POS** (lama + baru) → satu laporan bisa punya 2 struk.

### Struk settlement POS (bagian yang terlihat di contoh PDF — PDF terpotong, jangan berasumsi soal sisanya)
```
PENJUALAN: Tunai · Non-Tunai · Diskon (info, sudah terpotong) · Hutang → OMZET = Tunai + Non-Tunai + Hutang
RINCIAN PER KASIR: Tunai · Non-Tunai · Hutang · Pengeluaran → Kas Bersih = Tunai − Pengeluaran
TOTAL PER METODE: QRIS ...
PELUNASAN PIUTANG: pelanggan · tgl · metode · nominal  (terpisah, tidak ikut OMZET)
```
Satu shift bisa berisi lebih dari 1 kasir (contoh: irma + Iqbal), tapi ditutup oleh 1 orang.

---

## 3. Aturan yang SUDAH DISEPAKATI

### Siapa & kapan
1. Yang boleh mengisi: **semua karyawan di cabang toko** (Toko Pusat, Toko Depan, Raja Petshop,
   Markas Petshop) **kecuali** jabatan Driver, Kepala Gudang, Helper.
2. **Gudang** diisi oleh **Back Office** (owner/hr/finance). Logikanya sama dengan toko.
3. **Maksimal 2 laporan per cabang per hari** (Shift 1 / Shift 2). Kalau hanya 1 shift → 1 laporan.
4. Diisi oleh **yang menutup kasir** (= pelapor, otomatis dari akun login). Selisih kasir/setoran
   shift itu dibebankan ke **pelapor**.
5. Settlement shift 2 berisi **transaksi shift 2 saja** (bukan kumulatif).

### Isi laporan — SEDERHANA, sama dengan format WA
6. Tanggal, Shift, **foto struk settlement (boleh lebih dari 1** — masa peralihan 2 POS).
7. **Cash**, **QRIS/Transfer** (bisa tambah metode: Trf BCA, dll), **Piutang** → **Total omzet
   dihitung otomatis** (tidak diketik).
8. **Pengeluaran**: daftar nama + nominal (bisa tambah baris).
9. **Selisih kasir**: Tidak ada / (+) / (−) + nominal. **Keterangan** bebas (mis. uang titipan
   pelunasan konsumen ditulis di sini).
10. Kasir **tidak** mengisi pelunasan piutang, nota kiriman, nama konsumen tempo, dll. Semua
    pengecekan tambahan ada di **sisi finance**.

### Arti angka
11. **Omzet = semua angka di settlement** (Cash + Non-tunai + Piutang). Nota kiriman sudah termasuk
    di **Piutang** — tidak dikurangi, tidak ditambahkan lagi.
12. Uang cash yang disetor = Cash − Pengeluaran ± Selisih kasir.
13. **Piutang bukan uang masuk.** Uangnya datang lewat jalur lain (lihat aturan 16–17).

### Verifikasi finance
14. Finance cek foto struk, **cash setoran fisik**, dan **mutasi QRIS/transfer** per baris →
    **Cocok** / **Tidak cocok (ketik angka benar)** / **Tolak + alasan** (kasir perbaiki & kirim ulang).
    Laporan bisa diedit kasir selama belum diverifikasi.
15. Saat laporan disetujui → **Kas Masuk dibuat otomatis** (status disetujui). Selisih antara yang
    dilaporkan dan yang diterima finance = **selisih setoran**, atas nama pelapor.

### Uang yang tidak lewat kasir → Kas Masuk toko asal
16. **Nota kiriman dibayar ke driver** (cash disetor driver **besok**, karena driver pulang tengah
    malam): saat finance **Cocok** di Uang Pengiriman → Kas Masuk cabang asal nota, **tanggal nota**
    (tanggal Laporan Muat / surat jalan), bukan tanggal setor. Berlaku juga untuk Nota Gudang.
17. **Pelunasan piutang** biasanya **ditransfer konsumen langsung ke rekening kantor** (kasir hanya
    memproses di mesin keesokan harinya). Dicatat finance di Buku Piutang → Kas Masuk, **tanggal lunas**.
    Uang titipan pelunasan yang diterima kasir (jarang) = tetap pelunasan hutang; kasir tulis di
    Keterangan, finance yang mencatatnya di Buku Piutang.
18. Nota **tempo** tidak masuk Kas Masuk sampai dilunasi.

### Lain-lain
19. Halaman lama `keuangan/kas-masuk` **tetap ada** untuk darurat (kasir lupa lapor), menu diganti
    nama **"Input Kasir Darurat"**, dengan **peringatan** kalau cabang + tanggal itu sudah punya
    laporan kasir.
20. **Kiriman Gagal setelah kasir lapor** (nota batal) → finance mendapat **tanda untuk dicek**;
    laporan kasir tidak diubah otomatis.

---

## 4. Contoh 1 hari — Toko Pusat, tanggal 10 (disetujui user)

```
LAPORAN SHIFT 1 (Budi)          LAPORAN SHIFT 2 (Ani)
Cash ......... 6.000.000        Cash ......... 3.000.000
QRIS ......... 2.000.000        QRIS ......... 1.000.000
Trf BCA ...... 2.000.000
Piutang ...... 2.000.000 ← termasuk Nota A 1,5jt (cash ke driver) + Nota B 0,5jt (tempo)
Total ....... 12.000.000        Total ........ 4.000.000
Pengeluaran .   100.000
```

| Waktu | Kejadian | Di aplikasi |
|---|---|---|
| Tgl 10 | Shift 1 & 2 tutup | Masing-masing kirim Laporan Kasir |
| Tgl 10 malam | Driver pulang bawa 1,5jt (Nota A) | Driver sudah input saat kirim (seperti sekarang) |
| Tgl 11 | Toko setor cash; finance cek mutasi | Finance verifikasi laporan kasir → Kas Masuk **tgl 10** |
| Tgl 11 | Driver setor 1,5jt | Finance Cocok di Uang Pengiriman → Kas Masuk Toko Pusat **tgl 10** |
| Nanti | Konsumen lunasi Nota B (transfer) | Buku Piutang → Kas Masuk **tgl lunas** |

**Selisih** — finance hanya terima cash shift 1 Rp5.850.000 (seharusnya 5.900.000) → selisih
setoran **−50.000 atas nama Budi**.

**Hasil di laporan keuangan Toko Pusat tgl 10:**
```
Laporan Kasir (cash+QRIS+BCA shift 1 & 2) ... 14.000.000
Uang Pengiriman (Nota A) ....................  1.500.000   ← masuk setelah driver setor tgl 11
Piutang (Nota B, tempo) .....................    500.000   ← Buku Piutang
Total omzet ................................. 16.000.000   = settlement shift 1 + shift 2 ✓
```

**Gudang (disetujui user):** settlement Gudang 50jt, di dalamnya Nota Gudang yang diantar driver
45jt → uangnya masuk lewat Uang Pengiriman; sisanya lewat Laporan Kasir Gudang (diisi Back Office).

---

## 5. Rancangan per tahap (usulan teknis — boleh disesuaikan saat dikerjakan)

### Tahap 1 — Form Laporan Kasir (sisi kasir)
- Tabel `cashier_reports`: `branch_id`, `report_date`, `shift` (1|2), `reported_by` (employee),
  `photo_urls text[]` (≥1), `cash_amount`, `piutang_amount`, `cash_diff` (± selisih kasir),
  `notes`, `status` (`pending/approved/rejected/revisi`), `rejection_reason`, `verified_by/_at`,
  `created_at/updated_at`. **UNIQUE (branch_id, report_date, shift).**
- `cashier_report_payments` (non-tunai per baris): `report_id`, `method_label` (QRIS, Trf BCA, …),
  `amount`, + kolom verifikasi (`verified_amount`, `account_id`) diisi Tahap 2.
- `cashier_report_expenses`: `report_id`, `description`, `amount`.
- Total omzet & total pengeluaran **dihitung**, tidak disimpan sebagai input bebas.
- Hak akses (fungsi SQL, mis. `can_submit_cashier_report(branch_id)`): karyawan aktif di cabang itu,
  cabang bukan Gudang/Back Office, jabatan bukan Driver/Kepala Gudang/Helper; owner/hr/finance boleh
  semua cabang (termasuk Gudang). Simpan & edit lewat RPC (validasi server), edit hanya selama
  `pending`/`rejected`.
- Halaman **portal** (mobile-first, mis. `portal/laporan-kasir`): form + riwayat laporan cabang
  sendiri (status, alasan tolak). Menu muncul hanya untuk yang berhak.
- Foto ke bucket storage (pakai yang ada atau bucket baru `cashier-reports`).

### Tahap 2 — Verifikasi finance → Kas Masuk otomatis
- Tab baru di `keuangan/approval` (pola sama dengan Uang Pengiriman): daftar laporan per tanggal &
  cabang, foto struk bisa diperbesar, per baris Cocok / ketik angka benar, pilih rekening
  (cash → Kas Tunai default; metode lain → rekening dipilih, ingat pilihan terakhir per metode/cabang).
  Tombol **Setujui** / **Tolak + alasan**.
- `fin_cash_in` + kolom sumber `source_type` / `source_id` (mis. `cashier_report`). Saat disetujui:
  1 baris cash (`amount`=Cash, `expense_amount`=pengeluaran, `cash_adjustment`=selisih kasir +
  selisih setoran) + 1 baris per metode non-tunai. Piutang tidak dibuat baris.
  Batal setujui → baris otomatis dihapus. Baris otomatis **tidak bisa diedit** dari Input Kasir Darurat.
- Selisih (kasir + setoran) tercatat atas nama pelapor — lihat pertanyaan 7.3 soal Kerugian Kasir.

### Tahap 3 — Input Kasir Darurat
- Label menu & judul halaman `keuangan/kas-masuk` → **Input Kasir Darurat**.
- Peringatan saat simpan kalau cabang + tanggal itu sudah ada laporan kasir (tidak memblokir).

### Tahap 4 — Uang pengiriman → Kas Masuk toko asal
- Saat `verify_visit_payment` / `verify_nota_payment` (Cocok/Tidak cocok) → buat `fin_cash_in`
  (`source_type` = nota cabang / surat jalan) untuk **cabang asal**, **tanggal nota**, rekening dari
  verifikasi. Unverify → hapus. Tempo tidak dibuat. Menjawab Tahap 5 `RENCANA-NOTA-CABANG.md`.
- Hanya untuk nota **mulai tanggal berlaku** (pertanyaan 7.1), supaya tidak dobel dengan omzet
  yang dulu sudah diinput manual.

### Tahap 5 — Pelunasan Buku Piutang → Kas Masuk
- `record_receivable_payment` kind `setoran` → `fin_cash_in` cabang asal nota, tanggal lunas,
  rekening pembayaran. Kalau satu setoran melunasi nota dari beberapa cabang → dipecah per cabang
  sesuai alokasi. `cancel_receivable_payment` → hapus. Kind `saldo` tidak membuat Kas Masuk.

### Tahap 6 — Tanda bantu finance
- Di tab verifikasi: **Piutang laporan (shift 1+2) vs nota kiriman hari itu** (Laporan Muat cabang
  itu + surat jalan untuk Gudang), tampilkan daftar nama konsumen & selisihnya. Hanya info.
- Tanda kalau ada nota kiriman tanggal itu yang **Gagal/dibatalkan setelah** laporan kasir dibuat.
- Tanda kalau satu hari cabang belum ada laporan kasir sama sekali.

---

## 6. Ringkasan alur uang

```
Settlement (Omzet) = Cash + Non-tunai + Piutang
   │          │           └─► Piutang ─┬─► nota kiriman dibayar ke driver ─► Uang Pengiriman ─► Kas Masuk (tgl nota)
   │          │                        ├─► pelunasan transfer ke kantor ──► Buku Piutang ─────► Kas Masuk (tgl lunas)
   │          │                        └─► tempo belum bayar ────────────► Buku Piutang (belum Kas Masuk)
   │          └─► Laporan Kasir ─► verifikasi finance ─► Kas Masuk (tgl laporan)
   └─► Laporan Kasir (− pengeluaran ± selisih) ─► setoran fisik ─► verifikasi ─► Kas Masuk (tgl laporan)
```

---

## 7. Pertanyaan yang MASIH TERBUKA (tanyakan sebelum tahap terkait)

1. **Tanggal mulai berlaku** (Tahap 2 & 4): mulai tanggal berapa laporan kasir dipakai, dan
   mulai tanggal berapa uang pengiriman otomatis masuk Kas Masuk? Sebelum tanggal itu finance sudah
   input omzet manual → kalau tidak dibatasi, bisa **dobel**.
2. **Rekening per metode** (Tahap 2): QRIS & transfer tiap cabang masuk ke rekening mana? Perlu
   daftar dari finance supaya default rekening bisa diisi otomatis.
3. **Selisih kasir → Kerugian Kasir** (Tahap 2): selisih minus atas nama pelapor cukup tercatat
   (info), atau otomatis masuk potongan gaji di halaman Kerugian Kasir (`cashier_loss_entries`)?
4. **Tempo ambil sendiri** (Tahap 6): piutang konsumen yang ambil sendiri / diantar tim toko tanpa
   Laporan Muat belum tercatat di Buku Piutang. Intensitasnya belum diketahui user — apakah perlu
   cara mencatatnya (oleh finance) supaya bisa ditagih?
5. **Uang titipan pelunasan di kasir** (Tahap 5): finance mencatatnya di Buku Piutang dengan rekening
   Kas Tunai — pastikan uang itu tidak ikut terhitung lagi di baris cash laporan kasir (kasir
   melaporkan cash sesuai struk, titipan di Keterangan → cash fisik akan lebih). Cara finance
   memisahkannya perlu dicoba di Tahap 2/5.
