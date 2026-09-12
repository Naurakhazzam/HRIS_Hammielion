# HRIS Hammielion — Changelog & Dokumentasi Logika Bisnis

> Dokumen ini mencatat semua perubahan kode dan logika bisnis yang dilakukan pada sesi pengembangan ini.
> File: `app/(dashboard)/absensi/rekap/page.tsx` dan `app/(dashboard)/penggajian/bulanan/page.tsx`

---

## 1. Rekap Absensi (`absensi/rekap/page.tsx`)

### 1.1 Fix: `isTraining` wajib di `setAbsenForm`

**Masalah:** TypeScript error di baris 345 — tombol Edit pada baris hari libur memanggil `setAbsenForm` tanpa field `isTraining`, padahal state didefinisikan dengan field tersebut.

**Fix:** Tambahkan `isTraining: false` pada pemanggilan `setAbsenForm` di tombol Edit baris libur.

```ts
// Sebelum (error)
setAbsenForm({ employee_id: emp.id, date: dateStr, status: 'leave', notes: '' })

// Sesudah
setAbsenForm({ employee_id: emp.id, date: dateStr, status: 'leave', notes: '', isTraining: false })
```

---

### 1.2 Fitur: Auto-Libur & Auto-Izin dari Hari Kosong

**Logika Bisnis Baru:**

- Jika filter karyawan aktif, sistem mengecek semua tanggal dalam periode (26 bulan lalu s/d 25 bulan ini).
- Tanggal yang tidak memiliki record absensi = **hari kosong**.
- **Hari kosong ≤ 4** → diklasifikasikan sebagai **Libur** (tidak dipotong).
- **Hari kosong > 4** → kelebihannya diklasifikasikan sebagai **Izin** (dipotong 1×).

**Implementasi:**

Kalkulasi dilakukan setelah `attendanceByDate` tersedia (agar `generatePeriodDates` sudah bisa dipakai):

```ts
const emptyDays = filterEmployee
  ? generatePeriodDates().filter(d => !(attendanceByDate[d]?.length > 0)).length
  : 0
const autoLibur = Math.min(emptyDays, 4)
const autoIzin  = Math.max(emptyDays - 4, 0)
const totalLibur = totalLiburDB + autoLibur
const totalIzin  = totalIzinDB + autoIzin
```

**Card Summary:** Card LIBUR dan IZIN sekarang menghitung data DB + data auto dari hari kosong.

---

## 2. Penggajian Bulanan (`penggajian/bulanan/page.tsx`)

### 2.1 Fix: Validasi "Hari Belum Diklasifikasi" Saat Buat Slip

**Masalah:** Fungsi Supabase `get_unclassified_days` masih memblokir pembuatan slip meskipun hari-hari kosong sudah tampil sebagai Libur di rekap (karena belum tersimpan ke DB).

**Logika Bisnis Baru:**

Karena aturan sudah menetapkan bahwa semua hari kosong otomatis mendapat status (Libur/Izin), maka tidak ada hari yang benar-benar "unclassified". Validasi RPC diganti dengan pengecekan frontend.

```ts
// Tidak lagi memanggil supabase.rpc('get_unclassified_days', ...)
// Semua hari kosong = auto-libur/izin → selalu dianggap terklasifikasi
setUnclassifiedDays([])
```

---

### 2.2 Fix: Kehilangan Barang & Kerugian Kasir Diambil dari Sumber Asli

**Masalah:** Saat **preview slip baru**, sistem membaca `inventory_loss_deduction` dan `cashier_loss_deduction` dari tabel `payrolls` — yang belum ada karena slip belum dibuat. Hasilnya selalu 0.

**Fix:** Hitung langsung dari tabel sumber:

| Data | Tabel Sumber |
|---|---|
| Total kehilangan cabang | `loss_monthly_inputs` |
| % tanggungan karyawan | `loss_employee_shares` |
| % tanggungan kantor | `branch_loss_configs` |
| Kerugian kasir | `cashier_loss_entries` |
| Jabatan kasir | `cashier_loss_configs` |

**Rumus Kehilangan Barang:**
```
companyCover     = totalLoss × (companyPct / 100)
employeeTotalLoss = totalLoss - companyCover
invLoss          = (sharePct / 100) × employeeTotalLoss
```

**Rumus Kerugian Kasir:**
```
cashLoss = totalKasirBulanIni / jumlahKaryawanKasirAktif
         (hanya berlaku jika jabatan karyawan = jabatan kasir)
```

---

### 2.3 Fix: Rumus Potongan Tidak Hadir (Logika Bisnis Utama)

**Masalah:** Fungsi Supabase `calculate_attendance_deduction` menghasilkan potongan yang salah (izin 2× tidak dihitung).

**Keputusan:** Fungsi RPC Supabase dihapus dari alur dan diganti dengan kalkulasi penuh di frontend agar terkontrol.

#### Rumus Baku (sesuai kebijakan perusahaan):

**Daily Rate:**
```
dailyRate = (Gaji Pokok + Tunjangan Jabatan + Tunjangan Tetap) ÷ 26
```

**Potongan per Status:**

| Status | Potongan |
|---|---|
| **Libur** (`leave`) | Gratis — tidak dipotong |
| **Izin** (`permission`) | 1× daily rate per hari |
| **Sakit** (`sick`) — hari ke-1 | Gratis (ditanggung perusahaan) |
| **Sakit** (`sick`) — hari ke-2 & 3 | 0.5× daily rate per hari |
| **Sakit** (`sick`) — hari ke-4 ke atas | 1× daily rate per hari |
| **Alpha** (`absent`) | 1.5× daily rate per hari |

**Hari Kosong (tidak ada record):**
- ≤ 4 hari → dihitung sebagai **Libur** (gratis)
- > 4 hari → kelebihan dihitung sebagai **Izin** (1× daily rate)

**Implementasi:**
```ts
const dailyRate = Math.round((base + pos + meal) / 26)

// Hari kosong
const emptyDays = allPeriodDates.filter(d => !recordedDates.has(d)).length
const autoIzin  = Math.max(emptyDays - 4, 0)

// Izin
const izinCount = izinRecs.length + autoIzin
const izinDed   = izinCount * dailyRate

// Alpha
const alphaDed  = Math.round(alphaCount * dailyRate * 1.5)

// Sakit
const sick1Free  = Math.min(sickCount, 1)       // gratis
const sick23Half = Math.max(0, Math.min(sickCount - 1, 2))
const sick4Full  = Math.max(0, sickCount - 3)
const sickDed    = Math.round(sick23Half * dailyRate * 0.5 + sick4Full * dailyRate)

const totalPotonganTidakHadir = izinDed + alphaDed + sickDed
```

---

### 2.4 Fitur: Detail Lembur Per Hari di Modal & Print

**Baru:** Baris "Upah Lembur" di modal detail slip kini menampilkan rincian per tanggal:
- Tanggal, jumlah jam, tarif per jam, total per hari
- Total jam lembur di bawah rincian

Data diambil dari `attendances.overtime_hours` dengan pembulatan:
- < 60 menit = tidak dihitung
- ≥ 60 menit = dibulatkan ke bawah per jam penuh

---

### 2.5 Fitur: Print Slip Gaji ke Jendela Baru (Bersih)

**Masalah:** `window.print()` mencetak seluruh halaman termasuk navbar, sidebar, dan elemen UI lainnya.

**Fix:** Tombol Cetak sekarang membuka **jendela baru** dengan HTML slip yang bersih, lalu auto-print dan auto-close.

**Konten yang ikut tercetak (transparansi ke karyawan):**
- Info karyawan: nama, jabatan, cabang, periode, tanggal bergabung, lama bekerja
- Rincian lembur: per tanggal (jam × tarif = nominal)
- Rincian keterlambatan: per tanggal (menit × tarif = nominal) + total menit
- Rincian kehilangan barang: total kehilangan cabang, kantor menanggung berapa, karyawan menanggung berapa
- Semua komponen pendapatan & potongan

---

### 2.6 Fitur: Info Tanggal Bergabung & Lama Bekerja di Detail Slip

**Baru:** Modal detail slip dan hasil print kini menampilkan:
- **Tanggal Bergabung** — diambil dari `employees.join_date`
- **Lama Bekerja** — dihitung otomatis dari `join_date` hingga hari ini (format: "X tahun Y bulan")

Query payrolls diupdate untuk menyertakan `join_date` dari tabel `employees`.

---

### 2.7 Fitur: Total Menit Keterlambatan di Detail Slip

**Baru:** Di bawah daftar rincian keterlambatan per hari, ditambahkan baris **"Total: X menit"** agar karyawan bisa melihat akumulasi keterlambatan dalam satu periode.

---

## Ringkasan File yang Diubah (Sesi 1)

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/rekap/page.tsx` | Fix `isTraining`, kalkulasi auto-libur/auto-izin di summary card |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Fix validasi slip, fix kehilangan barang, ganti RPC potongan dengan kalkulasi frontend, detail lembur, print bersih, info join date |

---

---

# Sesi 2 — Lanjutan Pengembangan

---

## 3. Fix Timezone Bug (JavaScript `toISOString()`)

**Masalah:** Semua fungsi yang menggunakan `new Date(...).toISOString().split('T')[0]` untuk menghasilkan string tanggal menghasilkan tanggal yang **mundur 1 hari** di browser WIB (UTC+7), karena `toISOString()` selalu mengkonversi ke UTC.

**Dampak:**
- `generatePeriodDates()` di rekap absensi → periode mulai dari tanggal 25, bukan 26
- `fetchLateDetails()` → `firstDay` salah → query salary_components tidak menemukan data → tarif telat = Rp 0
- `fetchOtDetails()` → tarif lembur = Rp 0
- `buildSlipPreview()` → `allPeriodDates` tidak cocok dengan `recordedDates` → semua hari dianggap kosong → 27 hari auto-izin

**Fix di semua tempat:** Ganti `toISOString().split('T')[0]` dengan format manual menggunakan `getFullYear()`, `getMonth()`, `getDate()`:

```ts
// Sebelum (bug)
cur.toISOString().split('T')[0]

// Sesudah (benar)
`${cur.getFullYear()}-${pad(cur.getMonth()+1)}-${pad(cur.getDate())}`
```

**File yang difix:**
- `absensi/rekap/page.tsx` — `generatePeriodDates()`
- `penggajian/bulanan/page.tsx` — `fetchLateDetails()`, `fetchOtDetails()`, `fetchAbsentBreakdown()`, `buildSlipPreview()`

---

## 4. Fix: `absentDays` Tidak Menghitung `autoIzin`

**Masalah:** Label "Tidak Hadir (0 hari)" muncul walaupun ada potongan, karena `absentDays` hanya menghitung record eksplisit dari DB, tidak menghitung hari kosong yang otomatis menjadi izin.

**Fix:**
```ts
// Sebelum
const absentDays = izinRecs.length + alphaCount + sickCount

// Sesudah (include autoIzin)
const absentDays = izinCount + alphaCount + sickCount  // izinCount = izinRecs.length + autoIzin
```

---

## 5. Fitur: Breakdown Potongan Tidak Hadir di Modal Detail Slip

**Baru:** Saat membuka detail slip yang sudah tersimpan, baris "Tidak Hadir" kini menampilkan rincian lengkap yang di-fetch ulang dari DB:

- Gaji harian (total komponen ÷ 26)
- Izin: X hari (eksplisit + hari kosong otomatis) × 1×
- Alpha: X hari × 1.5×
- Sakit: hari ke-1 gratis, hari ke-2–3 = 0.5×, hari ke-4+ = 1×

**Fungsi baru:** `fetchAbsentBreakdown(p)` dipanggil saat klik tombol "Lihat" di daftar slip.

---

## 6. Fitur: Tabungan Loyalitas (Rename + Durasi + Auto-Cairkan)

### 6.1 Rename

Semua label "Tunjangan Loyalitas" diganti menjadi **"Tabungan Loyalitas"** di:
- `penggajian/bulanan/page.tsx`
- `penggajian/loyalitas/page.tsx`
- `portal/slip-gaji/page.tsx`
- `components/sidebar.tsx`

### 6.2 Perubahan DB

```sql
-- Durasi pencairan per karyawan
ALTER TABLE employees ADD COLUMN loyalitas_duration_months integer NOT NULL DEFAULT 12;

-- Tracking siklus tabungan
ALTER TABLE loyalitas_balances
  ADD COLUMN start_month integer,
  ADD COLUMN start_year integer,
  ADD COLUMN cycle_number integer NOT NULL DEFAULT 1;

-- Pencairan otomatis di payroll
ALTER TABLE payrolls ADD COLUMN loyalitas_auto_release numeric NOT NULL DEFAULT 0;
```

### 6.3 Logika Bisnis Baru

**Setup per karyawan:** nominal/bulan + durasi (bulan). Contoh: Rp 100.000/bulan selama 12 bulan.

**Siklus tabungan:**
- Setiap bulan saat slip di-approve/paid → `loyalitas_per_month` dipotong dari gaji → ditambahkan ke `loyalitas_balances.total_withheld`
- `start_month` & `start_year` dicatat di bulan pertama pemotongan

**Auto-cairkan:**
```
monthsElapsed = (tahun slip - start_year) × 12 + (bulan slip - start_month) + 1
jika monthsElapsed >= loyalitas_duration_months:
  → saldo lama + potongan bulan ini masuk sebagai PENDAPATAN di slip
  → loyalitas_balances lama di-release
  → siklus baru dimulai dari 0
```

**Tampilan di slip:**
- Bulan normal → bagian POTONGAN: "Tabungan Loyalitas (saldo: Rp X)"
- Bulan pencairan → bagian PENDAPATAN: "✅ Cair Tabungan Loyalitas (X bln)"

**Halaman Loyalitas:**
- Progress bar visual per karyawan (bulan ke-X dari Y)
- Info estimasi tanggal cair
- Tombol "Cairkan Manual" jika perlu sebelum waktunya

---

## 7. Fix: Rate Lembur & Telat = Rp 0 di Modal Detail

**Masalah:** `fetchLateDetails()` dan `fetchOtDetails()` menggunakan `toISOString()` untuk membuat `firstDay` → tanggal salah → query salary_components tidak menemukan tarif → rate = 0 → tampil "Rp 0/jam" dan "Rp 0/mnt".

**Fix:** Ganti dengan format lokal (lihat item 3).

---

## 8. Data: Insert Karyawan Baru

**Karyawan baru dimasukkan langsung ke DB:**

| Field | Data |
|---|---|
| Kode | EMP-013 |
| Nama | Rahmat Saleh |
| NIK | 3206281904040004 |
| TTL | Kab. Tasikmalaya, 19 April 2004 |
| Jabatan | Helper — Toko Pusat |
| Departemen | Team Toko |
| Tipe | Contract (training) |
| Bergabung | 7 Mei 2026 |
| Bank | BCA `2091068577` |
| Kontak Darurat | Istri — 087883475741 |

---

## 9. Pending / Rencana ke Depan

| Item | Status | Catatan |
|---|---|---|
| Bonus Kondisional → pindah ke Step 1 Buat Slip | 🔲 Belum | Akan diintegrasikan ke modal Buat Slip Gaji |
| Auto-cek kriteria bonus dari data sistem | 🔲 Belum | Kehilangan barang, keterlambatan, alpha bisa otomatis |
| Target penjualan sebagai kriteria bonus | 🔲 Analisa | Perlu investigasi modul Bonus Kinerja |
| Bonus Kondisional nominal otomatis | 🔲 Belum | Tergantung tipe kriteria |

---

## Ringkasan File yang Diubah (Sesi 2)

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/rekap/page.tsx` | Fix timezone `generatePeriodDates` |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Fix timezone semua fetch, absentDays, breakdown tidak hadir, tabungan loyalitas auto-cairkan |
| `app/(dashboard)/penggajian/loyalitas/page.tsx` | Rename + fitur durasi + progress bar + setup baru |
| `app/(dashboard)/portal/slip-gaji/page.tsx` | Rename Tabungan Loyalitas |
| `components/sidebar.tsx` | Rename Tabungan Loyalitas |
| **DB** | 4 kolom baru: `loyalitas_duration_months`, `start_month`, `start_year`, `cycle_number`, `loyalitas_auto_release` |

---

## Sesi 3 (2026-09-01)

### 10. Fitur: Gabung Saldo Rekening

Rekening yang cuma label channel pembayaran (mis. EDC/QRIS) bisa ditandai "Gabung Saldo Ke" rekening bank tujuannya (`fin_bank_accounts.settlement_account_id`). Halaman Cash Flow per Rekening otomatis menjumlahkan rekening yang tergabung ke panel "Saldo Riil per Kantong" — tidak perlu hitung manual lagi.

### 11. Fitur: Ringkasan Potongan Gaji

- **Penggajian Bulanan**: tab baru "Riwayat Potongan Keterlambatan" (per bulan, lintas periode) + panel "Ringkasan Potongan per Kategori" (Keterlambatan, Kasbon, Kehilangan Barang, Kerugian Kasir, Tidak Hadir, Loyalitas) untuk periode & cabang yang sedang difilter.
- **Kehilangan & Kasir**: tabel "Riwayat Minus Kas Kasir — Semua Periode" (tidak dibatasi filter bulan aktif) yang menandai kuning entry yang periode payroll-nya beda dari filter — supaya kelihatan kalau ada entry yang salah masuk bulan (kasus umum: input akhir bulan pakai tanggal "hari ini" yang sudah masuk bulan berikutnya).

### 12. Fitur: Karyawan Gaji Flat (`employees.flat_salary`)

Toggle baru di form Karyawan. Kalau aktif, `buildSlipPreview` di Penggajian Bulanan mengabaikan SEMUA kalkulasi berbasis absensi — lembur, telat, tidak hadir, kompensasi kurang libur, kehilangan barang/kasir, bonus kondisional/KPI — gaji selalu flat sesuai Gaji Pokok. Dipakai untuk karyawan yang cuma dicatat administratif (mis. jabatan Owner) dan tidak pernah diabsen harian, supaya tidak muncul "Kompensasi Libur Tidak Diambil" dkk yang tidak relevan.

### 13. Fitur: Edit Jadwal Kerja

Tombol Edit di tiap baris tabel Jadwal Kerja (`absensi/jadwal`) — form "Tambah Jadwal" dipakai ulang dalam mode edit (pre-filled), update in place alih-alih harus hapus+tambah ulang.

### 14. Fix: `custom_check_in_time` usang menyebabkan salah hitung telat

Beberapa karyawan Team Toko (mis. Raja Petshop) punya "Jam Kerja Khusus" pribadi (`employees.custom_check_in_time`) yang di-set sebelum sistem 2-shift (Shift 1 07:00 / Shift 2 10:00) dibuat. Override ini melewati deteksi shift otomatis sepenuhnya, jadi jam masuk selalu dibandingkan ke jam tetap yang sudah tidak relevan — menyebabkan keterlambatan salah hitung (kadang jauh lebih besar, kadang lebih kecil dari yang seharusnya). Diperbaiki manual per kasus yang dilaporkan; field ini masih ada untuk karyawan lain yang memang butuh jam kerja tetap non-shift.

### Perbaikan Data (kesalahan input, bukan bug kode)

Beberapa entry tersimpan di cabang/periode yang salah karena kesalahan pilih cabang atau tanggal default "hari ini" saat input (kehilangan barang Gudang vs Toko Pusat, minus kas kasir Raja Petshop, kasbon Toko Pusat) — dikoreksi manual di database setelah dikonfirmasi ke user, plus payroll draft terkait disesuaikan.

### Ringkasan File yang Diubah (Sesi 3)

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/rekening/page.tsx` | Field & UI "Gabung Saldo Ke" |
| `app/(dashboard)/keuangan/cashflow/page.tsx` | Panel "Saldo Riil per Kantong" (grouping otomatis) |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Tab Riwayat Potongan Keterlambatan, panel Ringkasan Potongan per Kategori, logika `flat_salary` di `buildSlipPreview` |
| `app/(dashboard)/penggajian/kehilangan/page.tsx` | Tabel Riwayat Minus Kas Kasir semua periode |
| `app/(dashboard)/karyawan/page.tsx` | Toggle "Gaji Flat" |
| `app/(dashboard)/absensi/jadwal/page.tsx` | Tombol Edit per jadwal |
| **DB** | Kolom baru: `fin_bank_accounts.settlement_account_id`, `employees.flat_salary` |

### Catatan Proses (berlaku ke depan)

**Setiap perubahan kode HARUS langsung di-commit & push begitu selesai** — user menguji lewat versi yang di-deploy, bukan server lokal, jadi fix yang cuma tersimpan lokal akan kelihatan "tidak jalan" walau kodenya sudah benar dan server lokal sudah di-restart.

### 15. Fitur: Tandai Lunas → Modal Metode & Sumber Pembayaran

Klik "Tandai Lunas" (satuan maupun massal) sekarang membuka modal: tanggal pembayaran + daftar sumber (rekening/kas), bisa dipecah ke lebih dari satu sumber sekaligus. Setelah dikonfirmasi, slip berubah status `paid` **dan** langsung insert baris `fin_cash_out` per sumber (kategori `payroll`), status langsung `approved` (Owner yang melunaskan = sudah terverifikasi), `transaction_date` = tanggal pembayaran yang diisi user (bukan periode gaji — aturan pencatatan Kas Keluar selalu berdasarkan tanggal uang keluar, bukan periode yang dibayarkan). Aksi massal mengalokasikan tiap karyawan proporsional ke tiap sumber sesuai porsi gabungan yang diisi.

### 16. Fix Kritis: Trigger `trg_fin_autopost_payroll` Dihapus (Bug Lama, Baru Ketahuan)

**Ditemukan:** Sudah ada trigger DB lama (`AFTER INSERT OR UPDATE ON payrolls`, fungsi `fin_autopost_payroll()`) yang otomatis insert ke `fin_cash_out` setiap kali status payroll berubah jadi `paid` — dibuat di sesi sebelum sesi ini, sebelum fitur #15 di atas ada. Fungsinya sudah tanggal salah (pakai akhir bulan periode, bukan tanggal bayar), tidak punya `account_id`, tidak mendukung split sumber, dan **buggy**: variabel `v_user_id` dihitung lewat join `users.employee_id = NEW.approved_by` tapi tidak pernah dipakai — insert tetap pakai `NEW.approved_by` (nilai `employees.id`) langsung ke kolom `fin_cash_out.input_by` yang FK-nya ke `users(id)`, jadi **selalu gagal dengan `fin_cash_out_input_by_fkey` violation** kalau ada payroll baru yang di-UPDATE ke status `paid` — dan karena trigger gagal, seluruh UPDATE payroll ikut ter-rollback (slip tidak pernah benar-benar jadi "Lunas").

**Kenapa baru ketahuan sekarang:** 16 baris `fin_cash_out` lama berlabel "Auto-post gaji..." (periode Juli) sudah berhasil masuk sebelum bug ini kena — kemungkinan besar skema `approved_by` berubah referensinya (dulu ke `users`, sekarang ke `employees`) di suatu titik sesi sebelumnya, dan trigger ini tidak ikut disesuaikan. Baru kena lagi sekarang karena baru ada percobaan "Tandai Lunas" lagi setelah itu.

**Fix:** `DROP TRIGGER trg_fin_autopost_payroll ON payrolls;` — dihapus total, bukan diperbaiki, karena sudah digantikan sepenuhnya (dan lebih baik) oleh fitur #15 di atas: modal client-side punya `account_id`, dukungan split sumber, dan tanggal pembayaran yang benar. Membiarkan keduanya aktif bersamaan akan mencatat pengeluaran gaji **dua kali**.

### 17. Fix: Unique Index `fin_cash_out_source_unique` Terlalu Ketat untuk Split Pembayaran

**Ditemukan:** Ada partial unique index `fin_cash_out_source_unique` pada `(source_table, source_id)` — dibuat bersamaan dengan sistem auto-post trigger lama (item #16) sebagai pengaman "1 sumber = 1 baris pengeluaran", berlaku untuk `payrolls`, `loading_entries`, `driver_kasbon`, `kasbon_requests`, `driver_wage_weekly`. Index ini otomatis menolak baris kedua untuk slip gaji yang sama — jadi begitu pembayaran dipecah ke 2+ rekening (fitur #15), insert baris kedua selalu gagal dengan duplicate key error.

**Fix:** Index diganti jadi `(source_table, source_id, account_id)` — tetap mencegah baris dobel untuk kombinasi sumber+rekening yang SAMA (jaga niat aslinya: anti double-post), tapi sekarang membolehkan banyak baris per slip selama rekening/kasnya beda (kasus split pembayaran yang sah).

**Data yang sempat kena:** Slip Elan Suherlan (Agustus 2026) — pembayaran split Rp 10jt Kas Tunai + Rp 10jt BRI IRMA, baris keduanya sempat gagal dan harus dilengkapi manual setelah index diperbaiki.

**Update lanjutan — index dihapus total:** Ternyata `(source_table, source_id, account_id)` masih terlalu ketat juga: satu slip gaji bisa punya LEBIH dari satu peristiwa pembayaran nyata dari rekening yang SAMA (mis. gaji pokok dibayar dari Kas Tunai, lalu belakangan ada Bonus Tambahan yang juga dibayar dari Kas Tunai untuk slip yang sama) — kena block lagi dengan error yang sama. Karena proteksi anti-dobel-post ini awalnya dibuat khusus untuk jaga-jaga trigger auto-post lama (item #16, sudah dihapus total), dan sekarang tidak ada lagi mekanisme otomatis yang bisa menyebabkan dobel post, index `fin_cash_out_source_unique` **dihapus total** (bukan diubah lagi) — tidak ada lagi pembatasan unik pada source_table/source_id/account_id.

### 18. Fitur: Biaya Tetap Berkala Diperluas — Flat/Bulan vs Tarif Harian, dan Sewa Internal ke Logistik

Halaman "Biaya Tetap Berkala" (sudah ada sebelumnya tapi belum pernah dipakai — 0 baris) diperluas: setiap item sekarang punya `billing_type` (`flat` = nominal tetap per bulan, mis. sewa toko/gudang; `daily` = tarif harian × jumlah hari dalam bulan kalender, mis. sewa motor/parkir). Ditambahkan juga `account_id` (dibayar dari rekening/kas mana) dan `internal_to_branch_id` + `internal_to_account_id` — untuk item yang uangnya masuk ke cabang lain secara internal (lihat konsep "Logistik sebagai perusahaan dalam perusahaan" di bawah), generator otomatis (`fin_generate_recurring_costs`, dijalankan pg_cron tiap tanggal 28) sekarang juga insert baris `fin_cash_in` pasangannya di cabang penerima, bukan cuma `fin_cash_out` di cabang pembayar.

### 19. Fitur: Sewa Kendaraan Berbasis Ritase — Kas Keluar Mode "Kendaraan"

**Konsep bisnis baru yang dikonfirmasi user:** Logistik adalah "perusahaan dalam perusahaan" — sewa toko, motor, mobil, dan parkir yang dibayar cabang-cabang lain ke Logistik adalah **transfer uang beneran antar rekening**, bukan sekadar alokasi pembukuan. Tabel baru `fin_vehicle_rental_rates` menyimpan tarif per-hari per kendaraan (Engkel Box, Grand Max Box, L300) + cabang/rekening pembayar dan cabang/rekening penerima (Logistik).

Karena jumlah hari pakai kendaraan bervariasi per bulan (beda dengan sewa toko/motor yang flat), dibuatkan mode input manual "🚚 Sewa Kendaraan" di Kas Keluar: pilih kendaraan + bulan, sistem otomatis menyarankan jumlah hari pakai dengan menghitung `COUNT(DISTINCT trip_date)` dari data Ritase Driver (`delivery_trips`) pada bulan itu — validasi empiris menunjukkan angka ini mendekati laporan manual user. Angka saran selalu bisa diedit manual. Submit akan insert pasangan `fin_cash_out` (cabang pembayar) + `fin_cash_in` (Logistik), status `pending` (butuh approval, beda dari Biaya Tetap Berkala yang langsung `approved`).

### 20. Fix: Mekanisme Kasbon Terputus dari Pencairan — `kasbon_limits` Tidak Pernah Terupdate dari Kas Keluar

**Ditemukan:** Tabel `kasbon_requests`/`kasbon_deductions`/`kasbon_limits` (backing tab "Pengajuan"/"Riwayat Potongan" di halaman Kasbon) kosong total, padahal 14 slip gaji nyata sudah punya `kasbon_deduction` (potongan kasbon ditulis manual di slip, tanpa ledger). Terpisah, kategori Kas Keluar `kasbon_cair` (Pencairan Kasbon) sudah punya 30 entri nyata — tapi **tidak pernah** mengupdate `kasbon_limits.current_balance`, padahal itu yang dibaca Penggajian Bulanan sebagai referensi "Saldo Kasbon" saat slip dilunaskan. Akibatnya saldo kasbon di sistem selalu salah/kosong.

**Fix:** Mode entri baru "💵 Cairkan Kasbon" di Kas Keluar — insert baris Kas Keluar (`kasbon_cair`) **dan** upsert `kasbon_limits.current_balance` sekaligus. Tab Limit di halaman Kasbon (`app/(dashboard)/kasbon/page.tsx`) diperbaiki membaca "Saldo Aktif" dari `kasbon_limits.current_balance`, bukan dari `kasbon_requests` yang selalu kosong.

### 21. Fitur: Halaman Logistik — Laporan Penuh Pendapatan & Pengeluaran

Halaman baru `keuangan/logistik` — laporan gabungan Pendapatan (Kas Masuk) dan Pengeluaran (Kas Keluar) khusus cabang Logistik plus Sisa Saldo, supaya uang Logistik kelihatan terpisah dari cabang lain (konsekuensi langsung dari konsep "perusahaan dalam perusahaan" di item #18–19). Default tampil **semua periode** (laporan full), dengan toggle opsional ke tampilan per bulan.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/biaya-tetap/page.tsx` | Toggle Flat/Tarif Harian, field rekening, sewa internal |
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Mode "Cairkan Kasbon" & "Sewa Kendaraan" |
| `app/(dashboard)/kasbon/page.tsx` | Saldo Aktif dari `kasbon_limits` |
| `app/(dashboard)/keuangan/logistik/page.tsx` | Halaman baru — laporan Pendapatan/Pengeluaran/Sisa Saldo Logistik |
| **DB** | Tabel baru `fin_vehicle_rental_rates`; kolom baru `fin_recurring_costs.billing_type/account_id/internal_to_branch_id/internal_to_account_id` |

### 22. Fitur: Omset (Sistem Kasir) Disandingkan dengan HPP & Kas Real di Laporan Resmi

**Latar belakang:** Bisnis punya sistem kasir eksternal yang akurat untuk Omset & HPP (akrual — barang terjual, terlepas uangnya sudah cair atau belum), terpisah dari HRIS yang mencatat arus kas real-time (Kas Masuk/Kas Keluar). Keduanya tidak boleh dipaksa jadi satu angka — gap di antaranya (piutang, uang antar-cabang yang "nyasar", pembayaran supplier yang menutup utang lama) itu wajar, bukan kesalahan pencatatan.

**Perubahan:** Halaman "HPP Manual" diperluas jadi "HPP & Omset (Sistem)" — `fin_hpp_entries` dapat kolom `entry_type` (`hpp` / `omset`), form & tabelnya mendukung dua jenis entri. Laporan Resmi (tab Bulanan) dapat panel baru "Omset & HPP Sistem Kasir vs Kas Real": Omset(sistem), HPP(sistem), Laba Kotor(sistem) — dianggap lebih dipercaya daripada Laba Kotor berbasis Kas Masuk yang lama — disandingkan dengan Uang Diterima (real) dan Pembayaran Supplier (real, ditampilkan terpisah karena bisa berisi pelunasan utang lama, bukan cerminan HPP bulan berjalan). Panel ini otomatis tersembunyi untuk periode yang belum ada data Omset-sistemnya.

**Verifikasi data Agustus 2026:** Ditemukan 1 dari 5 entri HPP yang sempat salah (Toko Depan tercatat Rp91.773.521, seharusnya Rp88.541.520 sesuai konfirmasi Owner) — sudah diperbaiki. Omset-sistem Agustus per cabang di-backfill dari angka yang diberikan Owner (Gudang Rp2.126.465.500, Toko Pusat Rp435.359.297, Toko Depan Rp102.890.285, Raja Petshop Rp99.684.476, Markas Petshop Rp37.472.992) — total Laba Kotor (sistem) Agustus = Rp160.526.477 (~5,7% margin), semua cabang untung.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/hpp/page.tsx` | Toggle Jenis Data (HPP/Omset), filter Jenis, kolom Jenis di tabel |
| `app/(dashboard)/keuangan/laporan/page.tsx` | Panel perbandingan Omset/HPP Sistem vs Kas Real (tab Bulanan) |
| `components/sidebar.tsx` | Label menu "HPP Manual" → "HPP & Omset (Sistem)" |
| **DB** | Kolom baru `fin_hpp_entries.entry_type` |

### 23. Fitur: Halaman Detail Laporan per Cabang

Halaman baru `keuangan/laporan/detail` — pilih Kelompok/Cabang & Bulan lewat dropdown, tampil ringkasan sistem-vs-real yang sama seperti di Laporan Resmi, lalu **rincian Pengeluaran per kategori** (tiap kategori bisa diklik untuk buka daftar transaksinya: tanggal, cabang, nominal, keterangan, status) dan **rincian Pemasukan (Kas Masuk)** dalam bentuk daftar. Dijangkau lewat link di nama Kelompok pada tabel "Per Kelompok Laporan" (bawa `group` & `month` lewat query string, dibaca manual dari `window.location.search` supaya tidak perlu hook `useSearchParams` + `Suspense`), juga lewat menu sidebar.

Diverifikasi: total Biaya Operasional hasil hitung ulang dari rincian kategori untuk "Gudang & Back Office" Agustus (Rp69.775.827) persis cocok dengan angka yang sudah tampil di Laporan Resmi — logikanya konsisten.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Halaman baru |
| `app/(dashboard)/keuangan/laporan/page.tsx` | Nama Kelompok di tabel jadi link ke halaman detail |
| `components/sidebar.tsx` | Menu baru "Detail Laporan per Cabang" |

### 24. Fix Kritis: Penggajian Driver — Kasbon Tidak Pernah Benar-Benar Mengurangi Gaji, dan Tidak Ada Jalur Otomatis ke Kas Keluar

**Ditemukan:** Beda dari Gaji Staff (yang sudah lewat Tandai Lunas otomatis sejak item #15), Penggajian Driver `markAsPaid()` cuma mengubah `delivery_trips.payment_status` — **tidak pernah** membuat baris `fin_cash_out`. Semua entri "Gaji driver [Nama] minggu [tanggal]..." selama ini diketik manual, dan pola konsisten sejak Juni: nominalnya = Gross − Denda saja, **kasbon tidak pernah ikut dikurangi** (deskripsinya bahkan eksplisit menulis "tidak mengurangi gaji" di setiap entri). Di sisi lain, tabel `driver_kasbon`/`driver_kasbon_deductions` tetap mencatat kasbon itu sebagai "Lunas" — padahal secara riil driver tetap menerima gaji penuh. Setelah dikonfirmasi ke Owner: kasbon **seharusnya** memang memotong uang yang diterima driver.

**Fix data:** 15 baris `fin_cash_out` (kategori `driver_wage`, Juni–Agustus) dikoreksi nominalnya turun sebesar kasbon yang seharusnya dipotong (total Rp3.300.000), deskripsinya diperbarui.

**Fix struktural:** Ditambahkan tombol "💰 Tandai Lunas & Catat Kas Keluar" di modal Detail Upah Driver — menghitung otomatis (upah trip belum lunas − denda tersimpan − kasbon tersimpan), cabang diambil dari data karyawan asli (bukan diketik), insert satu baris `fin_cash_out` berstatus `approved`. Jalur lama (`selectedIds`/bulk "Lunasi X Trip" yang cuma menandai lunas tanpa insert Kas Keluar sama sekali) **dihapus total** — sekarang satu-satunya jalur adalah lewat modal ini.

| File | Perubahan |
|---|---|
| `app/(dashboard)/penggajian/driver/page.tsx` | Tombol & modal Tandai Lunas Driver; hapus jalur bulk lunas lama |
| **DB** | Koreksi nominal 15 baris `fin_cash_out` kategori `driver_wage` |

### 25. Fix: "Nota Rekap Bayar Sendiri" — Utang Supplier Dobel Hitung di Markas Petshop & Raja Petshop, + Fitur "Bayar Sekaligus" di Kas Keluar

**Ditemukan:** 5 baris `supplier_purchases` (Markas Petshop/Hammielion x2, Raja Petshop/Hammielion x2, Raja Petshop/Gudang x1) ternyata bukan nota belanja asli — isinya rekap pembayaran ("Pembayaran Supplier tanggal 21,22,23,24") yang dibuat lewat mode "Catat Tagihan Baru" di Kas Keluar, lalu langsung dibayar lunas sendiri. Akibatnya nota-nota ASLI yang seharusnya dilunasi tetap tercatat Rp0 terbayar — utang dobel hitung (nota asli + nota rekap).

**Fix data:** Untuk Markas/Hammielion & Raja/Hammielion (rekap ≈ menutup semua nota terbuka, selisih kecil/wajar) — nota rekap dihapus, pembayarannya dialokasikan ulang FIFO ke nota asli (kelebihan kecil ditaruh di nota terakhir supaya total uang keluar tidak berubah). Untuk Raja/Gudang (rekap jauh lebih kecil dari total terbuka, tidak bisa dipastikan nota mana) — dialokasikan FIFO best-effort, sisanya tetap tercatat sebagai utang belum tertagih.

**Fix struktural:** Ditambahkan mode **"💰 Bayar Sekaligus"** di Kas Keluar → Bayar ke Supplier — port logika bulk-pay yang sudah ada di Pembelian & Utang Supplier (Ringkasan per Supplier), alokasi otomatis FIFO ke nota tertua, lintas cabang (cabang tiap baris ikut nota aslinya). Dijadikan mode default & urutan pertama, dengan peringatan di mode "Catat Tagihan Baru" mengarahkan ke sini — supaya tidak ada alasan lagi bikin nota rekap palsu.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Mode "Bayar Sekaligus" (auto-FIFO lintas cabang) |
| **DB** | Hapus 5 nota rekap + realokasi 19 baris `fin_cash_out` pembayaran supplier |

### 26. Fix Data: 14 Baris Gaji Duplikat Salah Cabang (Selalu Tercatat "Gudang")

**Ditemukan:** Owner curiga kenapa gaji karyawan yang bukan ditempatkan di Gudang (contoh: Fikri, Ridwan Iyay) muncul di bawah cabang Gudang. Ditelusuri: ada 14 baris `fin_cash_out` kategori `payroll` berstatus `pending`, deskripsi cuma nama depan tanpa periode (mis. "Gaji Fikri"), dan `branch_id` selalu Gudang — ini duplikat dari baris ASLI yang sudah benar (nama lengkap + "periode 26 Juli – 25 Agustus 2026" + `branch_id` sesuai cabang asli karyawan + status `approved`), dibuat lewat mekanisme Tandai Lunas.

**Fix data:** 14 baris duplikat dihapus. Aman dilakukan tanpa realokasi karena semuanya berstatus `pending` (belum pernah mempengaruhi kas real).

| File | Perubahan |
|---|---|
| **DB** | Hapus 14 baris `fin_cash_out` kategori `payroll` (duplikat, pending, salah cabang) |

### 27. Fix: Rincian Kehilangan per Cabang di Detail Laporan — Sumber Data Salah

**Ditemukan (2 tahap):** (1) Panel "Rincian Kehilangan" di Detail Laporan per Cabang awalnya tidak memfilter kehilangan yang sudah ditanggung karyawan (dipotong dari gajinya) — sempat diperbaiki dengan filter `cashier_loss_entries.employee_id IS NULL`, tapi (2) ternyata itu masih salah: angka acuan yang benar bukan dari `cashier_loss_entries`, melainkan dari tabel `loss_monthly_inputs` (diisi manual per cabang/bulan lewat kartu "📦 Kehilangan Barang" di halaman Kehilangan Kasir) — `cashier_loss_entries` cuma mencatat rincian siapa yang menanggung, bukan total kehilangannya.

**Fix:** Formula yang benar: **Kehilangan Ditanggung Kantor = `loss_monthly_inputs.total_loss_amount` (per cabang/periode) − jumlah `cashier_loss_entries.amount` yang employee_id-nya terisi (periode sama)**. Panel diubah menampilkan breakdown Total Kehilangan Barang / − Ditanggung Karyawan / = Ditanggung Kantor, plus rincian tabel yang ditanggung karyawan untuk transparansi. Diverifikasi cocok persis dengan angka di kartu sumbernya (Toko Pusat Juli 2026: total Rp2.261.893 − karyawan Rp334.144 = kantor Rp1.927.749) dan universal di 16 kombinasi cabang/bulan lain.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Rincian Kehilangan pakai `loss_monthly_inputs` sebagai sumber total, dikurangi bagian karyawan dari `cashier_loss_entries` |

### 28. Fitur: Sederhanakan Alur Pembayaran Supplier — Satu Tempat, Satu Tombol "Bayar"

**Latar belakang:** Owner bingung karena pencatatan hutang/pembayaran supplier tersebar di 2 halaman berbeda (Kas Keluar mode "Bayar ke Supplier" dengan 3 sub-mode, dan Pembelian & Utang Supplier) — 2 implementasi terpisah untuk logika yang sama, berisiko saling tidak konsisten. Tampilan tab "Catat Pembelian" juga membingungkan karena satu supplier internal (mis. "Gudang") wajar tampil berkali-kali (satu baris per nota, bukan per supplier) — beda dari tab "Ringkasan per Supplier" yang sudah benar dikelompokkan.

**Fix struktural:**
- Halaman Pembelian & Utang Supplier sekarang default ke tab "Ringkasan per Supplier" (bukan "Catat Pembelian"), dengan tombol besar "+ Pembelian Baru" yang membuka modal (Supplier, Cabang, Tanggal, Total Tagihan, Keterangan, opsional sudah dibayar berapa) — form yang sama dipakai juga di tab riwayat, jadi cuma satu implementasi form.
- Aksi per baris supplier di Ringkasan disederhanakan jadi satu tombol **"Bayar"** (sebelumnya "Bayar Sekaligus") — alokasi FIFO otomatis yang sudah ada secara alami menangani kasus 1 nota maupun banyak nota dengan kode yang sama, jadi tidak perlu tombol/mode terpisah.
- Mode "Bayar ke Supplier" di Kas Keluar (beserta 3 sub-mode "Bayar Sekaligus"/"Bayar 1 Tagihan"/"Catat Tagihan Baru" dari item #25) **dihapus total** — diganti tombol pintasan yang mengarahkan ke halaman Pembelian & Utang Supplier, supaya cuma ada satu jalur pencatatan.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/pembelian/page.tsx` | Default tab Ringkasan per Supplier; modal "+ Pembelian Baru"; tombol "Bayar" tunggal per supplier |
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Hapus mode "Bayar ke Supplier" & semua state/logika terkait; ganti dengan link pintasan ke halaman Pembelian |

### 29. Fitur: Aktifkan Alur Formal Pengajuan Kasbon (Admin Ajukan, Owner Approve) — Langkah 1 & 2

**Ditemukan:** Audit menyeluruh tab Keuangan (diminta Owner) menemukan `kasbon_requests` (alur "Pengajuan" formal di halaman Kasbon Karyawan) kosong total sejak awal — bukan cuma jarang dipakai, tapi memang tidak ada form "Ajukan Baru" di mana pun di aplikasi. Yang benar-benar jalan selama ini: pencairan instan tanpa approval lewat Kas Keluar → `kasbon_limits`, dipotong manual di Penggajian Bulanan. Ditambah, "Saldo" yang ditampilkan sebagai panduan admin di Penggajian Bulanan ternyata diambil dari `kasbon_requests` (kosong/tidak sinkron), bukan dari `kasbon_limits` yang sungguhan dipotong.

**Keputusan Owner:** Aktifkan alur formal sebagai satu-satunya sumber kebenaran (bukan hapus) — Admin/HR yang input pengajuan atas nama karyawan, tapi **persetujuan (Setujui/Tolak/Tandai Lunas) khusus role Owner**, supaya keputusan uang keluar tetap satu pintu.

**Langkah 1 — Form pengajuan:** Ditambahkan tombol "+ Ajukan Kasbon Baru" di tab Pengajuan (pilih karyawan, nominal, alasan → `kasbon_requests` status `pending`), dengan peringatan kalau melebihi `employees.kasbon_limit`.

**Langkah 2 — Kunci persetujuan ke Owner:** Tombol Setujui/Tolak/Tandai Lunas cuma tampil untuk role `owner`; role lain (hr) yang statusnya `pending` melihat badge "⏳ Menunggu Owner". Ditegakkan juga di level database — RLS `kasbon_req_update` sebelumnya mengizinkan owner **dan** hr, diperketat jadi owner-saja, supaya pembatasan bukan cuma sembunyi tombol di UI.

**Belum selesai (langkah 3, menyusul):** Mengunci pencairan Kas Keluar supaya hanya bisa cair dari pengajuan yang sudah disetujui (bukan input bebas), lalu sinkronkan potongan gaji di Penggajian Bulanan ke `kasbon_requests`/`kasbon_deductions` yang benar.

| File | Perubahan |
|---|---|
| `app/(dashboard)/kasbon/page.tsx` | Form "Ajukan Kasbon Baru"; gating role submit (owner/hr) vs approve (owner) |
| **DB** | RLS `kasbon_requests` update policy diperketat ke role owner saja |

### 30. Fitur: Pindahkan Persetujuan Kasbon ke Verifikasi Keuangan (Satu Pintu Approval)

**Permintaan Owner:** Semua approval sebaiknya ada di satu tempat (Verifikasi Keuangan), bukan tersebar — pengajuan kasbon sebelumnya punya tombol Setujui/Tolak sendiri di halaman Kasbon Karyawan.

**Perubahan:** Ditambahkan tab "Kasbon" di Verifikasi Keuangan — Setujui (dengan input rencana cicilan: nominal/bulan, mulai kapan) dan Tolak (dengan alasan) diproses per-baris di sana, tetap owner-only (sesuai item #29). Halaman Kasbon Karyawan → tab Pengajuan tetap jadi tempat Admin/HR mengajukan dan melihat daftar, tapi baris `pending` sekarang cuma jadi link ke Verifikasi Keuangan, bukan tombol approve/reject duplikat.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/approval/page.tsx` | Tab "Kasbon" baru — modal Setujui (cicilan) & Tolak (alasan), owner-only |
| `app/(dashboard)/kasbon/page.tsx` | Hapus tombol/modal Setujui-Tolak dari tab Pengajuan, ganti link ke Verifikasi Keuangan |

### 31. Fitur: Kunci Pencairan Kasbon ke Pengajuan yang Disetujui + Sinkronkan Potongan Gaji (Langkah 3/3)

Menyelesaikan aktivasi alur formal kasbon (lanjutan item #29-30).

**Kas Keluar → Cairkan Kasbon:** Tidak lagi input bebas (pilih karyawan + ketik nominal). Sekarang wajib pilih dari pengajuan yang **sudah disetujui Owner dan belum dicairkan**, nominal ikut yang disetujui (tidak bisa diubah). Saat disimpan, `kasbon_requests.disbursed_at` ditandai — ditegakkan lewat RLS baru (`kasbon_req_disburse`: owner/hr/finance, cuma untuk baris `status='approved' AND disbursed_at IS NULL`).

**Penggajian Bulanan:** Potongan kasbon yang sebelumnya mengurangi ledger `kasbon_limits` (terputus dari `kasbon_requests` yang ditampilkan sebagai "Saldo") sekarang dialokasikan FIFO ke baris `kasbon_deductions` milik karyawan saat slip gaji ditandai "paid" (`applyKasbonDeductionFifo`), memperbarui `kasbon_requests.total_deducted` dan otomatis jadi `lunas` kalau sudah penuh. Hapus slip sekarang cuma mengembalikan cicilan yang memang ditandai oleh slip itu (link baru `kasbon_deductions.payroll_id`), bukan lump-sum berdasar nominal — sekalian memperbaiki bug lama: hapus slip draft/belum-paid yang ada nominal kasbon ketikan dulu salah menggelembungkan saldo karena reversal tidak pernah cek status.

**Kasbon Karyawan → Riwayat Potongan:** Tombol manual "Tandai Sudah Dipotong" dihapus (jadi murni tampilan baca) — sekarang cuma Penggajian Bulanan yang boleh menandai cicilan sebagai dipotong, supaya tidak ada dua jalur yang bisa saling tidak sinkron.

`kasbon_limits` tidak lagi ditulis/dibaca di mana pun (tabelnya sudah kosong dari awal, jadi tidak ada migrasi data yang diperlukan) — dibiarkan ada di database, tidak dihapus.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Mode Cairkan Kasbon pilih dari pengajuan approved, tandai `disbursed_at` |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | FIFO potongan ke `kasbon_deductions`; reversal presisi lewat `payroll_id` |
| `app/(dashboard)/kasbon/page.tsx` | Tab Riwayat Potongan jadi read-only |
| **DB** | Kolom baru `kasbon_requests.disbursed_at/disbursed_by`, `kasbon_deductions.payroll_id`; RLS `kasbon_req_disburse` |

### 32. Fix: Satukan Aturan Edit/Hapus Kas Keluar & Riwayat Kas Keluar

**Ditemukan (lanjutan audit tab Keuangan, temuan #2):** Kas Keluar ("10 Input Terakhir"/"Perlu Direvisi", entri milik sendiri) dan Riwayat Kas Keluar (semua cabang/bulan, admin) masing-masing punya `canEditRow`/`canDeleteRow`/`saveEditRow` sendiri untuk tabel `fin_cash_out` yang sama, dan sudah telanjur beda: Riwayat tidak bisa edit entri `rejected` (tidak ada jalur ajukan-ulang) dan tidak bisa perbaiki nominal salah ketik pembayaran supplier — dua kemampuan yang sudah ada di Kas Keluar. Akibatnya admin yang mau perbaiki entri `rejected` milik ADMIN LAIN (mustahil dari Kas Keluar karena scope-nya "punya saya sendiri") juga mentok di Riwayat.

**Fix:** Aturan & logika simpan diekstrak ke `lib/finCashOut.ts` (`canEditCashOut`, `canDeleteCashOut`, `saveCashOutEdit` — termasuk cek sisa utang supplier, pakai ulang `unrequestedFor` yang sudah ada), dipakai bareng oleh kedua halaman. Riwayat sekarang juga mendukung alur ajukan-ulang (`rejected` → `revisi`) dan menampilkan badge/filter status Revisi, sama seperti Kas Keluar.

| File | Perubahan |
|---|---|
| `lib/finCashOut.ts` | Modul baru — aturan & logika simpan edit `fin_cash_out` |
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Pakai `lib/finCashOut.ts` |
| `app/(dashboard)/keuangan/riwayat/page.tsx` | Pakai `lib/finCashOut.ts`; tambah alur revisi & badge/filter status |

### 33. Fix: Rapikan Menu Sidebar Keuangan

**Ditemukan:** Owner merasa menu Keuangan berantakan — 11 item level-atas (3 grup + 8 link datar), termasuk 5 halaman laporan (Dashboard Keuangan, Detail Laporan per Cabang, Cash Flow per Rekening, Laporan Resmi, Logistik) yang tersebar tanpa dikelompokkan.

**Fix:** 5 halaman laporan digabung jadi satu grup baru "Laporan". Petty Cash dipindah ke sebelah Pembelian & Utang Supplier. Verifikasi Keuangan tetap sendiri di akhir (bukan laporan, tapi antrean tugas harian). Total jadi 7 item level-atas. Cuma menyentuh menu admin (owner/hr/finance/supervisor) — menu karyawan sudah punya daftar sendiri yang lebih pendek, tidak termasuk keluhan ini.

| File | Perubahan |
|---|---|
| `components/sidebar.tsx` | Grup baru "Laporan"; reorder Petty Cash & Verifikasi Keuangan |

### 34. Fitur: Pisah Menu Keuangan Jadi "Keuangan" (Input) vs "Laporan Keuangan" (Baca-Saja)

**Permintaan Owner:** Submenu "Laporan" (item #33) dijadikan tab sendiri sejajar Keuangan, bukan nested — supaya jelas mana yang input, mana yang laporan. Riwayat Kas Keluar juga dipindah ke Laporan Keuangan (sifatnya browse/audit lintas cabang, bukan input). Verifikasi Keuangan tetap di tab Keuangan (bukan input maupun laporan, tapi antrean tugas harian, lebih dekat ke sisi proses).

**Kasus khusus — Pembelian & Utang Supplier:** halaman ini sengaja SATU halaman berisi dua hal (form input pembelian + Ringkasan per Supplier, hasil penggabungan item #28). Daripada duplikat jadi dua halaman terpisah (menghidupkan lagi masalah dua implementasi), komponennya diekstrak ke `PembelianPageContent.tsx` yang menerima prop `defaultTab`, dengan dua rute tipis: `/keuangan/pembelian` (menu Laporan Keuangan → default Ringkasan) dan `/keuangan/pembelian/input` (menu Keuangan → default Catat Pembelian). Satu implementasi, dua pintu masuk.

**Fix sampingan:** logika highlight menu level-atas diperbaiki dari cek prefix URL (`pathname.startsWith(item.href)`) jadi cek rekursif ke leaf href masing-masing (`hasActiveDescendant`) — perlu karena Keuangan & Laporan Keuangan sekarang berbagi awalan `/keuangan/*` yang sama, jadi cek prefix lama bisa membuat DUA grup ke-highlight sekaligus.

| File | Perubahan |
|---|---|
| `components/sidebar.tsx` | Grup "Laporan" jadi tab top-level "Laporan Keuangan"; pindah Riwayat Kas Keluar & Ringkasan Supplier ke sana; fix highlight rekursif |
| `app/(dashboard)/keuangan/pembelian/PembelianPageContent.tsx` | File baru — komponen asli, sekarang terima prop `defaultTab` |
| `app/(dashboard)/keuangan/pembelian/page.tsx` | Jadi wrapper tipis, `defaultTab="ringkasan-supplier"` |
| `app/(dashboard)/keuangan/pembelian/input/page.tsx` | Rute baru, wrapper tipis, `defaultTab="input"` |
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | 2 link ke Pembelian diarahkan ke `/keuangan/pembelian/input` |

### 35. Fix: Rincian per Supplier di Detail Laporan Bocor Data Bulan Depan

**Ditemukan:** Owner filter bulan Agustus di Detail Laporan per Cabang, tapi nota pembelian 1 September ikut muncul di "Rincian per Supplier". Kartu ringkasan "Sisa Utang ke Supplier (per akhir {bulan})" di atasnya sebenarnya SUDAH benar (sudah difilter sampai akhir bulan terpilih) — tapi daftar rinciannya di bawah masih dibangun dari data pembelian & pembayaran ALL-TIME (tidak difilter), jadi dua angka itu tidak sinkron.

**Fix:** Rincian per Supplier sekarang dibangun dari data yang sama (`purchasesUpToMonth`/`paymentsUpToMonth`) yang sudah dipakai kartu ringkasan, dan labelnya ditambah "(per akhir {bulan})" supaya jelas cakupannya.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Rincian per Supplier ikut filter bulan, bukan data all-time |

### 36. Fitur: Indikator Naik/Turun vs Bulan Lalu di Rincian Pengeluaran per Kategori

**Permintaan Owner:** setiap baris kategori di "Rincian Pengeluaran per Kategori" (dan total Rincian Penggajian) diberi indikator naik/turun dibanding bulan lalu — panah, persentase, dan selisih nominalnya.

**Fix:** Ditambahkan fetch ringan (category, amount, status saja) untuk `fin_cash_out` bulan sebelumnya, dijumlah per kategori (entri disetujui saja, sama seperti total bulan berjalan), lalu ditampilkan di bawah nominal tiap baris: 🔺 merah kalau naik (nominal bertambah — kurang bagus), 🔻 hijau kalau turun, atau "🆕 baru bulan ini" kalau kategori itu nol di bulan lalu (menghindari persentase tak terhingga).

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Fetch data bulan lalu; indikator panah/persen/selisih per kategori & Rincian Penggajian |

**Susulan:** indikator yang sama diterapkan juga ke total "Rincian Pemasukan (Kas Masuk)" — arahnya dibalik dari pengeluaran (`higherIsBetter`): untuk pemasukan, naik = hijau (bagus), turun = merah.

### 37. Fitur: Absen Mandiri via HP (Kamera + Radius GPS) — Test Drive, Fingerprint Tetap Jalan

**Latar belakang:** Owner ingin coba alternatif fingerprint karena proses impor datanya (export dari mesin → upload manual) merepotkan, dan sebagian cabang malah belum punya mesin sama sekali. Diputuskan: bukan pengganti, tapi test drive per-cabang yang berjalan BARENGAN dengan fingerprint yang sudah ada.

**Cara kerja:** Karyawan buka Portal Absensi → kartu "Absen Sekarang" (cuma muncul kalau cabangnya sudah diaktifkan). Urutannya: cek jarak GPS ke cabang dulu (ditolak halus dengan pesan jarak kalau di luar radius, kamera belum dibuka) → baru buka kamera **di dalam halaman** (bukan aplikasi kamera HP, jadi tidak pernah ada opsi pilih dari galeri) → foto dapat watermark nama/waktu/jarak otomatis → dikirim, langsung tercatat sebagai absen masuk/pulang.

**Keamanan berlapis:** RLS baru membatasi karyawan cuma boleh tulis baris absensi miliknya sendiri, tanggal hari ini saja, dan cuma yang ditandai `source='mobile'` — tidak bisa sentuh data fingerprint/manual. Kalau HP/GPS/kamera bermasalah, HR/Owner tetap bisa input manual di Rekap Absensi, tapi sekarang **wajib isi alasan** (dulu opsional) dan otomatis ditandai `source='manual'` — supaya ada jejak jelas kenapa tidak lewat HP.

**Konsistensi hitungan:** Logika "telat berapa menit"/lembur yang tadinya cuma ada di kode Import Fingerprint, diekstrak ke `lib/attendanceSchedule.ts` dan dipakai bareng oleh jalur HP — supaya hasil hitungnya sama persis, tidak ada rumus dobel yang bisa diam-diam beda.

**Setup per cabang:** Halaman Manajemen Cabang punya kolom Latitude/Longitude/Radius baru (tombol "Pakai lokasi saya sekarang" buat isi cepat) — dikosongkan = cabang itu belum ikut test drive, karyawannya tetap pakai fingerprint seperti biasa, tidak ada yang berubah.

**Verifikasi:** Rekap Absensi (admin) sekarang menampilkan ikon 📷 di sebelah jam masuk/pulang yang berasal dari absen HP — bisa diklik untuk lihat fotonya langsung, jadi ada cara nyata mengecek bukti kalau ada kecurigaan.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Komponen baru — alur cek radius → kamera live → kirim |
| `lib/attendanceSchedule.ts` | Modul baru — rumus telat/lembur/jarak, dipakai bareng Import & absen HP |
| `app/api/attendance/import/route.ts` | Pakai `lib/attendanceSchedule.ts`, bukan salinan sendiri |
| `app/(dashboard)/portal/absensi/page.tsx` | Render `AbsenSekarang` |
| `app/(dashboard)/cabang/page.tsx` | Kolom Latitude/Longitude/Radius + tombol lokasi saat ini |
| `app/(dashboard)/absensi/rekap/page.tsx` | Alasan wajib untuk input manual status hadir; link foto absen HP |
| **DB** | Kolom baru `branches.latitude/longitude/checkin_radius_meters`, `attendances.source` + kolom foto/lokasi; RLS mobile check-in; bucket storage publik `attendance-photos` |

### 38. Fitur: Daftar Akun Mandiri untuk Karyawan (Self-Service Signup)

**Ditemukan:** Cuma 4 dari 25 karyawan aktif yang punya akun login — sisanya harus dibuatkan satu-satu lewat Manajemen User. Ini jadi penghalang nyata buat fitur Absen HP (item #37) yang baru dibuat, karena semua karyawan butuh akun sendiri untuk pakai Portal Absensi.

**Fix:** Halaman publik baru `/signup` (tanpa login) — karyawan input Kode Karyawan-nya, verifikasi identitas pakai Nomor HP ATAU Tanggal Lahir (sesuai data HR, pilih salah satu), lalu pilih email & password sendiri. Endpoint `/api/signup` (pola sama seperti `/api/users` yang sudah ada — pakai service_role di server): role akun baru **selalu** `employee`, dipaksa di server, tidak pernah diambil dari input klien; kalau karyawan itu sudah punya akun, ditolak (tidak bisa dobel/bajak akun orang lain); pesan error digeneralisir supaya tidak memudahkan orang menebak-nebak Kode Karyawan aktif satu-satu. Promosi ke role lain (supervisor/HR/dst) tetap lewat Manajemen User seperti biasa.

| File | Perubahan |
|---|---|
| `app/(auth)/signup/page.tsx` | Halaman daftar akun baru |
| `app/api/signup/route.ts` | Endpoint publik — verifikasi & buat akun |
| `app/(auth)/login/page.tsx` | Link ke halaman daftar |

### 39. Fix Kritis: Dashboard Keuangan Hitung Ganda HPP + Omset, Laba Kotor/Bersih Salah

**Ditemukan (audit ulang tab Keuangan):** Tabel `fin_hpp_entries` menyimpan dua jenis baris (`entry_type` = `hpp` atau `omset`, sejak item #22), tapi query di Dashboard Keuangan menjumlahkan SEMUA baris ke satu keranjang "HPP" tanpa filter `entry_type` — beda dari Laporan Resmi yang sudah benar memfilternya. Dicek ke data Agustus 2026: HPP asli Rp2,64M, Omset Rp2,80M — Dashboard menjumlahkan jadi "HPP" ≈ Rp5,44M (hampir 2x lipat), bikin Laba Kotor & Laba Bersih di Dashboard salah dan tidak nyambung dengan angka yang benar di Laporan Resmi untuk bulan yang sama.

**Fix:** Tambah `.eq('entry_type', 'hpp')` di query tersebut, sama seperti Laporan Resmi.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/dashboard/page.tsx` | Query HPP difilter `entry_type='hpp'`, tidak ikut Omset lagi |

### 40. Fitur: Edit/Hapus untuk Aset & Kontrak Sewa, Hapus untuk HPP/Omset dan Modal Cabang

**Ditemukan (audit ulang tab Keuangan):** Tabel `fin_assets`, `fin_asset_contracts`, `fin_hpp_entries`, `fin_branch_capital_baseline`, `fin_branch_capital_snapshot` semuanya sudah punya RLS DELETE owner-only (dan untuk HPP/Modal, UPDATE terbatas ke status pending) — tapi tidak ada tombol di UI yang memakainya. Kalau ada salah input (misal salah cabang atau salah ketik), satu-satunya jalan adalah minta Finance menolak lewat Verifikasi, padahal itu untuk "data ini salah secara substansi", bukan "typo perlu dibetulkan".

**Fix:**
- Aset & Kontrak Sewa: tambah Edit lewat modal (nama/jenis/nilai/tanggal/kondisi/catatan untuk aset; jenis/tanggal/sewa/siklus/pengingat/catatan untuk kontrak), dibatasi ke entri berstatus pending (sama seperti pola di halaman lain), plus tombol Hapus khusus owner.
- HPP & Omset: tambah Hapus di sebelah Edit inline yang sudah ada, khusus owner.
- Modal Cabang: tambah Hapus untuk baris baseline maupun snapshot, khusus owner — untuk baseline, hapus juga membuka lagi cabang tersebut untuk pengajuan baseline baru.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/aset/page.tsx` | Modal Edit + tombol Hapus untuk aset dan kontrak sewa |
| `app/(dashboard)/keuangan/hpp/page.tsx` | Tombol Hapus di samping Edit inline |
| `app/(dashboard)/keuangan/modal/page.tsx` | Tombol Hapus untuk baseline & snapshot |

### 41. Fix: Export Omzet per Cabang Juga Hitung Ganda HPP + Omset

**Ditemukan:** Bug yang sama persis dengan item #39 (Dashboard Keuangan), tapi di fungsi export CSV "Export Omzet per Cabang" di halaman Laporan Resmi — query HPP-nya juga tidak difilter `entry_type='hpp'`, jadi kolom "HPP" dan "Laba Kotor" di file CSV yang diunduh akan salah dengan cara yang sama (hampir 2x lipat). Tabel di layar (`computeTotals`, baris 116-117) sudah benar sejak awal — cuma fungsi export ini yang kena.

**Fix:** Tambah `.eq('entry_type', 'hpp')` di query export tersebut.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Query HPP di `handleExportOmzetPerCabang` difilter `entry_type='hpp'` |

### 42. Fitur: Dark Mode

**Permintaan Owner:** "saya ingin ada fitur dark mode, sistem ini, bisa?"

**Cara kerja:** Tombol ganti tema (ikon matahari/bulan) di navbar, di sebelah info user & tombol Keluar. Pilihan disimpan di `localStorage`, dibaca lewat skrip kecil yang jalan sebelum React hydrate (di `app/layout.tsx`) supaya tidak ada kedip (flash) ke tema terang dulu saat halaman dimuat. Sengaja TIDAK mengikuti pengaturan gelap otomatis dari OS/browser — cuma aktif kalau tombolnya ditekan sendiri, sesuai niat awal yang sudah ada di catatan `globals.css` soal input/select harus konsisten dengan tema aktif, bukan ikut OS.

**Pendekatan teknis:** App ini punya puluhan halaman yang semuanya hardcode warna terang (`bg-white`, `text-slate-800`, dst) tanpa varian `dark:` di masing-masing file, karena dari awal didesain selalu terang. Mengedit tiap halaman satu-satu tidak realistis, jadi dipakai pendekatan terpusat: kelas warna yang PALING SERING dipakai (hasil audit `grep` ke seluruh `app/` & `components/` — slate netral + 10 warna aksen) di-remap sekaligus di `globals.css` ketika class `dark` aktif di `<html>`, pakai tabel pembalikan skala warna (50↔950, 100↔900, 200↔800, 300↔700, 400↔600) dan variabel warna bawaan Tailwind v4 (`var(--color-x-y)`). Aturan ini ditulis di luar `@layer` supaya otomatis menang atas utility Tailwind tanpa perlu `!important`.

**Keterbatasan yang perlu diketahui:** Ini bukan `dark:` per-elemen yang didesain halaman-per-halaman — kombinasi warna yang jarang dipakai atau di luar daftar hasil audit bisa saja masih kelihatan aneh di beberapa halaman. Belum sempat diverifikasi visual satu-satu di browser (server dev yang sedang jalan terpakai proses lain di port 3000); kalau ada bagian yang kontras/warnanya tidak pas di dark mode, laporkan halaman & elemennya supaya bisa ditambahkan aturan yang cocok di `globals.css`.

| File | Perubahan |
|---|---|
| `app/globals.css` | `@custom-variant dark`, variabel `--background`/`--foreground` untuk `.dark`, ~130 aturan remap warna |
| `app/layout.tsx` | Skrip inline baca `localStorage` sebelum hydrate, cegah flash |
| `components/ThemeToggle.tsx` | Baru — tombol toggle matahari/bulan |
| `components/DashboardShell.tsx` | Pasang `<ThemeToggle />` di navbar |

### 43. Simplifikasi: Laporan Resmi Jadi Bulanan Saja, Tab Mingguan Dihapus

**Permintaan Owner:** "untuk laporan resmi, sepertinya, filter perbulan, harus anda hapus, cukup laporan perbulan saja" — dikonfirmasi maksudnya: hapus tab pemilihan Mingguan/Bulanan, sisakan tampilan Bulanan saja (input pilih bulan tetap ada).

**Fix:** Tab switcher "Laporan Mingguan"/"Laporan Bulanan" dan seluruh cabang kode yang bergantung padanya (helper `isoWeekRange`/`getCurrentIsoWeek`/`shiftWeek`, input `type="week"`, kondisi `tab === 'mingguan'`/`'bulanan'` di berbagai tempat) dihapus. Halaman sekarang selalu menghitung berdasarkan bulan yang dipilih; realisasi kasbon (yang sebelumnya cuma aktif saat tab Bulanan) sekarang selalu dihitung.

**Terkait:** Owner juga sempat menanyakan kenapa kartu "Total Konsolidasi" bisa menampilkan Laba Kotor minus (Rp-746 juta) untuk Agustus — ditelusuri: itu bukan kerugian riil, tapi karena Laba Kotor di kartu itu dihitung dari Kas Masuk (uang tercatat masuk manual) dikurangi HPP (dari sistem kasir), dan Kas Masuk Agustus jauh lebih kecil dari Omset Sistem — 845 juta dari selisih ~900 juta itu berasal dari kelompok "Gudang & Back Office" yang wajar (uang dari cabang ke Gudang sering lewat piutang/transfer internal, bukan kas tunai langsung, lih. [[project_internal_suppliers]]). Kartu ungu "Omset & HPP Sistem Kasir vs Kas Real" di bawahnya sudah punya angka Laba Kotor (Sistem) yang benar (+Rp160,5 juta). Persentase naik/turun yang ekstrem (+231%, +100%, dst.) juga karena Juli belum punya data HPP/Omset sama sekali (fitur itu baru dipakai mulai Agustus) — bukan perubahan bisnis beneran. Belum ada perubahan kode untuk ini, baru penjelasan ke Owner.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Hapus tab Mingguan & helper minggu; `computeTotals`/`fetchData` selalu bulanan |

### 44. Fitur: Cetak/Simpan PDF untuk Detail Laporan per Cabang

**Permintaan Owner:** "untuk laporan percabang ini, apakah bisa di buatkan fitur print dokumentnya? dalam bentuk PDF? untuk di print, demi keperluan arsip."

**Cara kerja:** Tombol "🖨️ Cetak / Simpan PDF" di halaman Detail Laporan per Cabang. Saat diklik: semua bagian yang biasanya collapse (Rincian per Supplier, Rincian Pengeluaran per Kategori, Rincian Penggajian, Kehilangan, Pemasukan) otomatis dibuka dulu supaya dokumen arsipnya lengkap — bukan cuma yang kebetulan sedang terbuka di layar — lalu memanggil dialog print bawaan browser (semua browser modern punya opsi "Simpan sebagai PDF" di situ, jadi tidak perlu library PDF tambahan). Setelah selesai/dibatalkan, tampilan dikembalikan ke kondisi semula.

Hasil cetak SELALU terang (tidak ikut dark mode yang sedang aktif di layar — kelas `dark` dilepas sementara sebelum print, dikembalikan sesudahnya), navbar & sidebar disembunyikan, dan tabel yang tadinya dibatasi scroll (mis. Rincian Penggajian) dibuat mengalir penuh supaya tidak terpotong di kertas.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Tombol + `handlePrint` (expand semua, print, restore); `print:hidden` di filter/nav; hapus batas scroll saat print |
| `components/DashboardShell.tsx` | Navbar & sidebar `print:hidden`; layout jadi full-height saat print |
| `app/globals.css` | Reset ringan (background putih, margin halaman) untuk `@media print` |

### 45. Fitur: Ritase & Kendaraan, Ringkasan Eksekutif, dan Page-Break Print — Detail Laporan per Cabang

**Permintaan Owner:** "coba kerjakan semuanya... intinya saya ingin laporan detail percabang ini matang dengan sempurna, karena tujuannya adalah untuk di print, dan disajikan untuk owner." Tiga bagian, dikerjakan satu per satu:

**a) Ritase & Kendaraan.** Owner minta ringkasan ritase Gudang (kendaraan ke mana saja, berapa kali) untuk diarsipkan. Ternyata datanya sudah ada di `delivery_trips` (dipakai untuk hitung gaji driver, menu Penggajian &gt; Driver) — tidak perlu input baru. Ditambah section collapsible "🚚 Ritase & Kendaraan" yang otomatis muncul **cuma saat grup yang dipilih mencakup Gudang** (satu-satunya cabang berkendaraan), dikelompokkan per kendaraan → per tujuan → bisa expand lagi untuk lihat tanggal & nama driver per trip. Belum ada data jarak (KM) atau biaya per kendaraan di sistem — dicatat jujur di catatan kecil pada section-nya.

**b) Ringkasan Eksekutif.** Satu kalimat otomatis di bawah judul laporan, supaya Owner langsung dapat inti cerita. Prioritas: Laba Bersih (Sistem) bulan ini vs bulan lalu (paling bisa dipercaya) kalau datanya ada di kedua bulan; kalau bulan lalu belum ada data Sistem (mis. baru mulai pakai fitur HPP & Omset), turun ke Perkiraan Kas yang Harus Ada, dan TIDAK menampilkan persentase menyesatkan seperti "+100%" untuk kasus data-baru (sama prinsipnya dengan `monthDelta` yang sudah ada). Perlu 1 query tambahan di `fetchData` (HPP bulan lalu) yang sebelumnya tidak diambil.

**c) Kontrol Page-Break saat Print.** Kartu ringkasan (Ringkasan, Kondisi Cabang Saat Ini, Ritase & Kendaraan) diberi `print:break-inside-avoid` supaya tidak terpotong setengah di tengah pas ganti halaman kertas. Tabel transaksi panjang (Rincian Pengeluaran, Penggajian, Pemasukan) sengaja TIDAK diberi ini — dipaksa utuh justru bikin boros kertas & bolong besar kalau isinya panjang.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Section Ritase & Kendaraan (query `delivery_trips`, gate `GUDANG_BRANCH_ID`); `ringkasanEksekutif()` + query HPP bulan lalu; `print:break-inside-avoid` di 3 kartu ringkasan |

### 46. Fitur: Pengeluaran per Kategori per Cabang di Laporan Resmi

**Permintaan Owner:** setelah lihat Laporan Resmi, ternyata yang dimaksud bukan pembanding waktu (vs bulan lalu) — "laporan resmi itu isi nya tinggal anda tambahkan pengeluaran nya berdasarkan katagori, tidak pakai detail, tapi tampilkan setiap cabang nya, jadi owner bisa lihat secara langsung, bandingannya, vs masing2 cabang, untuk penilaian." Rencananya laporan ini dicetak berdampingan dengan Detail Laporan per Cabang (item #44-45) sebagai 2 dokumen arsip terpisah.

**Fix:** Tabel baru "Pengeluaran per Kategori per Cabang" di bawah tabel "Per Kelompok Laporan" yang sudah ada — baris = kategori pengeluaran, kolom = tiap cabang/kelompok, isi cuma total (bukan per-transaksi), plus kolom & baris Total. Sengaja TANPA indikator naik/turun vs bulan lalu — sumbu perbandingannya di sini antar-cabang (horizontal), bukan antar-waktu (yang sudah ada di badge Laba Bersih tabel atasnya, dan di `monthDelta` Detail Laporan per Cabang). Cakupannya disamakan dengan "Biaya Operasional" yang sudah ada (kategori `affects_net_profit=false`, mis. pembelian stok ke supplier, dikeluarkan — sudah dihitung di HPP) supaya baris Total per kolom persis sama dengan angka Biaya Operasional per kelompok di tabel atasnya — dicek manual lewat SQL, cocok.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Tabel matriks kategori x cabang baru; fetch `fin_cash_out_categories` & pivot per kategori per kelompok |

### 47. Fitur: Print/PDF di Laporan Resmi + Balik Orientasi Tabel Per Kelompok Laporan

**Permintaan Owner:** setelah lihat hasil item #46, dua hal — "harus nya laporan resmi pun ada fitur print nya" dan tabel "Per Kelompok Laporan" "seharus nya di balik orintasi nya, si cabang nya jadi kolom dan yang lain nya menjadi baris."

**Fix:**
- Tombol "🖨️ Cetak / Simpan PDF" ditambahkan ke Laporan Resmi, pola sama persis dengan Detail Laporan per Cabang (item #44): `window.print()`, tema dipaksa terang sementara, navbar/sidebar disembunyikan (sudah otomatis lewat `print:hidden` di `DashboardShell`).
- Tabel "Per Kelompok Laporan" dibalik: cabang jadi kolom, baris jadi metrik (Omset Sistem, Kas Masuk, HPP, Laba Kotor, Laba Kotor Sistem, Biaya Operasional, Realisasi Kasbon, Laba Bersih + panah vs bulan lalu, Laba Bersih Sistem) — supaya orientasinya sama dengan tabel "Pengeluaran per Kategori per Cabang" (item #46) di bawahnya, keduanya kebaca sama saat dicetak berdampingan.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Tombol + `handlePrint`; tabel Per Kelompok Laporan dibalik jadi metrik x cabang; `print:break-inside-avoid` di kartu ringkasan |

### 48. Fitur: Belanja/Dibayar ke Supplier & Kas Sesungguhnya (Real) di Laporan Resmi

**Permintaan Owner:** "tambahkan juga matriknya, belanja ke supplier, sebagai pembanding juga, lalu sampaikan juga, berapa kas sesungguhnya." Dijelaskan lebih lanjut: mau tahu Belanja (nota) vs yang sudah Dibayar, supaya kelihatan sisa utangnya; dan "kas sesungguhnya" = Kas Masuk dikurangi yang BENAR-BENAR sudah dibayar (bukan dikurangi nota yang masih utang). Sempat diminta matriks per-supplier, tapi Owner lalu minta disederhanakan jadi total saja per cabang (tidak usah dirincikan per supplier).

**Saran yang diberikan & dipakai:** utang yang belum dibayar TIDAK mengurangi Kas Sesungguhnya (uangnya belum benar-benar keluar) — ditampilkan terpisah sebagai baris "Sisa (Utang Bulan Ini)", supaya kewajiban yang menggantung tetap kelihatan tanpa menyamarkan kas yang masih ada.

**Fix:** 4 baris baru ditambahkan ke tabel "Per Kelompok Laporan" (item #47) yang sudah dibalik orientasinya:
- **Belanja ke Supplier (Nota)** — dari `supplier_purchases.purchase_date` bulan ini.
- **Dibayar ke Supplier** — pakai `pembayaranSupplierReal` yang sudah ada (kategori `pembayaran_supplier`).
- **Sisa (Utang Bulan Ini)** — Belanja dikurangi Dibayar, cuma dari transaksi bulan ini (BUKAN sisa utang akumulasi/total — itu tetap di Detail Laporan per Cabang).
- **Kas Sesungguhnya (Real)** — Kas Masuk dikurangi SEMUA kas keluar yang sudah benar-benar dibayar bulan ini (semua kategori, bukan cuma Biaya Operasional). Juga ditambahkan ke kartu Total Konsolidasi.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | `GroupTotals` tambah `belanjaSupplier`/`totalKasKeluar`; query baru `supplier_purchases`; 4 baris baru di tabel & Total Konsolidasi |

### 49. Fix: Kelompokkan Baris Per Kelompok Laporan Menurut Sumber Data (Sistem vs Kas Real)

**Ditemukan:** setelah item #48 nambah 4 baris baru, tabel "Per Kelompok Laporan" jadi 13 baris yang sumber datanya campur aduk tanpa pemisah jelas — Owner: "jujur saja, membaca ini sangat bingung, bisakah anda pisahkan berdasarkan, mana yang sistem (yang hanya sekedar angka) dengan yang beneran angka real, agar tau bedanya."

**Fix:** Dikelompokkan jadi 4 bagian dengan judul pemisah (baris penuh berwarna, span semua kolom):
- **📊 Data Sistem (Kasir/POS):** Omset, HPP, Laba Kotor, Laba Bersih — semuanya diberi label "(Sistem)" termasuk HPP yang sebelumnya cuma ditulis "HPP" polos padahal sumbernya sama-sama dari kasir.
- **💰 Kas Real:** Kas Masuk, Biaya Operasional, Realisasi Kasbon, Dibayar ke Supplier, Kas Sesungguhnya (Real).
- **📝 Nota & Utang Supplier:** Belanja (Nota), Sisa (Utang Bulan Ini) — transaksi nyata tapi belum tentu sudah jadi kas keluar.
- **🔀 Laba Campuran:** "Laba Kotor" & "Laba Bersih (vs periode lalu)" yang asli (Kas Masuk dikurangi HPP Sistem) — TETAP ada (bawa badge vs-bulan-lalu yang sebelumnya diminta dipertahankan), tapi sekarang judul bagiannya jujur menjelaskan bahwa ini campuran dua sumber berbeda, bukan angka yang berdiri sendiri.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Tabel Per Kelompok Laporan dikelompokkan jadi 4 bagian berjudul, bukan 13 baris berurutan tanpa pemisah |

### 50. Fix: Kelompokkan Kartu "Omset & HPP Sistem Kasir vs Kas Real" Juga

**Ditemukan:** keluhan yang sama dengan item #49, tapi di kartu ungu "Omset & HPP Sistem Kasir vs Kas Real" (Total Konsolidasi) — 6 angka (Omset, HPP, Laba Kotor, Laba Bersih Sistem, lalu Uang Diterima & Pembayaran Supplier Real) ada di satu grid tanpa pemisah.

**Fix:** Dipecah jadi 2 grid berlabel — "📊 Data Sistem (Kasir/POS)" (Omset, HPP, Laba Kotor, Laba Bersih) dan "💰 Kas Real" (Uang Diterima, Pembayaran Supplier, Sisa Kas Seharusnya Ada, Biaya Operasional) — dengan "Cek Kecukupan Kas" (Selisih Surplus/Defisit) tetap jadi kesimpulan di bawahnya.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Kartu Omset & HPP Sistem dipecah jadi grid Data Sistem & Kas Real terpisah |

### 51. Fix: Tabel Lebar di Laporan Resmi Kepencet Kecil Saat Print

**Ditemukan:** Owner cetak Laporan Resmi, tabel "Per Kelompok Laporan" & "Pengeluaran per Kategori per Cabang" (6 kolom: label + 5 cabang) kepencet jadi sangat kecil dan susah dibaca — halaman print masih potret (A4 210mm), tidak cukup lebar untuk tabel matriks sebanyak itu.

**Fix:** `@page { size: landscape }` diterapkan global untuk semua print di app ini (penggunaan print di app ini memang didominasi laporan tabel lebar, jadi landscape masuk akal jadi default). Ditambah class `.print-compact-table` (padding lebih rapat, font 10px, cuma aktif saat print) di kedua tabel matriks tersebut supaya makin banyak kolom cabang yang muat rapi.

| File | Perubahan |
|---|---|
| `app/globals.css` | `@page { size: landscape }`; class `.print-compact-table` baru |
| `app/(dashboard)/keuangan/laporan/page.tsx` | Class `print-compact-table` ditambahkan ke 2 tabel matriks |

### 52. Fix: Print Laporan Resmi Jadi Satu Blok per Cabang, Bukan Matriks Lagi

**Ditemukan:** landscape + tabel kompak (item #51) ternyata masih belum cukup — matriks 6 kolom (label + 5 cabang) tetap kepencet/terpotong di kertas. Owner: "bisakah dibuatkan khusus print nya? jadi per masing-masing cabang, dengan jelas."

**Fix:** Ditambahkan section khusus print (`hidden print:block`, tersembunyi di layar) yang me-render tiap cabang sebagai satu blok penuh sendiri — 4 bagian yang sama seperti tabel di layar (Data Sistem, Kas Real, Nota & Utang Supplier, Laba Campuran) plus rincian Pengeluaran per Kategori-nya — disusun ke bawah dengan jeda halaman baru di tiap cabang. Tabel matriks di layar (Per Kelompok Laporan, Pengeluaran per Kategori per Cabang) di-`print:hidden` karena sudah digantikan section ini khusus untuk cetak — di layar keduanya tetap tampil seperti biasa untuk perbandingan cepat antar cabang.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/laporan/page.tsx` | Section print-only per cabang (satu halaman per cabang); 2 tabel matriks jadi `print:hidden` |

### 53. Fitur: Toggle Potret/Lanskap saat Print, Bukan Dipaksa Lanskap

**Permintaan Owner:** "buatkan saja bisa potrait atau landscape, tadi saya salah sangka" — setelah item #52 mengubah Laporan Resmi jadi cetak per-cabang (satu kolom, bukan matriks lebar lagi), lanskap yang dipaksakan sebelumnya (item #51) jadi tidak selalu relevan.

**Fix:** `@page { size: landscape }` yang di-hardcode dihapus, dikembalikan ke potret sebagai default. Ditambahkan toggle "Potret" / "Lanskap" kecil di sebelah tombol Cetak, di Laporan Resmi maupun Detail Laporan per Cabang. Karena `@page` tidak bisa di-scope pakai class biasa, orientasi pilihan disisipkan sebagai tag `<style>` sesaat sebelum `window.print()` dipanggil, lalu dilepas lagi sesudahnya.

| File | Perubahan |
|---|---|
| `app/globals.css` | `@page` kembali ke potret sebagai default |
| `app/(dashboard)/keuangan/laporan/page.tsx` | Toggle Potret/Lanskap; `handlePrint` sisipkan `<style>` @page |
| `app/(dashboard)/keuangan/laporan/detail/page.tsx` | Sama, untuk konsistensi |

---

*Terakhir diupdate: Sesi 4 (2026-09-12), lanjutan*
