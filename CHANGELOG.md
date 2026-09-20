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

### 54. Fitur: Lupa Password (Reset Mandiri)

**Konteks:** Sign up mandiri untuk karyawan sudah ada (Kode Karyawan + verifikasi HP/tanggal lahir → `/api/signup`), tapi karyawan yang sudah punya akun dan lupa password sebelumnya cuma bisa "hubungi HR" — belum ada jalur reset mandiri.

**Fix:** Alur reset password standar Supabase Auth: halaman `/forgot-password` (input email → `supabase.auth.resetPasswordForEmail`) → email berisi link ke `/auth/callback` (tukar `code` jadi sesi via `exchangeCodeForSession`) → redirect ke `/reset-password` (input password baru → `supabase.auth.updateUser`) → sign out dari sesi recovery → redirect ke `/login`. Pesan sukses di `/forgot-password` sengaja digeneralisir (tidak bilang email ditemukan/tidak) supaya tidak bisa dipakai menebak-nebak email karyawan yang punya akun, sama seperti pola di endpoint signup.

| File | Perubahan |
|---|---|
| `app/(auth)/forgot-password/page.tsx` | Baru — form input email untuk kirim link reset |
| `app/(auth)/reset-password/page.tsx` | Baru — form password baru + konfirmasi |
| `app/auth/callback/route.ts` | Baru — tukar `code` dari link email jadi sesi, redirect ke `next` |
| `app/(auth)/login/page.tsx` | Link "Lupa password?" di sebelah label Password |
| `proxy.ts` | `/forgot-password` & `/reset-password` ditambahkan ke `PUBLIC_ROUTES` |

**Catatan setup manual (Supabase Dashboard):** Authentication → URL Configuration harus ada `<domain-produksi>/auth/callback` di daftar Redirect URLs, kalau belum, email reset akan gagal redirect setelah user klik link-nya.

### 55. Fix: 4 Bug di Tampilan Karyawan

**Ditemukan:** Audit halaman-halaman yang dipakai role `employee`/`supervisor`, sambil mendalami rencana redesain menu karyawan.

1. **Label debug "(Test Drive)"** masih tampil di judul widget Absen Sekarang (`AbsenSekarang.tsx`) — kelihatan setiap kali karyawan mau absen lewat HP.
2. **RPC `approve_leave_request` menimpa data absensi asli jadi NULL** — kalau HR approve cuti/sakit untuk tanggal yang ternyata sudah ada data absensi asli (fingerprint/HP, misal pengajuan diproses telat/backdate), jam masuk-pulang & lembur yang sudah tercatat ikut terhapus, diganti status cuti.
3. **Cetak Slip Gaji ikut mencetak seluruh halaman** — tombol Cetak di modal detail slip cuma panggil `window.print()` polos, tidak ada isolasi print, jadi ikut ke-print: judul halaman, filter tahun, dan grid semua kartu slip gaji lain di belakang modal.
4. **Supervisor tidak bisa lihat pengajuan cuti anak buahnya** di `/cuti` — RLS `leave_read_supervisor` sudah mengizinkan lihat seluruh cabangnya, tapi kode client di halaman ini malah ikut memfilter ke diri sendiri untuk semua role selain hr/owner (termasuk supervisor), jadi kebijakan RLS-nya jadi tidak pernah kepakai.

**Fix:**
1. Hapus teks "(Test Drive)" dari judul.
2. `ON CONFLICT` di fungsi `approve_leave_request` ditambah `WHERE attendances.check_in IS NULL AND attendances.check_out IS NULL` — kalau tanggal itu sudah ada data absensi asli, baris itu dilewati apa adanya (tidak ditimpa), bukan dipaksa NULL.
3. Header, filter tahun, dan grid kartu slip di halaman Portal Slip Gaji dikasih `print:hidden`; modal detail diubah dari `fixed` + backdrop hitam jadi `print:static print:bg-white` tanpa backdrop saat print; tombol Cetak/Tutup di dalam modal juga `print:hidden`.
4. Filter self di `/cuti` sekarang cuma berlaku untuk role `employee`, tidak lagi untuk `supervisor` — biar RLS `leave_read_supervisor` yang menentukan cakupan datanya.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Hapus label "(Test Drive)" |
| `app/(dashboard)/cuti/page.tsx` | Filter self di `fetchRequests` cuma untuk role `employee` |
| `app/(dashboard)/portal/slip-gaji/page.tsx` | `print:hidden` di header/filter/grid; modal detail jadi print-friendly |
| Database (fungsi `approve_leave_request`) | `ON CONFLICT ... WHERE check_in IS NULL AND check_out IS NULL` — lindungi data absensi asli |

### 56. Fitur: Redesain Menu Karyawan — Jadwal Shift/Libur, Jatah Cuti, Kasbon Self-Service

**Konteks:** Owner minta menu karyawan dirapikan: cukup Dashboard, Portal Saya (+info shift/libur/jatah cuti), Cuti & Izin (dengan aturan minimal 1 tahun masa kerja + sinkron absensi — item ini ternyata sudah ada duluan, lihat #55), dan Kasbon (harus lewat pengajuan sendiri).

**Fix/Fitur:**
1. **Tabel baru `employee_roster`** (migrasi `026_employee_roster.sql`) — jadwal shift/libur per karyawan per tanggal, direncanakan di muka oleh HR/Owner. RLS: karyawan baca sendiri, supervisor baca cabangnya, HR/Owner CRUD semua.
2. **Aturan Cuti Tahunan** (`lib/leaveQuota.ts`, dipakai di `/cuti/ajukan`, `/portal/jadwal`, Dashboard): kuota flat 12 hari per tahun masa kerja (dihitung dari ulang tahun `join_date`, bukan tahun kalender) — dihitung dinamis dari `leave_requests` yang pending+approved, tidak ada tabel saldo terpisah. Submit ditolak keras kalau masa kerja < 1 tahun atau melebihi sisa jatah. Jenis cuti lain (sakit/izin/duka) tidak kena aturan ini.
3. **Kasbon self-service**: tombol "Ajukan Kasbon" kini juga muncul untuk role employee/supervisor (form tanpa pilih nama, otomatis dirinya sendiri) — RLS `kasbon_req_insert_employee` sudah lama mengizinkan ini, cuma belum ada UI-nya.
4. **`/absensi/shift`** diubah dari halaman info statis jadi editor roster: HR/Owner pilih karyawan + rentang tanggal, set shift (dari `work_schedules` departemennya) atau tandai libur per hari.
5. **`/portal/jadwal`** (baru): karyawan lihat jadwal 14 hari ke depan + sisa jatah cuti tahunan.
6. **Sidebar karyawan**: submenu Keuangan dihapus total (RLS sudah menolak employee di semua tabel `fin_*`, jadi menunya cuma jalan buntu); "Jadwal Saya" ditambahkan ke Portal Saya.
7. **Dashboard karyawan**: kartu placeholder statis diganti kartu nyata (jadwal hari ini, sisa cuti, jumlah kasbon pending) khusus untuk role employee/supervisor; role lain tetap seperti semula.

| File | Perubahan |
|---|---|
| Database: `employee_roster` (migrasi `026_employee_roster.sql`) | Tabel baru + RLS |
| `lib/leaveQuota.ts` | Baru — helper masa kerja & kuota cuti tahunan |
| `app/(dashboard)/cuti/ajukan/page.tsx` | Validasi masa kerja + kuota untuk leave_type `annual` |
| `app/(dashboard)/kasbon/page.tsx` | Form self-service untuk employee/supervisor |
| `app/(dashboard)/absensi/shift/page.tsx` | Diubah total jadi editor roster |
| `app/(dashboard)/portal/jadwal/page.tsx` | Baru — halaman Jadwal Saya |
| `app/(dashboard)/dashboard/page.tsx` | Kartu nyata untuk role employee/supervisor |
| `components/sidebar.tsx` | Hapus submenu Keuangan dari menu karyawan; tambah Jadwal Saya |

---

### 57. Fitur: Undangan Interview Personal untuk Pelamar

**Permintaan Owner:** link undangan wawancara per kandidat — isi jadwal, dress code (casual rapi, bukan kemeja formal), wajib bawa CV fisik, info gaji training Rp800rb/bulan + bonus Rp400rb bulan terakhir setelah 3 bulan training, tips bicara lancar & lugas, kandidat bisa konfirmasi kehadiran langsung di sistem, dan hasil tes+penilaian ditampilkan juga ke kandidat.

**Fix/Fitur:**
1. **`job_applicants`** dapat 4 kolom baru (migrasi `027_interview_invite.sql`): `interview_token` (uuid unik, auto-generate, dasar link personal), `interview_scheduled_at`, `interview_confirmation`, `interview_confirmed_at`.
2. **`/lamaran/interview/[token]`** (baru, publik) — halaman undangan personal per kandidat: jadwal (dinamis dari `interview_scheduled_at`, bisa beda tiap batch rekrutmen), dress code, bawa CV fisik, info gaji training, tips wawancara, DAN hasil psikotes+psikometri kandidat sendiri, plus form konfirmasi kehadiran bebas teks (mis. "Akan hadir sekitar jam 10.15").
3. **`/api/lamaran/interview/[token]`** (baru) — GET ambil data undangan by token, POST simpan konfirmasi kehadiran. Pola sama seperti `/api/lamaran/status` (service-role, tanpa RLS anon).
4. **`/rekrutmen/pelamar`**: di modal Detail Pelamar, HR sekarang bisa set/ubah jadwal interview lewat datepicker, lalu kirim link undangan langsung ke WhatsApp kandidat (pesan sudah terisi otomatis) — juga menampilkan konfirmasi kehadiran kandidat begitu masuk.
5. Logic render skor psikotes & psikometri dipisah ke `lib/psychometricSummary.tsx` supaya dipakai bareng oleh halaman admin (sudah ada) dan halaman kandidat (baru) tanpa duplikasi.

| File | Perubahan |
|---|---|
| Database: `job_applicants` (migrasi `027_interview_invite.sql`) | 4 kolom baru + index token |
| `lib/psychometricSummary.tsx` | Baru — logic render hasil tes, dipakai bareng 2 halaman |
| `app/api/lamaran/interview/[token]/route.ts` | Baru — GET undangan, POST konfirmasi |
| `app/lamaran/interview/[token]/page.tsx` | Baru — halaman undangan interview untuk kandidat |
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Set jadwal interview + kirim link WA + tampilkan konfirmasi kandidat |

---

### 58. Fix: Jadwal Interview Jadi Satu Pengaturan Seragam, Bukan Per-Kandidat

**Permintaan Owner:** "untuk jadwalnya buatkan pengaturan khusus saja, jadi semua seragam" — jadwal per-kandidat (item #57) diganti satu pengaturan yang berlaku untuk semua kandidat, plus tambahan alamat & link Google Maps.

**Fix:**
1. `job_applicants.interview_scheduled_at` (per-kandidat, dari #57) dihapus. Diganti 3 kolom baru di `recruitment_settings` (migrasi `028_interview_schedule_uniform.sql`, `029_interview_location.sql`): `interview_scheduled_at`, `interview_address`, `interview_map_url` — satu baris pengaturan untuk semua kandidat.
2. Halaman **Pengaturan Rekrutmen** (`/rekrutmen`) dapat kartu baru "Jadwal & Lokasi Interview": tanggal/jam, alamat, dan link Google Maps — sekali isi, berlaku untuk semua undangan.
3. Halaman undangan kandidat (`/lamaran/interview/[token]`) sekarang juga menampilkan alamat + tombol "Buka di Google Maps".
4. Modal Detail Pelamar tidak lagi punya date-picker sendiri — cuma menampilkan jadwal seragam yang sedang berlaku + tombol kirim link WhatsApp per kandidat.

| File | Perubahan |
|---|---|
| Database: `recruitment_settings` (migrasi `028`, `029`), `job_applicants` (migrasi `028`) | Kolom jadwal/lokasi pindah ke `recruitment_settings` |
| `app/(dashboard)/rekrutmen/page.tsx` | Kartu baru "Jadwal & Lokasi Interview" |
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Date-picker per-kandidat dihapus, baca jadwal seragam dari `recruitment_settings` |
| `app/api/lamaran/interview/[token]/route.ts` | Baca jadwal & lokasi dari `recruitment_settings`, bukan per-kandidat |
| `app/lamaran/interview/[token]/page.tsx` | Tampilkan alamat + link Google Maps |

---

### 59. Fix Keamanan: Tutup Akses Karyawan Biasa ke Data Referensi Keuangan

**Ditemukan:** Audit role `employee` (lihat #55 area) menemukan 3 tabel referensi Keuangan — `fin_bank_accounts` (termasuk nomor rekening bank perusahaan), `fin_cash_out_categories`, `fin_branch_report_groups` — punya RLS `SELECT USING (true)`, artinya bisa dibaca **siapa pun yang login**, termasuk karyawan biasa, walau menu Keuangan sudah tidak ada di sidebar mereka (item #56). Bukan celah UI (tidak ada halaman yang menampilkannya ke karyawan), tapi tetap bisa diakses lewat query langsung.

**Fix:** Ketiga policy `_select_all` diganti jadi dibatasi ke role yang benar-benar pakai modul Keuangan: `owner`, `hr`, `finance`, `supervisor`. Role `employee` sekarang ditolak di ketiga tabel ini juga, konsisten dengan tabel `fin_*` lainnya.

| File | Perubahan |
|---|---|
| Database: `fin_bank_accounts`, `fin_cash_out_categories`, `fin_branch_report_groups` (migrasi `030_restrict_fin_reference_tables.sql`) | Policy SELECT dibatasi ke owner/hr/finance/supervisor |

---

### 60. Fix: Data Masa Kerja Karyawan Lama Bisa "Nyangkut" Saat Ganti Kandidat Cuti Cepat

**Ditemukan:** Saat pengecekan menyeluruh pasca-deploy fitur cuti (item #56) — `npm run build`, smoke test route, dan review kode. Di `/cuti/ajukan`, kalau HR/Owner ganti pilihan karyawan dengan cepat lalu langsung submit Cuti Tahunan sebelum data masa-kerja karyawan baru selesai dimuat, validasi tenure/kuota bisa memakai data karyawan **sebelumnya** yang masih tersimpan di state — bukan karyawan yang baru dipilih.

**Fix:** Saat mulai memuat data karyawan baru, `joinDate`/`usedDays` langsung direset ke kosong (bukan cuma tanda "loading"), jadi tombol submit otomatis terkunci ("data belum termuat") sampai data yang benar-benar sesuai kandidat yang dipilih selesai dimuat.

| File | Perubahan |
|---|---|
| `app/(dashboard)/cuti/ajukan/page.tsx` | Reset `joinDate`/`usedDays` saat ganti karyawan, bukan cuma flag loading |

---

### 61. Fitur: Panel Filter Custom di Daftar Pelamar

**Permintaan Owner:** dengan 176 pelamar menumpuk di satu tahap ("Menunggu Dipanggil Interview"), butuh cara saring sesuai kebutuhan saat itu — bukan satu kombinasi filter tetap, tapi kriteria yang bisa dipilih & digabung sendiri tiap kali cari.

**Fix:** Panel filter baru di `/rekrutmen/pelamar`, tampil di bawah tab status, berlaku bareng dengan tab yang aktif:
- **Usia** (rentang min–max)
- **Pendidikan Minimal** (SD s/d S3, memakai urutan jenjang yang sama dengan form lamaran — pilih S1 berarti tampilkan S1 ke atas)
- **Penempatan** (Tasik Kota / Singaparna)
- **Skor Psikotes Minimal**

Semua filter opsional dan independen — bisa isi satu saja atau gabungan beberapa sekaligus, ada tombol "Reset filter" kalau sudah ada yang aktif. Sort per-kolom (klik header Skor Psikotes) tetap jalan di atas hasil yang sudah difilter.

| File | Perubahan |
|---|---|
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Panel filter usia/pendidikan/penempatan/skor + logic `criteriaFiltered` |

---

### 62. Fitur: Sort Jarak Terdekat + Kesan Pelamar tentang Tes

**Permintaan Owner:** (1) urutkan pelamar berdasarkan jarak terdekat ke titik penempatan — datanya (`distance_km`) sudah ada dari fitur penempatan (migrasi `023_applicant_placement.sql`), tinggal dijadikan kolom sortable. (2) Tambah textbox wajib di halaman undangan interview untuk menjaring kesan pelamar saat mengisi & mengikuti tes sederhana kami.

**Fix/Fitur:**
1. Kolom baru **"Jarak"** di Daftar Pelamar, sortable (klik header, seperti Skor Psikotes) — `↑` = terdekat dulu. Cuma satu kolom yang aktif sort dalam satu waktu (pilih Jarak otomatis mematikan sort Skor Psikotes, begitu juga sebaliknya).
2. `job_applicants` dapat kolom baru `test_impression` (migrasi `031_test_impression.sql`).
3. Halaman undangan interview (`/lamaran/interview/[token]`) sekarang punya 2 field wajib dalam satu form: konfirmasi kehadiran (sudah ada) + **kesan mengikuti tes** (baru, textarea).
4. Modal Detail Pelamar menampilkan kesan kandidat begitu masuk, sejajar dengan konfirmasi kehadiran.

| File | Perubahan |
|---|---|
| Database: `job_applicants` (migrasi `031_test_impression.sql`) | Kolom `test_impression` |
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Kolom Jarak sortable; tampilkan kesan kandidat |
| `app/api/lamaran/interview/[token]/route.ts` | Terima & simpan `test_impression`, wajib diisi |
| `app/lamaran/interview/[token]/page.tsx` | Textarea kesan tes (wajib) di form konfirmasi |

---

### 63. Update Teks: Info Lokasi Training di Undangan Interview

**Permintaan Owner:** tambah info kalau diterima, training dilaksanakan di Singaparna sampai hari Minggu. Juga konfirmasi: link undangan (`/lamaran/interview/[token]`) tidak berubah walau isi/teks halamannya diedit — token per pelamar tersimpan permanen di database sejak dia melamar, tidak terpengaruh perubahan kode. Link yang sudah terkirim ke pelamar tetap berfungsi sama setelah update ini.

| File | Perubahan |
|---|---|
| `app/lamaran/interview/[token]/page.tsx` | Tambah kalimat lokasi training (Singaparna, sampai hari Minggu) di blok Info Training |

---

### 64. Fitur: Tabel Rekap Konfirmasi Interview

**Permintaan Owner:** perlu lihat jawaban konfirmasi kehadiran & kesan pelamar terhadap tes/sistem rekrutmen dalam satu tabel ringkas, tanpa buka Detail Pelamar satu per satu.

**Fitur:** Halaman baru **Rekap Konfirmasi Interview** (`/rekrutmen/interview-konfirmasi`), linknya ada di Pengaturan Rekrutmen dan menampilkan tabel: Kode, Nama, Telepon (link WA), Konfirmasi Kehadiran, Waktu Konfirmasi, dan Kesan Terhadap Tes/Sistem Rekrutmen. Ada pencarian nama/kode, dan toggle "Hanya yang sudah konfirmasi" (aktif secara default) supaya tidak tenggelam di antara ratusan pelamar yang belum sampai tahap interview.

| File | Perubahan |
|---|---|
| `app/(dashboard)/rekrutmen/interview-konfirmasi/page.tsx` | Baru — tabel rekap konfirmasi & kesan pelamar |
| `app/(dashboard)/rekrutmen/page.tsx` | Kartu link ke halaman rekap baru |

---

### 65. Tambah Jalur Kedua ke Rekap Konfirmasi Interview

**Ditemukan:** Owner tidak melihat kartu "Rekap Konfirmasi Interview" (item #64) di halaman Pengaturan Rekrutmen setelah deploy, walau kode sudah terkonfirmasi benar dan ter-push — kemungkinan cache browser khusus halaman itu (halaman baru `/rekrutmen/interview-konfirmasi` sendiri langsung bisa diakses lewat URL langsung, jadi bukan masalah deploy).

**Fix:** Tambah tombol "🗓️ Rekap Konfirmasi Interview →" di halaman **Daftar Pelamar** juga (bukan cuma di Pengaturan Rekrutmen), supaya ada 2 jalur masuk — tidak bergantung ke satu halaman yang mungkin ke-cache.

| File | Perubahan |
|---|---|
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Tombol ke Rekap Konfirmasi Interview di header halaman |

---

### 66. Fitur: Status Otomatis Pindah ke "Dipanggil Interview" Saat Kandidat Konfirmasi

**Permintaan Owner:** kandidat yang sudah konfirmasi kehadiran otomatis pindah dari tab "Menunggu Dipanggil Interview" ke "Dipanggil Interview", tanpa HR harus ubah status manual satu-satu.

**Fix:** Di `POST /api/lamaran/interview/[token]` (saat kandidat kirim konfirmasi), status pelamar otomatis diubah ke `interview_called` — **hanya** kalau status saat itu masih `interview` (maju satu tahap). Kalau kandidat sudah di tahap lebih lanjut (training/diterima) lalu iseng buka lagi linknya untuk ubah jawaban, status tidak dimundurkan.

| File | Perubahan |
|---|---|
| `app/api/lamaran/interview/[token]/route.ts` | Auto-update status jadi `interview_called` saat konfirmasi masuk |

---

### 67. Fitur: Form Hasil Interview (Diisi HR Setelah Wawancara)

**Permintaan Owner:** tempat untuk mencatat hasil interview aktual, minta diusulkan field-nya dulu — disepakati: penilaian per-kriteria (bukan cuma catatan bebas), dan rekomendasi otomatis update status pelamar.

**Fitur:** Bagian baru "Hasil Interview" (hijau) di modal Detail Pelamar, terpisah dari "Undangan Interview" yang diisi KANDIDAT sebelum wawancara — ini diisi HR/Owner SETELAH wawancara aktual:
- Nama Pewawancara
- Kehadiran (Hadir Tepat Waktu / Hadir Terlambat / Tidak Hadir)
- Komunikasi, Penampilan & Kesiapan, Motivasi & Kecocokan — masing-masing dinilai sendiri (Baik/Cukup/Kurang)
- Catatan/Kesan Bebas
- Rekomendasi (Lanjut ke Training / Tidak Lolos / Pertimbangkan Lagi)

Pilih "Lanjut ke Training" atau "Tidak Lolos" otomatis memindahkan status pelamar ke tab yang sesuai saat disimpan (konsisten dengan auto-pindah status konfirmasi kandidat di #66) — "Pertimbangkan Lagi" sengaja tidak mengubah status apa pun.

| File | Perubahan |
|---|---|
| Database: `job_applicants` (migrasi `032_interview_result.sql`) | 8 kolom baru hasil interview |
| `app/(dashboard)/rekrutmen/pelamar/page.tsx` | Form "Hasil Interview" + auto-update status dari rekomendasi |

---

### 68. Fix Bug Besar: Saldo Cash Flow per Rekening Salah karena Limit 1000 Baris

**Dilaporkan Owner:** "Cash Flow per Rekening di Laporan Keuangan kenapa tidak berjalan dengan baik?"

**Ditemukan:** `fin_cash_out` sudah punya **1.346 baris** (1.303 berstatus disetujui). Halaman Cash Flow menarik **seluruh riwayat** `fin_cash_in`/`fin_cash_out` (bukan cuma satu bulan — perlu dari `opening_balance_date` tiap rekening sampai akhir bulan yang dipilih, buat hitung Saldo Berjalan kumulatif) ke browser, lalu menjumlahkannya di JavaScript. **Supabase default cuma mengirim maksimal 1000 baris per query** — begitu tabelnya lewat 1000 baris, sebagian transaksi diam-diam tidak ikut ke-fetch (tanpa error apa pun), dan karena query-nya tidak punya `ORDER BY`, baris mana yang "kepotong" pun tidak konsisten antar refresh. Inilah yang bikin Saldo Berjalan terlihat salah.

Dicek juga halaman laporan keuangan lain (Dashboard Keuangan, Laporan Resmi, Detail Laporan per Cabang) — semuanya sudah membatasi query per periode bulan (`gte`/`lte` tanggal), jadi **tidak** kena masalah yang sama. Cash Flow satu-satunya yang butuh riwayat kumulatif sejak awal, bukan cuma satu bulan.

**Fix:** Penjumlahan dipindah ke database lewat 2 fungsi SQL baru (`get_account_cashflow_summary`, `get_unlinked_cashflow_summary` — migrasi `033_fix_cashflow_aggregation_rpc.sql`) yang langsung `SUM` di Postgres, bukan tarik semua baris lalu jumlahkan di JS. Tidak akan kena batas 1000 baris lagi berapa pun banyaknya transaksi ke depannya — sudah dites hasilnya langsung terhadap data live, angkanya masuk akal.

| File | Perubahan |
|---|---|
| Database (fungsi `get_account_cashflow_summary`, `get_unlinked_cashflow_summary`, migrasi `033`) | Agregasi SUM dipindah ke SQL |
| `app/(dashboard)/keuangan/cashflow/page.tsx` | Pakai RPC, bukan fetch semua baris + hitung di JS |

---

### 69. Fix: Cash Flow Tidak Kasih Tahu Ada Transaksi Pending yang Belum Terhitung

**Dilaporkan Owner:** setelah fix #68, saldo masih terasa tidak sesuai — "uang keluar itu harus cek dari pembayaran supplier juga... bulan September uang cash terlalu banyak, padahal sudah banyak bayar."

**Ditemukan:** Dicek langsung ke database (bukan asumsi) — bulan September ada **9 pembayaran supplier senilai Rp27,7 juta** yang statusnya masih **"Pending"** (menunggu verifikasi Finance di Verifikasi Keuangan), cuma 1 yang sudah "Disetujui" (Rp10,8 juta). Total keseluruhan Kas Keluar pending bulan itu Rp30,7 juta (43 transaksi). Cash Flow memang **sengaja** cuma menghitung status "Disetujui" (supaya tidak salah hitung transaksi yang masih bisa dibatalkan/direvisi) — itu bukan bug, tapi halamannya **tidak memberi tahu** ada uang sebesar itu yang belum ikut terhitung, jadi saldo kelihatan lebih besar dari kenyataan tanpa penjelasan.

**Fix:** Kotak peringatan baru (oranye) di halaman Cash Flow — muncul kalau ada transaksi "Pending" di bulan yang dipilih, menyebutkan total Kas Masuk/Kas Keluar pending (termasuk rincian pembayaran supplier pending), dan link langsung ke Verifikasi Keuangan.

| File | Perubahan |
|---|---|
| Database (fungsi `get_pending_cashflow_summary`, migrasi `034_pending_cashflow_summary.sql`) | Ringkasan transaksi pending per periode |
| `app/(dashboard)/keuangan/cashflow/page.tsx` | Kotak peringatan transaksi pending + link ke Verifikasi Keuangan |

---

### 70. Fitur: Saldo Real vs Saldo Proyeksi di Cash Flow

**Permintaan Owner:** setelah tahu ada transaksi pending yang belum terhitung (#69), minta saldo akhir dibuat 2 angka — yang real (sudah diverifikasi) dan proyeksi (kalau semua pending ikut disetujui).

**Fitur:** Tiap rekening/kas (dan total gabungan, termasuk grup "Saldo Riil per Kantong") sekarang tampilkan 2 kolom saldo: **Saldo Real** (cuma transaksi disetujui, seperti sebelumnya) dan **Saldo Proyeksi** (Saldo Real + semua transaksi Pending rekening itu, seandainya semuanya disetujui — dihitung kumulatif sejak tanggal saldo awal, konsisten dengan cara Saldo Real dihitung).

| File | Perubahan |
|---|---|
| Database (fungsi `get_account_cashflow_summary`, migrasi `035_cashflow_pending_projection.sql`) | Tambah `pending_cumulative_in`/`pending_cumulative_out` per rekening |
| `app/(dashboard)/keuangan/cashflow/page.tsx` | Kolom & kartu Saldo Proyeksi di semua tabel |

---

### 71. Rombak Total: Pembelian & Utang Supplier Jadi Satu Ledger per Supplier

**Keluhan Owner:** "Ringkasan Supplier ini membingungkan, tidak ada detail, belanja berapa, bayar berapa, tidak ada tab detail" — halaman lama cuma tabel ringkasan gabungan per supplier tanpa cara menelusuri transaksi apa saja yang membentuk angka itu, dan tab "Catat Pembelian" terpisah cuma menampilkan bulan berjalan.

**Rombak:**
1. **Satu tampilan, bukan dua tab** — daftar SEMUA supplier aktif (bukan cuma yang punya sisa hutang), klik baris mana pun buka **modal Detail**.
2. **Modal Detail per supplier**: tombol "➕ Tambah Belanja" & "💰 Bayar Hutang" di atas, ringkasan Total Belanja/Total Pembayaran/Total Sisa Hutang, lalu **ledger gabungan** (tanggal, Nomor Nota/SJ, kolom Pembelian, kolom Pembayaran, Status) — transaksi terbaru di atas, satu tabel untuk beli & bayar bukan dua tabel terpisah. Baris pembayaran "Pending" tetap tampil (ditandai jelas) tapi tidak ikut mengurangi Sisa Hutang.
3. **Tambah Belanja**: field baru **Nomor Invoice** & **Nomor SJ** (kolom baru di `supplier_purchases`, migrasi `036_supplier_invoice_sj_number.sql`), plus opsi bayar sebagian/lunas langsung seperti sebelumnya.
4. **Bayar Hutang** — diganti total, dari "bayar borongan otomatis FIFO" jadi **hybrid**: isi nominal total untuk auto-centang nota tertua dulu (FIFO, cepat), TAPI bisa dicentang/dibongkar & diubah manual per nota (kalau mau bayar nota tertentu). Tetap wajib pilih Rekening/Kas — begitu diverifikasi Finance, otomatis mengurangi saldo di Cash Flow.

| File | Perubahan |
|---|---|
| Database: `supplier_purchases` (migrasi `036`) | Kolom `invoice_number`, `sj_number` |
| `app/(dashboard)/keuangan/pembelian/PembelianPageContent.tsx` | Rombak total — satu ledger per supplier, hapus tab lama |
| `app/(dashboard)/keuangan/pembelian/page.tsx`, `.../input/page.tsx` | Tidak lagi kirim prop `defaultTab` (tab dihapus) |

---

### 72. Fix: Header Modal Detail Supplier Sekarang Diam Saat Scroll

**Ditemukan Owner:** di modal Detail Supplier (item #71), judul/tombol/ringkasan angka/peringatan pending/header tabel ikut scroll hilang begitu ledger-nya panjang — susah dilihat sedang bicarakan supplier mana saat sudah scroll ke bawah.

**Fix:** Modal diubah jadi struktur flex-column: bagian atas (judul, tombol Tambah Belanja/Bayar Hutang, ringkasan 3 angka, peringatan pending) sekarang **di luar area scroll sama sekali** — bukan sticky, memang tidak pernah ikut bergulir. Cuma tabel ledger yang scroll sendiri di area terpisah, dengan header tabelnya (Tanggal/Nota-SJ/Pembelian/Pembayaran/Status) **sticky** relatif ke area scroll itu — pakai pola yang sudah terbukti di app ini: `border-separate` di `<table>`, `sticky top-0` + `bg-*` di tiap `<th>` (bukan di `<tr>`), dan `bg-white` di tiap `<td>` supaya baris yang discroll tidak tembus pandang di balik header.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/pembelian/PembelianPageContent.tsx` | Modal Detail Supplier: flex-column, header non-scroll + tabel ledger sticky-header sendiri |

---

### 73. Fitur: Catatan Meeting

**Permintaan Owner:** tempat mencatat hasil meeting supaya tidak lupa, dibagikan ke sesama admin.

**Fitur:** Halaman baru **Catatan Meeting** (`/catatan-meeting`, menu sidebar admin) — daftar catatan (judul, tanggal meeting, peserta, isi, tindak lanjut/to-do), bisa dicari, terlihat oleh semua owner/HR/finance (siapa penulisnya ditampilkan di tiap catatan). Edit/hapus dibatasi ke penulis catatan itu sendiri atau owner.

| File | Perubahan |
|---|---|
| Database: `meeting_notes` (migrasi `037_meeting_notes.sql`) | Tabel baru + RLS (baca bersama, edit/hapus penulis/owner) |
| `app/(dashboard)/catatan-meeting/page.tsx` | Baru — halaman Catatan Meeting |
| `components/sidebar.tsx` | Menu baru "Catatan Meeting" |

---

### 74. Fix: Baris "Kelola Pembelian" Tidak Bisa Dibedakan Satu Sama Lain

**Ditemukan Owner:** di modal Detail Supplier, bagian "Kelola pembelian (edit/hapus nota tertentu)" isinya banyak chip bertuliskan "— Edit Hapus" yang persis sama semua — tidak bisa dibedakan mana yang mana, karena pembelian lama (sebelum ada field Invoice/SJ) tidak punya keterangan apa pun.

**Fix:** Tiap baris sekarang selalu menampilkan **tanggal + nominal** (bukan cuma nomor invoice/SJ yang sering kosong), jadi tetap bisa dibedakan. Sekalian dirapikan atas saran Owner: dari grid chip kecil jadi daftar baris yang lebih besar & lega, tombol Edit/Hapus di sisi kanan tiap baris.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/pembelian/PembelianPageContent.tsx` | Baris "Kelola Pembelian" tampilkan tanggal+nominal, layout diperbesar |

---

### 75. Fix: Modal Detail Supplier Diperlebar, Edit/Hapus Pindah ke Tabel Ledger

**Permintaan Owner:** modal Detail Supplier terlalu sempit, dan tombol Edit/Hapus sebaiknya ada langsung di baris tabel ledger (dekat kolom Status) — bukan di daftar terpisah "Kelola Pembelian" di bawah yang harus dicocokkan manual sama tabel di atas.

**Fix:**
1. Modal Detail Supplier diperlebar dari `max-w-3xl` ke `max-w-5xl`.
2. Kolom **Aksi** baru ditambahkan di tabel ledger (paling kanan, sejajar Status) — tombol Edit/Hapus langsung di baris pembelian yang bersangkutan. Baris pembayaran tidak punya tombol ini (memang tidak bisa diedit lewat sini).
3. Bagian "Kelola Pembelian" yang terpisah di bawah tabel **dihapus total** — sudah tidak perlu, fungsinya sudah masuk ke tabel ledger langsung.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/pembelian/PembelianPageContent.tsx` | Modal diperlebar; kolom Aksi di tabel ledger; hapus bagian Kelola Pembelian terpisah |

---

### 76. Rombak Sidebar Admin Jadi 4 Kelompok Besar

**Permintaan Owner:** menu admin yang tadinya flat (13+ item sejajar: Karyawan, Rekrutmen, Absensi, Cuti, Penggajian, Keuangan, Laporan Keuangan, KPI, Ranking, Kasbon, Laporan, Setup, Manajemen User) dikelompokkan supaya lebih gampang ditelusuri — awalnya diusulkan 2-3 kelompok, disepakati jadi **4 kelompok besar**: SDM/HR, Operasional, Keuangan, Penggajian. Item "Setup" yang tadinya gado-gado (Cabang/Jabatan/Komponen Gaji/dll dicampur satu tempat) dipecah masuk ke kelompok masing-masing.

**Struktur baru:**
- **SDM / HR** — Karyawan, Rekrutmen, Absensi, Cuti & Izin, KPI, Ranking Disiplin, Setup Cabang & Jabatan
- **Operasional** — Kas Masuk, Kas Keluar, Pembelian & Utang Supplier, Petty Cash, Modal & Aset, Verifikasi Keuangan, Logistik, Setup Kas & Supplier (dulu top-level "Keuangan")
- **Keuangan** — Dashboard Keuangan, Detail Laporan per Cabang, Cash Flow per Rekening, Laporan Resmi, Ringkasan Supplier, Riwayat Kas Keluar, **Kasbon** (dulu top-level "Laporan Keuangan" + Kasbon pindah ke sini)
- **Penggajian** — tetap seperti semula + Setup Gaji & Tarif (Komponen Gaji, Bonus Kondisional, Setup Kehilangan, Tarif & Mobil Driver, Pekerja Lepas, Tarif Bongkar Muat)
- **Dashboard, Laporan, Catatan Meeting, Manajemen User** — sengaja tetap berdiri sendiri, tidak dipaksa masuk salah satu dari 4 kelompok (lintas-fungsi)

Nama sub-grup "Setup" yang tadinya dipakai 3x sengaja diberi nama beda-beda (Setup Cabang & Jabatan / Setup Kas & Supplier / Setup Gaji & Tarif) — kalau namanya sama persis, state buka/tutup menu di sidebar bentrok (nge-toggle satu ikut nge-toggle yang lain juga, karena statenya di-key pakai nama).

| File | Perubahan |
|---|---|
| `components/sidebar.tsx` | `adminNavItems` dirombak jadi 4 kelompok + logic auto-expand disesuaikan |

---

### 77. Hapus Menu "Laporan" yang Berdiri Sendiri

**Permintaan Owner:** menu "Laporan" yang berdiri sendiri (tidak masuk kelompok mana pun) dianggap tidak ada gunanya, minta dihapus. Dicek dulu isinya — ternyata halaman ini judulnya "📄 Laporan Penggajian" (bukan laporan umum lintas-fungsi seperti dugaan awal), jadi sempat ditawarkan pindah ke grup Penggajian dulu — tapi Owner tetap pilih hapus total.

**Fix:** Halaman `/laporan` (656 baris, "Laporan Penggajian") dan entri menunya dihapus total. Dicek dulu tidak ada halaman lain yang me-link ke `/laporan`, jadi aman dihapus tanpa link mati.

| File | Perubahan |
|---|---|
| `app/(dashboard)/laporan/page.tsx` | Dihapus |
| `components/sidebar.tsx` | Entri menu "Laporan" dihapus |

---

### 78. Fix: Tutup 2 Jalur Bocor Pencatatan Ganda di Kas Keluar

**Ditemukan (diminta Owner untuk diaudit):** kategori **"Pembayaran Supplier"** dan **"Pencairan Kasbon"** di dropdown Kategori halaman Input Kas Keluar (mode "Pengeluaran Biasa") ternyata masih bisa dipilih bebas, padahal keduanya sudah punya jalur resmi masing-masing (Bayar Hutang di Pembelian & Utang Supplier; mode "Cairkan Kasbon" di halaman yang sama). Kalau dipilih manual dari dropdown bebas, entrinya **tidak terhubung ke nota/pengajuan manapun** (`source_id` kosong) — uangnya tercatat keluar di Cash Flow, tapi Sisa Utang Supplier atau saldo Kasbon karyawan **tidak ikut berkurang**, karena tidak ada yang menautkannya. Beda dari kategori gaji (payroll/driver/dll) yang sudah dikunci lebih dulu (wajib konfirmasi "karyawan tidak terdaftar" sebelum boleh input manual).

**Fix:** Kode kategori `pembayaran_supplier` dan `kasbon_cair` disaring keluar dari dropdown Kategori mode "Pengeluaran Biasa" (form tambah baru & edit baris, dua-duanya pakai sumber data yang sama) — kodenya tetap valid di database, tetap dipakai apa adanya oleh jalur resminya masing-masing, cuma disembunyikan dari pilihan bebas ini.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/kas-keluar/page.tsx` | Kategori `pembayaran_supplier` & `kasbon_cair` disaring dari dropdown bebas |

---

### 79. Fix Keamanan + Fitur: Approval Wajib untuk Kasbon Driver & Kenek

**Konteks:** lanjutan audit pencatatan ganda (#78) — Owner tanya apakah kasbon staff/driver/kenek (3 sistem terpisah) bisa disatukan. Digabung penuh terlalu berisiko (potongan driver/kenek mingguan, staff bulanan — beda siklus gajian, menulis ulang 3 halaman payroll sekaligus). Disepakati perbaikan yang aman: samakan level KONTROL-nya saja (wajib approval Owner), tanpa mengubah tabel/jadwal potongan.

**Ditemukan sekalian saat mengerjakan** (bukan cuma soal approval) — RLS `driver_kasbon`, `helper_kasbon`, dan tabel potongannya ternyata **"authenticated full access"** (`USING true`): siapa pun yang login, termasuk karyawan biasa, bisa baca/ubah/hapus langsung lewat API, tanpa peduli role. Ini ikut diperbaiki.

**Fix:**
1. RLS 4 tabel (`driver_kasbon`, `helper_kasbon`, `driver_kasbon_deductions`, `helper_kasbon_deductions`) dibatasi ke owner/hr/finance — sebelumnya terbuka untuk semua yang login.
2. Kasbon driver/kenek baru sekarang mulai dari status **`pending_approval`** (dulu langsung `active` tanpa kontrol apa pun) — perlu disetujui dulu lewat fungsi `approve_driver_kasbon`/`approve_helper_kasbon` (Owner-only, dicek di dalam fungsinya sendiri, bukan cuma RLS) sebelum jadi `active` dan bisa dipotong mingguan.
3. UI Kasbon Driver & Kasbon Kenek: badge status "⏳ Menunggu", tombol "Setujui" (cuma tampil untuk Owner), kartu ringkasan & filter pill baru "Menunggu Persetujuan", dan kotak peringatan kalau ada yang belum disetujui.
4. Halaman Penggajian Driver/Borongan (potongan mingguan) **tidak perlu diubah** — query-nya sudah `.eq('status','active')`, otomatis mengecualikan yang masih pending.

| File | Perubahan |
|---|---|
| Database (RLS 4 tabel, migrasi `038_driver_helper_kasbon_approval.sql`) | RLS dibatasi owner/hr/finance; status baru `pending_approval`; fungsi `approve_driver_kasbon`/`approve_helper_kasbon` |
| `app/(dashboard)/kasbon/page.tsx` | Alur approval (status awal, badge, tombol Setujui, kartu & filter baru) di Tab Driver & Kenek |

---

### 80. Fix Bug Lama: Halaman Daftar Akun Karyawan (`/signup`) Tidak Pernah Bisa Diakses

**Ditemukan:** Owner minta cek ulang alur login & sign up secara menyeluruh. Dicek satu-satu (kode + smoke test HTTP langsung, bukan cuma baca kode) — ternyata `/signup` **tidak pernah** ada di daftar route publik (`PUBLIC_ROUTES`) di `proxy.ts` sejak fitur "Daftar Akun Karyawan" pertama dibuat (beberapa hari lalu, sebelum sesi ini). Akibatnya: karyawan yang **belum punya akun** (berarti belum login) — justru target pengguna utama fitur ini — selalu dilempar balik ke `/login` sebelum sempat melihat form Daftar sama sekali. Link "Belum punya akun? Daftar di sini" di halaman Login pun ikut jadi jalan buntu (klik → langsung dilempar balik ke Login lagi). Fitur ini praktis tidak bisa dipakai sejak awal dibuat.

**Fix:** `/signup` dan `/api/signup` (endpoint submit-nya) ditambahkan ke `PUBLIC_ROUTES`; `/signup` juga ditambahkan ke `AUTH_ROUTES` (supaya user yang sudah login diarahkan ke Dashboard kalau buka halaman ini, bukan malah lihat form daftar lagi). Sudah diverifikasi ulang lewat smoke test HTTP langsung: `/signup` sekarang 200 (sebelumnya 307 redirect ke login).

Login, Lupa Password, dan Reset Password dicek ulang sekalian — semuanya masih utuh dan bekerja seperti seharusnya, tidak ada yang terdampak perubahan-perubahan RLS di sesi ini.

| File | Perubahan |
|---|---|
| `proxy.ts` | `/signup` & `/api/signup` masuk `PUBLIC_ROUTES`; `/signup` masuk `AUTH_ROUTES` |

---

### 81. Fitur: Preview Tampilan Karyawan

**Konteks:** Owner minta cara untuk lihat tampilan menu/layout level karyawan biasa tanpa harus login-logout, supaya bisa cek "apa yang kurang" dari sisi karyawan. Sudah dijelaskan ke Owner (dan disepakati) batasannya: RLS (aturan akses data di database) mengikuti role akun yang **benar-benar login** — tidak bisa dipalsukan dari sisi browser/client. Jadi preview ini **hanya mengubah tampilan menu & layout** menjadi versi karyawan; data yang muncul di dalam halaman tetap data akun Owner sendiri (Owner juga punya `employee_id` sendiri seperti akun lain), bukan data "karyawan biasa" yang representatif. Opsi lain (buat akun demo karyawan sungguhan, seperti pola "Pelamar Demo" di Rekrutmen) ditawarkan tapi tidak dipilih — Owner pilih opsi cepat ini.

**Fitur:** Tombol baru **"👁️ Preview Tampilan Karyawan"** di bagian bawah sidebar, cuma muncul untuk akun yang role aslinya bukan employee/supervisor (jadi karyawan asli tidak akan lihat tombol ini, tidak bisa iseng balik ke menu admin). Saat diaktifkan:
- Sidebar berubah jadi menu versi karyawan (Dashboard, Portal Saya, Cuti & Izin, Kasbon).
- Dashboard menampilkan kartu versi karyawan (Jadwal Hari Ini, Sisa Cuti Tahunan, Kasbon Menunggu) memakai data employee milik akun sendiri.
- Halaman Portal (`/portal/absensi`, `/portal/jadwal`, `/portal/slip-gaji`) yang tadinya menolak akses admin, sekarang bisa dibuka saat mode preview aktif.
- Banner kuning permanen muncul di atas semua halaman selama preview aktif, dengan tombol "Kembali ke Admin" untuk keluar kapan saja.

Status preview disimpan di cookie (`previewAsEmployee`, bukan `sessionStorage`) supaya bisa dibaca baik oleh komponen client (Sidebar, halaman Portal) maupun Server Component (halaman Dashboard) sekaligus.

| File | Perubahan |
|---|---|
| `lib/previewMode.ts` (baru) | Helper cookie: `isPreviewModeClient()`, `setPreviewMode()` |
| `components/sidebar.tsx` | Tombol toggle preview (admin-only), `isEmployee` ikut mempertimbangkan mode preview |
| `components/DashboardShell.tsx` | Banner kuning "sedang preview" + tombol keluar |
| `app/(dashboard)/dashboard/page.tsx` | Baca cookie preview via `next/headers`, tampilkan kartu versi karyawan saat aktif |
| `app/(dashboard)/portal/absensi/page.tsx`, `portal/jadwal/page.tsx`, `portal/slip-gaji/page.tsx` | Redirect-jika-bukan-employee dilewati saat mode preview aktif |

---

### 82. Penyempurnaan Portal Karyawan: Keamanan Data + Fitur Baru

**Konteks:** Owner minta audit menyeluruh portal karyawan (bukan cuma tampilan, tapi juga data — dicek langsung ke database, bukan cuma baca kode) untuk cari apa saja yang masih kurang/berisiko, lalu perbaiki semua yang ditemukan. Ditemukan 2 celah keamanan RLS dan beberapa fitur yang belum ada.

**Fix Keamanan (RLS/Storage):**
- `kasbon_requests` — SELECT sebelumnya `qual = true` (kebuka penuh): karyawan biasa bisa baca kasbon SEMUA karyawan lain (jumlah, alasan, status). Dibatasi: owner/hr/finance lihat semua, employee/supervisor cuma lihat kasbon miliknya sendiri.
- `attendance-photos` (storage bucket foto absen HP) — INSERT sebelumnya cuma cek nama bucket, karyawan A bisa upload/timpa foto absen ke folder karyawan B. Dibatasi ke folder `{employee_id}` milik akun sendiri saja, + ditambah batas ukuran file 5MB dan tipe (JPEG/PNG saja).
- `payrolls` — SELECT untuk lihat slip gaji sendiri sebelumnya cuma berlaku untuk role `employee`, akun `supervisor` selalu lihat "Belum ada slip gaji" walau datanya ada. Ditambahkan.

**Fix Bug:**
- Absen HP (`AbsenSekarang`) sekarang cek jadwal roster hari itu (`employee_roster.is_day_off`) sebelum membuka kamera — kalau hari ini terjadwal LIBUR, absen masuk diblokir dengan pesan jelas. Karena dibaca live per-tanggal, kalau HR menggeser jadwal libur ke tanggal lain, absen otomatis mengikuti jadwal terbaru tanpa perlu kode tambahan.

**Fitur Baru:**
- **Peringatan "lupa absen pulang"** di halaman Rekap Absensi (HR/Owner) — daftar absen 14 hari terakhir yang belum ada jam pulang, klik langsung diarahkan ke baris & bulan terkait untuk dikoreksi.
- **Batalkan pengajuan cuti sendiri** — karyawan yang salah ajukan cuti/izin (status masih Menunggu) sekarang bisa membatalkan sendiri tanpa perlu nunggu HR menolak. Status baru "Dibatalkan" (`cancelled`) dibedakan dari "Ditolak" (`rejected`) supaya tidak terkesan ditolak HR.
- **Halaman Profil Saya** (`/portal/profil`, menu baru di Portal Saya) — karyawan sekarang bisa lihat data kepegawaian, data pribadi, rekening bank, dan kontak darurat miliknya sendiri (read-only, arahkan ke HR kalau ada yang salah).
- **Notifikasi status pengajuan** — ikon lonceng di navbar (khusus employee/supervisor) menampilkan status terbaru pengajuan Cuti/Izin & Kasbon yang sudah diproses (disetujui/ditolak/lunas), dengan tanda titik merah untuk yang belum dilihat.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Fix RLS `kasbon_requests`/`payrolls`, fix storage policy `attendance-photos` + batas file, tambah enum value `cancelled` + policy `leave_cancel_self` |
| `components/AbsenSekarang.tsx` | Cek `employee_roster.is_day_off` sebelum izinkan absen masuk |
| `app/(dashboard)/absensi/rekap/page.tsx` | Kartu peringatan absen belum pulang + jump-to-row |
| `app/(dashboard)/cuti/page.tsx` | Tombol Batalkan (self), status Dibatalkan |
| `app/(dashboard)/portal/profil/page.tsx` (baru) | Halaman profil read-only karyawan |
| `components/NotifikasiBell.tsx` (baru), `components/DashboardShell.tsx` | Ikon notifikasi status pengajuan |
| `components/sidebar.tsx` | Menu "Profil Saya" di Portal Saya |

---

### 83. Fitur: Tukar Hari Libur Saat Absen Masuk di Hari Libur

**Konteks:** Penyempurnaan dari fix #82 (absen HP menolak absen masuk kalau hari itu terjadwal libur). Owner minta itu diubah dari sekadar blokir menjadi alur konfirmasi: kalau karyawan tetap mau masuk di hari liburnya, sistem tanya dulu "yakin?", lalu minta pilih tanggal pengganti — dan kalender pemilihan tanggal itu harus menunjukkan jadwal libur rekan **satu cabang saja** (supaya karyawan bisa memilih tanggal yang tidak bentrok dengan terlalu banyak rekan yang sudah libur).

**Alur baru di Absen HP (`AbsenSekarang`):**
1. Karyawan tekan "Absen Masuk" di hari yang terjadwal libur → muncul konfirmasi "Yakin ingin tetap masuk kerja hari ini?".
2. Kalau "Ya" → muncul kalender bulan berjalan (bisa geser ke bulan berikutnya). Tanggal yang sudah ada rekan satu cabang libur ditandai titik kuning (hover/klik untuk lihat nama). Tanggal yang sudah jadi hari libur karyawan itu sendiri otomatis dikunci (tidak bisa dipilih dobel).
3. Pilih tanggal pengganti → klik "Pilih & Lanjut Absen" → hari ini otomatis jadi hari kerja, tanggal pengganti otomatis jadi hari libur baru, lalu proses absen (GPS + foto) langsung lanjut seperti biasa.

**Kenapa lewat RPC, bukan tulis langsung ke tabel:** Karyawan biasa tidak (dan sengaja tidak) punya akses tulis ke `employee_roster` (cuma HR/Owner) maupun akses baca roster karyawan lain. Dua fungsi database baru dengan validasi ketat di dalamnya menjaga ini tetap aman:
- `request_day_off_swap` — validasi: pemanggil cuma bisa tukar jadwalnya SENDIRI, hari ini harus benar hari libur, tanggal pengganti harus di masa depan dan belum jadi hari libur yang sama. Dicatat ke tabel baru `roster_swap_logs` untuk jejak audit HR.
- `get_branch_dayoff_calendar` — cuma kembalikan tanggal + nama, dibatasi ke cabang milik pemanggil sendiri saja (tidak bisa intip cabang lain).

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Tabel `roster_swap_logs`, RPC `request_day_off_swap`, RPC `get_branch_dayoff_calendar` |
| `components/AbsenSekarang.tsx` | Alur konfirmasi + kalender pilih tanggal pengganti, ganti blokir statis jadi interaktif |

---

### 84. Fitur: Absen QR (Menggantikan Sementara Absen HP GPS+Kamera)

**Konteks:** Absen HP dengan GPS+kamera (deteksi lokasi + foto ber-watermark jarak) makan waktu lama untuk dibangun dan dirasa terlalu berat untuk kebutuhan sekarang. Owner minta solusi instant: absen cukup scan QR, sambil ke depannya data absensi "resmi" tetap ditarik dari mesin fingerprint (lewat `/absensi/import` yang sudah ada). Absen HP GPS **disembunyikan dulu** (bukan dihapus — tinggal set `SHOW_GPS_CHECKIN = true` di `portal/absensi/page.tsx` untuk mengaktifkan lagi kapan pun).

**Cara kerja Absen QR:**
1. HR buka menu **Absensi → QR Absen**, di situ tampil 1 QR per cabang (statis, di-generate dari token acak per cabang) — tinggal cetak & tempel di cabang.
2. Karyawan scan QR itu pakai kamera HP → diarahkan ke halaman `/absen-qr/<token>` → sistem cek dulu apakah cabang di QR itu cocok dengan cabang karyawan tersebut (kalau beda cabang, ditolak dengan pesan jelas).
3. Kalau cocok, alur absennya SAMA PERSIS dengan Absen HP sebelumnya (termasuk fitur tukar hari libur dari fix #83) — cuma tanpa deteksi GPS/radius. Tetap wajib foto langsung dari kamera (bukan galeri), tetap otomatis hitung telat/lembur, tetap masuk ke tabel `attendances` yang sama (`source = 'qr'`) supaya semua fitur di atasnya (payroll, rekap) tidak perlu diubah.
4. QR bisa "dibuat ulang" per cabang kapan saja (misal token-nya kefoto/bocor) — QR lama otomatis tidak berlaku lagi.

**Kenapa token QR disimpan terpisah, bukan di tabel `branches`:** RLS tabel `branches` mengizinkan SEMUA role baca (termasuk karyawan biasa) — kalau token ditaruh di situ, semua karyawan bisa lihat token cabang lain dan absen palsu di cabang yang tidak pernah mereka datangi. Token disimpan di tabel baru `branch_qr_tokens` yang cuma bisa dibaca owner/hr; halaman absen karyawan resolve token lewat RPC `resolve_branch_by_qr_token` yang cuma mengembalikan nama cabang, bukan daftar token.

**Retensi foto (karena tanpa GPS pun tetap ada foto, dan storage Supabase project ini masih paket Free 1GB):** foto absen (check-in & check-out) yang lebih tua dari **60 hari** dihapus otomatis — baik file di storage maupun link-nya di kolom `attendances`, sementara data jam masuk/pulang/telat/lembur **tidak ikut terhapus, tersimpan permanen**. Pembersihan ini dipicu otomatis (dibatasi 1x/hari) tiap kali HR buka halaman Rekap Absensi atau QR Absen, dan juga bisa dijalankan manual kapan saja dari halaman QR Absen.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Tabel `branch_qr_tokens`, RPC `resolve_branch_by_qr_token`, tambah `'qr'` ke CHECK constraint `attendances.source` |
| `components/AbsenSekarang.tsx` | Ditambah prop `mode: 'gps' \| 'qr'` — mode `qr` melewati semua langkah GPS/radius |
| `app/(dashboard)/absen-qr/[token]/page.tsx` (baru) | Halaman tujuan scan QR karyawan — validasi token & kecocokan cabang |
| `app/(dashboard)/absensi/qr/page.tsx` (baru) | Halaman admin: generate/cetak/buat-ulang QR per cabang + panel kebersihan storage foto |
| `app/api/attendance/cleanup-old-photos/route.ts` (baru) | Hapus foto >60 hari (file storage + link kolom), owner/hr only |
| `lib/photoCleanup.ts` (baru) | Helper pemicu pembersihan otomatis 1x/hari dari sisi browser |
| `app/(dashboard)/portal/absensi/page.tsx` | Absen HP GPS disembunyikan (`SHOW_GPS_CHECKIN = false`), diganti info arahan ke Absen QR |
| `app/(dashboard)/absensi/rekap/page.tsx` | Panggil pemicu pembersihan foto otomatis saat halaman dibuka |
| `components/sidebar.tsx` | Menu baru "QR Absen" di grup Absensi |

---

### 85. Fitur: Daftar Cepat (Kode Karyawan Saja)

**Konteks:** Owner minta jalur daftar akun kedua yang lebih cepat, di samping form "Verifikasi Lengkap" yang sudah ada (Kode Karyawan + No HP/Tanggal Lahir + email bebas). Jalur baru ini cukup modal **Kode Karyawan saja** — keputusan sadar dari Owner bahwa Kode Karyawan dianggap sudah cukup rahasia (cuma diketahui HR & karyawan bersangkutan), jadi tanpa verifikasi No HP/Tanggal Lahir lagi. Email login-nya juga bukan email bebas, tapi wajib pakai **nama lengkap + domain `@hammielion.com`** (karyawan ketik nama, sistem yang tempelkan domainnya).

**Alur:** Halaman `/signup` sekarang punya 2 tab — "Verifikasi Lengkap" (tidak berubah) dan **"Kode Karyawan Saja"** (baru):
1. Karyawan isi Kode Karyawan → begitu pindah dari kolom itu (blur), sistem langsung cek dan tampilkan nama yang ditemukan sebagai konfirmasi ("✓ Data ditemukan: Budi Santoso") — atau pesan error generik kalau tidak ketemu/tidak aktif/sudah pernah daftar.
2. Isi Nama Lengkap → langsung terlihat preview email yang akan dipakai (`budi.santoso@hammielion.com`).
3. Isi Password + Konfirmasi Password → Daftar.
4. Setelah berhasil, email login yang dibentuk sistem ditampilkan jelas di layar (supaya karyawan tahu & catat, karena bukan email yang mereka ketik sendiri).

| File | Perubahan |
|---|---|
| `lib/emailFromName.ts` (baru) | Rumus bentuk email dari nama (dipakai bareng form & API, supaya preview dan hasil akhir selalu sama) |
| `app/api/signup/quick/route.ts` (baru) | `GET` untuk lookup nama by Kode Karyawan, `POST` untuk buat akun. Sengaja dinesting di bawah `/api/signup` supaya otomatis ikut aturan publik di `proxy.ts` (pelajaran dari bug #80) |
| `app/(auth)/signup/page.tsx` | Ditambah tab switch, form lama dipecah jadi komponen `FullVerifyForm`, form baru `QuickForm` |

---

### 86. Fitur: Perbarui Akun Saya (Ganti Email Standar + Password Sendiri)

**Konteks:** Owner ingin SEMUA 26 akun karyawan (termasuk 5 akun admin Owner/HR/Finance yang sudah ada) dirapikan ke email standar `nama@hammielion.com`, dengan password diketik ulang sendiri oleh masing-masing orang (bukan dibuatkan/dibagikan admin) supaya tidak gampang lupa. Karena domain `@hammielion.com` **cuma dipakai sebagai username, bukan email sungguhan yang bisa menerima pesan** (dikonfirmasi Owner), fitur Lupa Password tidak akan bisa dipakai akun-akun ini — satu-satunya jalan reset kalau lupa adalah admin (Owner/HR) reset manual lewat menu Manajemen User (fitur ini sudah ada dari sebelumnya, jadi ada jaring pengaman).

**Fitur baru — "Perbarui Akun Saya":** tombol 🔑 baru di navbar (semua role, di sebelah tombol tema), buka halaman self-service:
1. Tampilkan email lama sebagai referensi.
2. Nama Lengkap (pre-filled dari data karyawan, bisa diedit kalau perlu variasi karena tabrakan nama) → preview email baru real-time.
3. Password Baru + Konfirmasi — diketik sendiri oleh pemilik akun.
4. Submit → email & password di Supabase Auth diperbarui langsung (tanpa perlu konfirmasi email, karena memang tidak bisa terkirim), baris `users.email` ikut disesuaikan.
5. Layar sukses menampilkan email baru dengan peringatan tebal untuk dicatat, lalu otomatis logout supaya pemilik akun langsung coba login ulang pakai kredensial barunya sendiri.

**Karyawan yang belum punya akun sama sekali** (21 dari 26) tidak perlu fitur ini — tinggal pakai **Daftar Cepat** (fitur #85) yang sudah otomatis menerapkan format email & password mandiri yang sama.

Endpoint `/api/akun/perbarui` cuma bisa mengubah akun MILIK SENDIRI — identitas diambil dari sesi login yang sedang aktif, tidak ada parameter id akun lain yang bisa dioper dari luar.

| File | Perubahan |
|---|---|
| `app/api/akun/perbarui/route.ts` (baru) | Update email+password akun sendiri lewat service role |
| `app/(dashboard)/akun/perbarui/page.tsx` (baru) | Halaman self-service, pakai `emailFromName` yang sama dengan Daftar Cepat |
| `components/DashboardShell.tsx` | Tombol 🔑 "Perbarui Akun" di navbar, semua role |

---

### 87. Fitur: Portal Saya untuk Owner/HR/Finance Juga

**Konteks:** Owner sadar akun HR (Nisa/EMP-009) tidak punya akses ke "Portal Saya" sama sekali — ternyata memang sengaja dibatasi cuma untuk role `employee`/`supervisor` sejak awal dibuat. Owner minta ini diperbaiki: siapa pun yang punya jabatan (termasuk Owner/HR/Finance) tetaplah karyawan juga, jadi wajar kalau mereka juga bisa lihat profil, slip gaji, absensi, dan jadwal miliknya sendiri.

**Fix:**
- Menu **"Portal Saya"** (Profil Saya, Slip Gaji, Rekap Absensi, Jadwal Saya) sekarang muncul juga di sidebar Owner/HR/Finance, di samping menu admin mereka yang sudah ada — bukan menggantikan.
- Ke-4 halaman Portal Saya dilonggarkan supaya bisa diakses SEMUA role (sebelumnya redirect otomatis ke Dashboard kalau bukan employee/supervisor).
- Ditemukan sekalian celah RLS yang senada: role `finance` ternyata tidak punya akses baca `employee_roster` maupun `leave_requests` miliknya sendiri sama sekali (beda dengan owner/hr yang sudah lebih dulu punya akses luas) — kalau dibiarkan, Jadwal Saya & Sisa Cuti finance akan selalu kosong walau datanya ada. Diperbaiki jadi berlaku untuk SEMUA role baca (dan batalkan pengajuan cuti) miliknya sendiri.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | `roster_read_self`, `leave_read_self`, `leave_cancel_self` diperluas dari employee/supervisor saja jadi berlaku semua role (tetap dibatasi milik sendiri) |
| `components/sidebar.tsx` | Grup "Portal Saya" ditambahkan ke menu admin (Owner/HR/Finance) |
| `app/(dashboard)/portal/{profil,absensi,jadwal,slip-gaji}/page.tsx` | Hapus redirect yang membatasi cuma employee/supervisor |

---

### 88. Fix Bug: Absen QR Selalu Gagal Tersimpan Diam-Diam

**Ditemukan:** Owner coba scan QR sendiri — masuk ke halaman web-nya, tapi absennya tidak pernah tercatat ("tidak terjadi apa-apa"). Ditelusuri, ternyata ada 2 lapis masalah menumpuk:
1. Halaman `/absen-qr/[token]` masih membatasi akses cuma untuk role `employee`/`supervisor` (pola lama yang kelewat saat fix #87 kemarin merapikan 4 halaman Portal Saya) — Owner langsung dilempar balik ke Dashboard tanpa pesan apa pun.
2. Yang lebih serius: kebijakan keamanan database (RLS) untuk insert/update absen mandiri ternyata **masih terkunci ke `source = 'mobile'` saja** — padahal Absen QR menulis `source = 'qr'`. Ini bug yang kebawa dari awal fitur Absen QR dibuat (lupa diupdate) — akibatnya **siapa pun** yang scan QR, termasuk karyawan sungguhan nanti, akan **selalu gagal tersimpan**, ditolak database secara diam-diam.

**Fix:** Halaman Absen QR dilonggarkan untuk semua role (konsisten dengan fix #87), dan kebijakan RLS insert/update absen mandiri diperluas menerima `source` `'mobile'` maupun `'qr'`, untuk semua role.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | `attendances_mobile_checkin_insert`/`_update` terima `source IN ('mobile','qr')`, semua role |
| `app/(dashboard)/absen-qr/[token]/page.tsx` | Hapus redirect yang membatasi cuma employee/supervisor |

---

### 89. Fix Bug: Tombol "Ambil Foto" Tidak Berfungsi

**Ditemukan:** Owner lapor tombol "Ambil Foto" di Absen QR/HP kadang tidak bereaksi sama sekali — diklik tapi tidak terjadi apa-apa. Penyebabnya: elemen video kamera butuh waktu singkat (biasanya <1 detik, tapi bisa lebih lama tergantung HP) sebelum `videoWidth`/`videoHeight` benar-benar terisi setelah stream kamera terbuka. Kalau tombol diklik SEBELUM itu, `drawImage` ke canvas gagal — dan karena tidak ada penanganan error di situ, kegagalannya diam-diam, kelihatan seperti tombol tidak berfungsi.

**Fix:** Tombol "Ambil Foto" sekarang terkunci (`disabled`, teks berubah jadi "Menyiapkan kamera...") sampai video benar-benar siap. Ditambah jaring pengaman: kalau tetap gagal, sekarang muncul pesan jelas ("Kamera belum siap...") alih-alih diam saja.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Tombol dikunci sampai video siap (`onLoadedMetadata`), tambah pesan error alih-alih gagal diam-diam |

---

### 90. Fix Bug: Layar Kamera Hitam Setelah Scan QR

**Ditemukan:** Owner lapor setelah scan QR, tombol "Ambil Foto" muncul (jadi kamera sudah dapat izin & tersambung), tapi layar preview-nya **hitam polos**, tidak menampilkan gambar apa pun. Penyebabnya: video kamera di-set sumbernya lewat JavaScript (`srcObject`), yang di sebagian browser/WebView Android tidak otomatis memicu pemutaran video walau ada atribut `autoPlay` — videonya "tersambung" tapi tidak pernah benar-benar main, jadi layarnya tetap hitam.

**Fix:**
- Ditambahkan pemanggilan `.play()` eksplisit setelah video tersambung, supaya tidak bergantung ke autoplay browser yang tidak selalu konsisten.
- Ditambahkan tombol **"Coba Ulang Kamera"** kecil di layar kamera — kalau tetap hitam (misal karena aplikasi scan QR belum sempat melepas kamera sepenuhnya), tinggal klik itu untuk minta ulang tanpa keluar dari alur absen.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Panggil `.play()` eksplisit setelah set `srcObject`, tombol "Coba Ulang Kamera" |

---

### 91. Fitur: Jalur Cadangan "Pakai Kamera Bawaan HP"

**Konteks:** Setelah fix #90, Owner masih mengalami layar kamera hitam terus di HP tertentu — izin kamera sudah benar di semua level (Android & Chrome), jadi bukan lagi soal izin. Kesimpulannya: beberapa HP/Chrome punya driver kamera yang memang tidak kompatibel dengan cara "live preview kamera" berbasis web (`getUserMedia`) yang dipakai Absen QR/HP, di luar kendali kode aplikasi ini.

**Fix:** Ditambahkan **jalur cadangan** di layar kamera — tombol "Pakai Kamera Bawaan HP" yang membuka **aplikasi kamera asli HP** (lewat `capture="user"`) alih-alih live-preview di web. Jauh lebih kompatibel karena tidak bergantung ke API kamera browser yang rewel itu. Foto yang diambil tetap diberi watermark (nama, waktu) yang sama persis seperti jalur utama, jadi hasil akhirnya identik — cuma cara mengambilnya yang beda.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Tombol "Pakai Kamera Bawaan HP" (`input[type=file][capture=user]`), watermark logic direfactor jadi fungsi bareng (`drawWatermark`) supaya kedua jalur hasilnya identik |

---

### 92. Fix Bug: Kode Karyawan yang Benar Tetap "Tidak Ditemukan"

**Ditemukan:** Karyawan sudah masukkan Kode Karyawan yang benar di halaman Daftar, tapi tetap muncul "Kode Karyawan tidak ditemukan". Penyebabnya: pencocokan kode ke database bersifat **case-sensitive** (membedakan huruf besar/kecil) — semua Kode Karyawan tersimpan huruf besar (`EMP-015`), tapi field input di form Daftar cuma "terlihat" huruf besar lewat CSS (`uppercase`), padahal nilai aslinya tidak ikut berubah. Jadi kalau HP karyawan defaultnya keyboard huruf kecil dan mereka ketik `emp-015`, sistem mencari `emp-015` (huruf kecil) yang memang tidak ada di database — walau kodenya sendiri sebenarnya benar.

**Fix:** Input Kode Karyawan di kedua form Daftar sekarang benar-benar mengubah hurufnya jadi besar saat diketik (bukan cuma tampilan), dan sebagai jaring pengaman tambahan, pencarian di server (`/api/signup` dan `/api/signup/quick`) sekarang menormalkan ke huruf besar juga sebelum dicocokkan — jadi walau input dari sisi mana pun (form lama, form baru, atau nanti API lain), pencarian tetap kena walau ada perbedaan huruf besar/kecil.

| File | Perubahan |
|---|---|
| `app/api/signup/route.ts`, `app/api/signup/quick/route.ts` | Normalisasi Kode Karyawan ke huruf besar sebelum dicocokkan |
| `app/(auth)/signup/page.tsx` | Input Kode Karyawan benar-benar diubah ke huruf besar saat diketik |

---

### 93. Perbaikan Diagnostik: Pesan Error Kamera Lebih Detail

**Konteks:** Kamera masih bermasalah di sebagian percobaan meski data & izin sudah benar, dan pesan errornya generik ("Tidak bisa mengakses kamera") sehingga sulit tahu penyebab pastinya — apakah izin ditolak, kamera tidak ada, atau (dugaan kuat) halamannya dibuka dari **dalam aplikasi lain** (WhatsApp/Instagram/aplikasi scan QR pihak ketiga) yang jendela browser-nya sengaja memblokir akses kamera oleh developer aplikasi itu sendiri, di luar kendali kode web mana pun.

**Perbaikan:**
- Ditambahkan deteksi lebih awal: kalau `navigator.mediaDevices` tidak tersedia sama sekali (ciri khas in-app browser yang membatasi), langsung tampil pesan spesifik yang menyarankan buka lewat Chrome/Safari langsung.
- Kalau tetap gagal di getUserMedia, pesan error sekarang menampilkan **detail teknis asli** (nama & pesan errornya), bukan cuma kalimat generik — supaya penyebab pastinya kelihatan jelas untuk ditelusuri lebih lanjut.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Deteksi dini `mediaDevices` tidak tersedia + pesan error kamera menampilkan detail teknis asli |

---

### 94. Fix Bug: Macet Selamanya di "Menyiapkan Kamera..."

**Ditemukan:** Setelah fix-fix sebelumnya, kamera masih bisa macet selamanya di teks "Menyiapkan kamera..." tanpa progres apa pun, tanpa error. Akar masalahnya ternyata bug timing di kode: stream kamera disambungkan ke elemen `<video>` lewat `setTimeout(fn, 0)`, yang **tidak menjamin** elemen video sudah benar-benar ada di halaman saat itu — kalau video belum sempat muncul duluan, penyambungannya gagal diam-diam dan macet selamanya karena tidak ada percobaan ulang.

**Fix:**
- Penyambungan stream ke video sekarang ditangani lewat `useEffect` (bukan `setTimeout`), yang React jamin baru berjalan SETELAH elemen videonya benar-benar ter-pasang di halaman — menghilangkan potensi gagal diam-diam ini sama sekali.
- Ditambah jaring pengaman: kalau 6 detik berlalu dan kamera tetap belum siap, sistem otomatis kasih pesan yang mengarahkan ke tombol "Coba Ulang Kamera" / "Pakai Kamera Bawaan HP", supaya pengguna tidak macet tanpa petunjuk.

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Ganti `setTimeout` jadi `useEffect` untuk sambung stream video, tambah timeout 6 detik sebagai jaring pengaman |

---

### 95. Perbaikan Cetak QR Absen: 2 per Halaman, Lebih Besar & Jelas

**Konteks:** Owner minta hasil cetak QR Absen dibuat 2 kode per halaman (supaya bisa dicetak lebih besar) dan nama cabang/tim ditampilkan jelas di tiap QR.

**Fix:**
- Halaman cetak sekarang **dipaksa 2 kolom** (tidak ikut lagi tata letak layar yang bisa 2-3 kolom tergantung ukuran layar) — otomatis pindah halaman baru setiap 2 QR.
- QR dicetak jauh lebih besar & tajam (resolusi gambar QR dinaikkan supaya tidak pecah/blur saat diperbesar).
- Tiap QR diberi label jelas: **"QR Absen — Cabang"** di atas, nama cabang (misal "Gudang") ditulis besar & tebal di bawahnya.

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/qr/page.tsx` | Layout cetak 2 kolom + page-break otomatis, QR resolusi lebih tinggi, label cabang lebih besar/jelas |

---

### 96. Cetak QR Absen: 1 per Halaman + Bisa Pilih Cabang Mana yang Dicetak

**Konteks:** Lanjutan dari fix #95 — Owner minta diubah jadi 1 QR per halaman (lebih besar lagi dari 2/halaman), dan ditambah fitur pilih cabang mana saja yang mau ikut dicetak (tidak harus semua cabang sekaligus).

**Fitur:**
- Cetak sekarang **1 QR per halaman**, ukurannya dibuat semaksimal mungkin.
- Tiap kartu QR di layar punya **centang "Ikut dicetak"** — defaultnya semua tercentang, bisa dilepas satu-satu kalau cuma mau cetak cabang tertentu (misal QR-nya cuma perlu diganti untuk 1 cabang yang bocor).
- Tombol **"Pilih Semua" / "Batalkan Semua"** untuk cepat centang/lepas semuanya sekaligus.
- Tombol cetak menampilkan jumlah yang akan dicetak, misal **"Cetak QR Terpilih (3)"**.
- Cabang yang tidak dicentang tetap kelihatan di layar (supaya gampang dicentang lagi nanti), cuma disembunyikan khusus saat proses cetak.

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/qr/page.tsx` | Checkbox pilih per cabang + Pilih/Batalkan Semua, layout cetak 1 kolom/1 QR per halaman |

---

### 97. Ubah Verifikasi Daftar Cepat: Nama Lengkap + Tanggal Lahir, Kode Karyawan Opsional

**Konteks:** Owner minta jalur "Daftar Cepat" diubah verifikasinya — dari Kode Karyawan sebagai satu-satunya syarat, jadi **Nama Lengkap + Tanggal Lahir** (dicocokkan ke data HR) sebagai verifikasi utama, dan **Kode Karyawan jadi opsional** (cuma dipakai untuk membedakan kalau kebetulan ada 2 karyawan dengan nama & tanggal lahir yang sama persis).

**Perubahan alur:** Karyawan isi Nama Lengkap (harus persis sama dengan data HR — nama ini juga yang dipakai bentuk email login) + Tanggal Lahir → sistem cari kecocokan otomatis begitu kedua kolom terisi → tampil konfirmasi "✓ Data ditemukan — Kode: EMP-012, Jabatan: Kasir". Kode Karyawan sekarang jadi kolom opsional bertanda "(isi kalau diminta HR)" — cuma perlu diisi kalau muncul pesan "ada lebih dari satu karyawan dengan nama & tanggal lahir sama".

⚠️ **Catatan penting dicek dari data:** dari 26 karyawan aktif, **11 orang (42%) belum punya Tanggal Lahir ATAUPUN No HP** di data HR. Karyawan ini untuk sementara **tidak bisa mendaftar sendiri lewat tab mana pun** (baik Verifikasi Lengkap yang butuh salah satu No HP/Tanggal Lahir, maupun Daftar Cepat yang sekarang butuh Tanggal Lahir) — perlu HR lengkapi dulu salah satu data itu di menu Karyawan, atau buatkan akunnya manual lewat Manajemen User.

| File | Perubahan |
|---|---|
| `app/api/signup/quick/route.ts` | Verifikasi jadi Nama Lengkap + Tanggal Lahir (Kode Karyawan opsional untuk disambiguasi) |
| `app/(auth)/signup/page.tsx` | Form Daftar Cepat: field Nama Lengkap & Tanggal Lahir wajib, Kode Karyawan opsional |

---

### 98. Daftar Cepat: Jalur Cadangan untuk Karyawan Tanpa Tanggal Lahir/No HP

**Konteks:** Fix #97 mewajibkan Tanggal Lahir untuk verifikasi Daftar Cepat — tapi 11 dari 26 karyawan aktif (42%) ternyata tidak punya Tanggal Lahir maupun No HP tercatat di HR sama sekali, jadi mereka jadi tidak bisa daftar lewat jalur mana pun. Owner minta jalur cadangan: karyawan seperti ini cukup masukkan **Kode Karyawan saja**.

**Fix:** Tanggal Lahir di Daftar Cepat sekarang **opsional**:
- **Kalau diisi** → verifikasi tetap seperti fix #97 (Nama + Tanggal Lahir dicocokkan ke HR, Kode Karyawan opsional untuk disambiguasi).
- **Kalau dikosongkan** → Kode Karyawan jadi **wajib** dan jadi satu-satunya syarat verifikasi — TAPI cuma diperbolehkan kalau data karyawan itu di HR memang **tidak punya No HP maupun Tanggal Lahir sama sekali**. Kalau ternyata karyawan itu punya salah satunya tapi sengaja dikosongkan, sistem menolak dan minta isi Tanggal Lahir yang benar (mencegah orang "curang" melewati verifikasi yang lebih kuat kalau sebenarnya bisa dipakai).

| File | Perubahan |
|---|---|
| `app/api/signup/quick/route.ts` | Tambah jalur verifikasi Kode-Karyawan-saja, dibatasi cuma untuk karyawan tanpa No HP & Tanggal Lahir sama sekali |
| `app/(auth)/signup/page.tsx` | Tanggal Lahir jadi opsional, Kode Karyawan wajib kalau Tanggal Lahir dikosongkan |

---

### 99. Fitur: Karyawan Bisa Edit Data Pribadi Sendiri di Profil Saya

**Konteks:** Owner minta karyawan bisa isi/edit data dirinya sendiri lewat Portal Saya, supaya lebih mudah ke depannya — termasuk melengkapi No HP/Tanggal Lahir yang tadinya kosong (yang menghalangi Daftar Cepat, lihat fix #98) tanpa perlu minta HR input satu-satu.

**Fitur:** Halaman **Profil Saya** sekarang punya tombol **"✏️ Edit Data Pribadi"**. Bagian yang bisa diedit sendiri: No HP, Tanggal & Tempat Lahir, Jenis Kelamin, Agama, Status Pernikahan, Jumlah Tanggungan, Pendidikan Terakhir, Alamat, dan Kontak Darurat (nama/HP/hubungan).

**Yang SENGAJA tetap cuma bisa dilihat (tidak bisa diedit sendiri):** Data Kepegawaian (nama, kode karyawan, jabatan, departemen, cabang, tanggal bergabung, NIK) dan Rekening Bank — perubahan data ini tetap harus lewat HR, karena menyangkut identitas resmi dan keamanan transfer gaji (kalau rekening bisa diubah sendiri tanpa verifikasi, itu jalur penipuan yang gampang disalahgunakan).

**Kenapa lewat RPC, bukan izin tulis langsung ke tabel:** Semua role (owner/hr/employee/dst) di sistem ini berbagi satu akses database yang sama, jadi tidak bisa membatasi kolom mana yang boleh diubah per role pakai cara biasa. Fungsi database khusus (`update_own_employee_profile`) yang menjaga ini — cuma mengizinkan kolom-kolom "aman" di atas yang bisa disentuh, dan cuma untuk baris milik sendiri.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | RPC `update_own_employee_profile` — update kolom data pribadi milik sendiri saja |
| `app/(dashboard)/portal/profil/page.tsx` | Mode edit untuk Data Pribadi & Kontak Darurat, Data Kepegawaian/Rekening tetap read-only |

---

### 100. Fitur: Lihat Akun Baru Daftar di Manajemen User

**Konteks:** Owner sering menanyakan "ada karyawan baru daftar tidak?" — supaya tidak perlu tanya terus, ditambahkan tampilan langsung di menu **Manajemen User** (`/users`).

**Fitur:**
- Muncul kotak ringkasan biru di atas tabel: **"🆕 N akun baru dalam 7 hari terakhir"**, berisi daftar nama + kode karyawan + kapan daftarnya, langsung kelihatan tanpa perlu buka tabel.
- Tabel akun sekarang ada kolom **"Terdaftar"** menampilkan kapan tiap akun dibuat ("Hari ini", "Kemarin", "3 hari lalu", dst.), dengan label **"Baru"** untuk yang kurang dari 7 hari.
- Tabel sudah otomatis terurut dari yang paling baru daftar (tidak berubah, sudah begitu dari awal).

| File | Perubahan |
|---|---|
| `app/(dashboard)/users/page.tsx` | Kotak ringkasan akun baru + kolom "Terdaftar" dengan label "Baru" |

---

### 101. Fitur: Karyawan Bisa Unggah/Ganti Foto Profil Sendiri

**Konteks:** Lanjutan dari fix #99 (edit data pribadi) — Owner minta karyawan juga bisa unggah/ganti foto profilnya sendiri di halaman yang sama.

**Fitur:** Di Portal Saya → Profil Saya, sekarang ada foto profil (avatar bulat) di sebelah judul halaman. Waktu mode "Edit Data Pribadi" aktif, muncul tombol ✏️ kecil di pojok foto — klik untuk pilih foto baru dari galeri/kamera HP, langsung terlihat pratinjaunya, tersimpan bareng saat klik "Simpan Perubahan".

**Bug keamanan yang ditemukan &amp; ditutup sekalian:** waktu membangun ini, ketahuan kebijakan upload/hapus foto di bucket `employee-photos` ternyata **terbuka penuh** — siapa pun yang login bisa upload/timpa/hapus foto profil KARYAWAN LAIN (bukan cuma miliknya sendiri). Dibatasi sekarang: HR/Owner tetap bebas kelola semua foto (dipakai menu Karyawan), tapi employee/supervisor/finance cuma bisa upload/hapus foto milik sendiri. Sekalian ditambah batas ukuran (5MB) dan tipe file (JPEG/PNG/WebP saja) yang sebelumnya tidak ada sama sekali.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Fungsi `get_my_employee_code()`, perbaikan RLS storage `employee-photos` (upload/hapus dibatasi milik sendiri untuk role non-admin), batas ukuran/tipe file, `update_own_employee_profile` ditambah parameter `p_photo_url` |
| `app/(dashboard)/portal/profil/page.tsx` | Avatar + upload foto profil sendiri di mode edit |

---

### 102. Tampilkan Email Login di Profil Saya (Password Tidak Bisa Ditampilkan)

**Konteks:** Owner minta email & password karyawan ditampilkan di Profil Saya (dengan titik-titik + tombol lihat) supaya tidak lupa. Email bisa, tapi **password secara teknis tidak mungkin ditampilkan ulang dalam bentuk apa pun** — begitu dibuat, password langsung diubah jadi hash satu arah yang tidak bisa dibalik lagi ke teks asli (standar keamanan semua sistem login, bukan keterbatasan aplikasi ini; bahkan Supabase sendiri sebagai penyedia layanan auth tidak menyimpan/bisa melihat password asli siapa pun).

**Yang dibuat:** Field **"Email Login"** ditambahkan di kartu Data Kepegawaian, Profil Saya — supaya karyawan selalu bisa lihat email login mereka kapan saja tanpa perlu tanya HR/Owner. Kotak info di halaman itu juga diperbarui, mengarahkan ke tombol 🔑 **Perbarui Akun** (fix #96) sebagai jalan resmi kalau lupa/mau ganti password.

| File | Perubahan |
|---|---|
| `app/(dashboard)/portal/profil/page.tsx` | Tampilkan email login (dari sesi auth), catatan soal password tidak bisa ditampilkan |

---

### 103. Fitur: Karyawan Bisa Merangkap Jabatan (Kenek merangkap Driver)

**Konteks:** Owner butuh karyawan (misal Kenek) bisa merangkap jadi Driver juga — baik dari sisi catatan HR maupun perhitungan gajinya, karena kadang orang yang sama jalan sebagai kenek, kadang sebagai driver, dan keduanya harus terhitung.

**Ditemukan waktu dianalisis:** sistem upah & kasbon driver/kenek **sudah otomatis mendukung dobel peran** — 1 baris `delivery_trips` punya `driver_id` dan `helper_id` terpisah, jadi upah driver & kenek dihitung independen per trip meski orangnya sama. Yang belum ada cuma cara memasukkan karyawan itu ke **daftar pilihan Driver** tanpa merusak jalur utamanya — karena field `employee_type` (yang menentukan siapa masuk daftar Driver) ternyata JUGA dipakai penggajian bulanan (`employee_type IN ('permanent','training')`) — kalau tipe seorang Kenek diubah jadi `'driver'`, dia malah **hilang dari penggajian bulanan**.

**Fitur:** Kolom baru `can_drive` di data karyawan — independen dari jabatan/tipe utamanya. Di menu **Karyawan**, ada centang baru **"Bisa jadi Driver (misal Kenek merangkap Driver)"** saat tambah/edit karyawan. Begitu dicentang:
- Karyawan itu otomatis muncul di pilihan Driver saat input trip (Penggajian → Driver) dan saat buat kasbon driver — TANPA mengubah jabatan/tipe utamanya, jadi tetap ikut penggajian bulanan & pengecualian telat Gudang seperti biasa.
- Muncul label **"+ Driver"** di daftar Karyawan dan **"Merangkap Driver"** di detail karyawan serta di Profil Saya milik karyawan itu sendiri.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Kolom `employees.can_drive` (boolean, default false) |
| `app/(dashboard)/karyawan/page.tsx` | Centang "Bisa jadi Driver" di form, label "+ Driver"/"Merangkap Driver" di list & detail |
| `app/(dashboard)/penggajian/driver/page.tsx`, `app/(dashboard)/kasbon/page.tsx` | Daftar pilihan Driver ikut sertakan karyawan `can_drive=true` |
| `app/(dashboard)/portal/profil/page.tsx` | Label "(merangkap Driver)" di Jabatan, Profil Saya |

---

### 104. Rombak Total Verifikasi "Sudah Jadi Karyawan": Tanpa Kode Karyawan

**Konteks:** Owner minta jalur "Kode Karyawan Saja" dirombak total karena sering bikin karyawan bingung/error. Aturan baru: **tidak ada lagi Kode Karyawan sama sekali**. Cukup Nama Lengkap, No HP, dan Tanggal Lahir — dengan aturan **Tanggal Lahir wajib cocok** dengan data HR, dan minimal **salah satu** dari Nama Lengkap atau No HP juga harus cocok. Kalau gagal, pesan errornya sekarang **spesifik** menyebut bagian yang salah (misal "Tanggal Lahir tidak cocok dengan data HR"), bukan pesan generik yang bikin bingung harus mengecek yang mana.

**Perubahan alur:** Tab "Kode Karyawan Saja" diganti nama jadi **"Sudah Jadi Karyawan"**. Field yang diminta cuma Nama Lengkap, Tanggal Lahir (wajib), dan No HP (boleh kosong asal Nama sudah pasti persis sama). Email login tetap dibentuk dari **nama asli yang tercatat di HR** (bukan dari yang diketik user) — supaya tetap konsisten walau yang bikin lolos verifikasi ternyata kecocokan No HP, bukan nama.

⚠️ **Konsekuensi penting:** karena Tanggal Lahir sekarang wajib cocok dan Kode Karyawan dihapus total, **11 karyawan yang belum punya Tanggal Lahir tercatat di HR** (Ade, Iki, Reza Ardhiansyah, Syifa Fauziah, Fauzan Rahman, Irma, Yana, Edi, Away, Elan Suherlan, Reza Driver) **tidak bisa mendaftar sama sekali** lewat tab ini sampai HR mengisi Tanggal Lahir mereka di menu Karyawan (atau karyawan itu sendiri, kalau kebetulan sudah punya akun lain, bisa isi sendiri lewat Portal Saya).

| File | Perubahan |
|---|---|
| `app/api/signup/quick/route.ts` | Verifikasi dirombak: Tanggal Lahir wajib + (Nama ATAU No HP), tanpa Kode Karyawan; error spesifik per bagian |
| `app/(auth)/signup/page.tsx` | Tab "Sudah Jadi Karyawan" — field Nama Lengkap, Tanggal Lahir, No HP (tanpa Kode Karyawan) |

---

### 105. Fix Bug: Foto Absen Tidak Muncul di Mode "Semua Karyawan"

**Ditemukan:** Owner lapor ikon foto 📷 tidak muncul di Rekap Absensi. Ternyata ikon itu cuma dipasang di tampilan tabel waktu filter **Karyawan** sedang memilih 1 orang spesifik — begitu filter diset ke **"Semua Karyawan"** (tampilan default), kolom Masuk/Pulang menampilkan jam tanpa ikon foto sama sekali, walau datanya ada.

**Fix:** Ikon 📷 ditambahkan juga ke tampilan mode "Semua Karyawan", sama persis seperti di mode per-karyawan.

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/rekap/page.tsx` | Ikon foto 📷 ditambahkan ke baris mode "Semua Karyawan" |

---

### 106. Fitur: Konfirmasi Eksplisit Sebelum Kamera Absen Terbuka

**Konteks:** Owner minta alur absen selfie diperjelas — sebelum kamera terbuka, tanya dulu eksplisit "ini absen masuk atau pulang?" supaya tidak membingungkan (sebelumnya sistem langsung ke kamera begitu tombol ditekan, cuma mengandalkan label tombol yang mungkin tidak terbaca teliti).

**Fitur:** Setelah tombol "Absen Masuk"/"Absen Pulang" ditekan, sekarang muncul **layar konfirmasi** dulu — menampilkan besar-besar **"🟢 ABSEN MASUK"** atau **"🔵 ABSEN PULANG"** beserta nama karyawan & jam saat itu, dengan tombol **"Batal"** dan **"Ya, Benar"**. Kamera baru terbuka setelah dikonfirmasi. Berlaku untuk Absen QR maupun Absen HP (keduanya pakai komponen yang sama).

| File | Perubahan |
|---|---|
| `components/AbsenSekarang.tsx` | Tambah langkah `confirm-action` sebelum kamera dibuka |

---

### 107. Pengaman Jarak Waktu Absen + Kartu "Tidak Absen" di Dashboard Karyawan

**Konteks:** Owner minta 2 hal: (1) cegah absen pulang yang terlalu berdekatan waktunya dengan absen masuk (salah pencet atau disengaja memalsukan kehadiran), dan (2) tambahan info di dashboard tiap karyawan menampilkan jumlah hari tidak absen (alpha).

**1. Pengaman jarak waktu absen:** Absen pulang sekarang minimal **15 menit** setelah absen masuk. Dicek di 2 lapis:
- Di aplikasi — kalau dicoba lebih cepat, langsung muncul pesan "Anda baru absen masuk X menit lalu... tunggu Y menit lagi" SEBELUM kamera dibuka (tidak perlu foto dulu baru ditolak).
- Di database (RLS) — supaya tidak bisa dilewati lewat jalur lain di luar aplikasi ini.

**2. Kartu "Tidak Absen (Bulan Ini)" di Dashboard:** Dashboard karyawan (dan siapa pun yang pakai Portal Saya) sekarang punya kartu ke-4 menampilkan jumlah hari berstatus "Alpha" (tidak hadir tanpa keterangan) bulan berjalan — beda dari cuti/sakit/izin, yang tidak ikut dihitung di sini. Angkanya merah kalau lebih dari 0.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | RLS `attendances_mobile_checkin_update` menambah syarat jarak minimal 15 menit check_in→check_out |
| `components/AbsenSekarang.tsx` | Cek jarak waktu sebelum tampilkan layar konfirmasi |
| `app/(dashboard)/dashboard/page.tsx` | Kartu baru "Tidak Absen (Bulan Ini)" |

---

### 108. Fitur: Pengajuan Jadwal Libur Awal (1 dari 2 Tahap)

**Konteks:** Owner minta sistem baru — karyawan sendiri yang memilih jadwal liburnya untuk periode 26–25 mendatang (maksimal 4 tanggal), bukan HR yang menentukan semua secara manual dari awal. Ada peringatan (bukan penghalang) kalau tanggal yang dipilih sama dengan rekan lain (lintas cabang), dan HR/Owner tetap jadi penentu akhir sebelum resmi. Ini **tahap 1 dari 2** — tahap 2 (Pengajuan Ganti Hari Libur untuk yang sudah disetujui, dengan mekanisme tukar antar-karyawan) menyusul setelah ini dites dan dikonfirmasi jalan dengan baik.

**Fitur:**
- Halaman baru **Portal Saya → Ajukan Libur** — daftar semua tanggal di periode 26–25 mendatang, karyawan tinggal klik "Ajukan Libur" per tanggal (maks 4), bisa dibatalkan sendiri selama masih berstatus "Menunggu HR". Tanggal yang sudah dipilih rekan lain (cabang mana pun, termasuk yang masih menunggu approval) ditandai kuning dengan nama-namanya.
- Halaman baru **Absensi → Persetujuan Libur** (HR/Owner) — daftar semua pengajuan, tombol Setujui/Tolak (tolak wajib disertai alasan), plus penanda kalau ada beberapa orang mengajukan tanggal yang sama sekaligus.
- Begitu disetujui, otomatis masuk ke `employee_roster` — langsung berlaku di semua fitur yang sudah ada (Jadwal Saya, cek libur di Absen QR, dll). Menu Jadwal & Shift yang sudah ada tetap bisa dipakai HR untuk atur manual (fallback untuk yang tidak sempat mengajukan sendiri).

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Tabel `roster_pick_requests` (maks 4/periode, RLS insert/select/delete), RPC `decide_roster_pick_request`, RPC `get_company_dayoff_calendar` (lintas cabang, pending+approved) |
| `lib/rosterPeriod.ts` (baru) | Helper hitung periode 26–25 mendatang |
| `app/(dashboard)/portal/ajukan-libur/page.tsx` (baru) | Halaman karyawan ajukan/batalkan libur |
| `app/(dashboard)/absensi/persetujuan-libur/page.tsx` (baru) | Halaman HR/Owner approve/tolak |
| `components/sidebar.tsx` | Menu "Ajukan Libur" (semua role) & "Persetujuan Libur" (admin) |

---

### 109. Fix Bug: Kasbon Driver/Kenek Tidak Muncul di Verifikasi Keuangan

**Konteks:** Owner menemukan pengajuan kasbon driver & kenek tidak pernah muncul di halaman **Verifikasi Keuangan**, padahal ada 2 pengajuan kenek yang sudah lama menunggu. Setelah dianalisa, halaman itu selama ini hanya query tabel `kasbon_requests` (kasbon karyawan biasa) — tidak pernah menyentuh tabel `driver_kasbon` dan `helper_kasbon` sama sekali, karena keduanya memang tabel terpisah dengan alur approval sendiri. Selama ini kasbon driver/kenek cuma bisa dilihat/diproses lewat menu Kasbon, jadi gampang kelewat kalau HR/Owner cuma cek Verifikasi Keuangan.

**Fix:**
- Halaman **Verifikasi Keuangan** dapat tab baru "Kasbon Driver/Kenek", menampilkan semua pengajuan `pending_approval` dari kedua tabel sekaligus (kolom "Jenis" membedakan Driver vs Kenek).
- Setujui memanggil RPC yang sudah ada (`approve_driver_kasbon` / `approve_helper_kasbon`, dibatasi role Owner — sama seperti di menu Kasbon). Tolak berarti menghapus pengajuannya (tidak ada status "ditolak" formal untuk 2 tabel ini, mengikuti alur yang sudah ada).
- Tab ini per-baris (bukan proses massal) dan tanpa filter cabang, karena kedua tabel tidak punya kolom `branch_id`.

| File | Perubahan |
|---|---|
| `app/(dashboard)/keuangan/approval/page.tsx` | Tab baru "Kasbon Driver/Kenek": query `driver_kasbon`+`helper_kasbon`, handler approve/reject, kolom & rendering baris baru |

---

### 110. Fitur: Pengajuan Ganti Hari Libur (2 dari 2 Tahap) — Tukar Mutual Antar-Karyawan

**Konteks:** Lanjutan dari fitur Pengajuan Jadwal Libur Awal (#108, tahap 1). Tahap 2 ini untuk karyawan yang ingin mengubah hari libur yang **sudah disetujui** ke tanggal lain. Kalau tanggal baru yang diinginkan sudah menjadi hari libur rekan lain, ini bukan sekadar pindah tanggal sepihak — sistem mengajukan **tukar mutual penuh**: karyawan A pindah ke tanggal rekannya (B), dan B mendapat tanggal lama A sebagai gantinya. B harus setuju dulu lewat notifikasi + halaman khusus sebelum diteruskan ke HR/Owner untuk keputusan akhir. Kalau tanggal baru masih kosong, langsung jadi pengajuan biasa yang cuma butuh persetujuan HR/Owner. Batas waktu pengajuan: minimal H-2, dihitung dari tanggal yang **paling dekat** di antara tanggal lama dan tanggal baru (dikonfirmasi ke Owner).

**Fitur:**
- Halaman baru **Portal Saya → Ganti Hari Libur** — pilih hari libur yang mau diganti (dari yang sudah disetujui), lalu tanggal baru; sistem otomatis cek ke tabel `employee_roster` apakah tanggal itu sudah jadi libur rekan (satu cabang). Kalau ada, wajib pilih siapa yang diajak tukar. Halaman yang sama juga menampilkan permintaan tukar masuk dari rekan lain (Terima/Tolak), dan riwayat pengajuan sendiri (bisa dibatalkan selama belum diputuskan final).
- Halaman **Absensi → Persetujuan Libur** ditambah tab kedua "Ganti Hari Libur" — HR/Owner memutuskan pengajuan yang statusnya sudah `pending_approval` (tanpa rekan, atau rekan sudah menerima). Saat menyetujui, HR memilih jadwal shift untuk tanggal yang kembali jadi hari kerja (untuk pemohon, dan untuk rekan juga kalau ini tukar).
- **Notifikasi (ikon lonceng)** — karyawan yang diminta tukar dapat notifikasi "... minta tukar hari libur dengan Anda"; pemohon dapat notifikasi begitu pengajuannya disetujui/ditolak/dibatalkan.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Tabel `roster_change_requests`; RPC `request_day_off_change`, `respond_day_off_swap`, `decide_day_off_change`, `get_branch_dayoff_colleagues`, `get_my_day_off_change_requests`, `get_incoming_day_off_swap_requests` |
| `app/(dashboard)/portal/ganti-libur/page.tsx` (baru) | Halaman karyawan ajukan ganti libur + respon tukar dari rekan |
| `app/(dashboard)/absensi/persetujuan-libur/page.tsx` | Tab kedua "Ganti Hari Libur" untuk HR/Owner, termasuk modal pilih jadwal shift saat approve |
| `components/NotifikasiBell.tsx` | Notifikasi permintaan tukar masuk + status pengajuan ganti libur sendiri |
| `components/sidebar.tsx` | Menu "Ganti Hari Libur" di Portal Saya (semua role) |

---

### 111. Fix Bug Edit Keterlambatan + Fitur Toleransi 5 Menit Absen QR

**Konteks:** Owner melaporkan edit angka keterlambatan di menu Rekap Absensi tidak pernah tersimpan — sudah diubah, tapi begitu disimpan balik lagi ke angka semula. Setelah dianalisa, penyebabnya trigger database `calc_attendance_times` yang otomatis menghitung ulang keterlambatan setiap kali baris absensi di-update, KECUALI kalau jam masuknya persis sama seperti sebelumnya. Masalahnya, form edit cuma punya input jam:menit (tanpa detik), sedangkan jam masuk asli dari absen QR/HP tersimpan sampai ke detik — jadi begitu form disimpan, jam masuk yang ditulis ulang (detik dibulatkan ke `:00`) hampir selalu dianggap "berbeda" walau HR tidak menyentuhnya sama sekali, dan trigger pun menghitung ulang lalu menimpa balik edit manual tadi.

Sekaligus menambahkan fitur baru yang diminta: **toleransi 5 menit khusus absen via QR** — telat 1-5 menit tidak kena potongan gaji (antisipasi HP lemot/error saat scan), tapi keterlambatannya tetap tercatat & tetap muncul di notifikasi/riwayat karyawan supaya tidak bikin lalai.

**Fix:**
- Trigger `calc_attendance_times` sekarang membandingkan jam masuk lama vs baru **dibulatkan ke menit** (bukan ke detik) untuk menentukan apakah perlu hitung ulang — edit manual yang tidak benar-benar mengubah jam masuk sekarang tersimpan dengan benar.

**Fitur Toleransi 5 Menit (khusus source absen QR):**
- Angka keterlambatan ASLI tetap disimpan & ditampilkan apa adanya di semua tempat (notifikasi, Rekap Absensi, Ranking) — toleransi ini HANYA mengecilkan potongan gaji, bukan menyembunyikan datanya.
- Notifikasi langsung setelah absen QR diperjelas: telat ≤5 menit → "masih dalam toleransi 5 menit, tidak dipotong"; telat >5 menit → "kena potongan keterlambatan".
- Slip Gaji Bulanan (admin), tab Riwayat Telat (admin), dan Slip Gaji Saya (karyawan) — hari dengan telat ≤5 menit via QR ditandai "toleransi, tidak dipotong" dan potongannya Rp0, tapi tetap tampil di daftar untuk transparansi.
- Ranking/KPI sengaja TIDAK diberi toleransi — tetap pakai angka keterlambatan asli, karena bukan potongan uang.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Fix trigger `calc_attendance_times`: bandingkan check_in dibulatkan ke menit |
| `lib/lateTolerance.ts` (baru) | Konstanta toleransi 5 menit + helper `chargeableLateMinutes`/`isLateTolerated` |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Toleransi di kalkulasi slip utama + tab Riwayat Telat |
| `app/(dashboard)/portal/slip-gaji/page.tsx` | Toleransi di rincian keterlambatan Slip Gaji Saya |
| `components/AbsenSekarang.tsx` | Pesan notifikasi absen QR membedakan dalam-toleransi vs kena potongan |

---

### 112. Fitur: Auto-Promosi Training → Staff Tetap (dengan Verifikasi)

**Konteks:** Owner ingin karyawan training otomatis naik status jadi staff tetap begitu masa kerjanya lewat 3 bulan — dihitung berdasarkan periode 26–25 (bukan bulan kalender), sama seperti seluruh siklus roster/payroll di sistem ini. Contoh: masuk 10 Oktober → lewat 26 Oktober = 1 bulan, lewat 26 November = 2 bulan, lewat 26 Desember = 3 bulan → memenuhi syarat naik jadi tetap. Owner juga minta ini TIDAK langsung otomatis mengubah status tanpa sepengetahuan HR — harus ada notifikasi dan verifikasi dulu.

**Fitur:**
- Job harian (pg_cron) mengecek semua karyawan `training` setiap hari, begitu masa kerjanya lewat 3 periode cutoff otomatis masuk antrean "Promosi Training" — TIDAK langsung mengubah status karyawan.
- Halaman baru **SDM/HR → Promosi Training** — HR/Owner Setujui (baru status karyawan benar-benar berubah jadi Staff Tetap) atau Tunda (dengan alasan wajib, status tetap training).
- Notifikasi (ikon lonceng) muncul untuk role Owner/HR begitu ada kandidat baru menunggu verifikasi — bell ini sebelumnya cuma aktif untuk karyawan/supervisor, sekarang aktif juga untuk admin.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Fungsi `cutoff_periods_completed`, tabel `training_promotion_candidates`, RPC `decide_training_promotion`, job cron harian `generate_training_promotion_candidates` |
| `app/(dashboard)/karyawan/promosi-training/page.tsx` (baru) | Halaman verifikasi HR/Owner |
| `components/sidebar.tsx` | Menu "Promosi Training" di grup SDM/HR |
| `components/NotifikasiBell.tsx` | Notifikasi untuk Owner/HR saat ada kandidat pending |

---

### 113. Fitur: Gaji Standar Staff & Team Toko + Tunjangan Khusus

**Konteks:** Owner mengeluhkan harus input gaji pokok & tunjangan satu-persatu untuk setiap staff/Team Toko, padahal angkanya sama semua (gapok 600rb + tunjangan 600rb) — cuma "tunjangan khusus" yang memang beda per orang untuk kasus tertentu. Berlaku untuk semua Staff & Team Toko, TIDAK untuk driver/kenek (yang memang sudah punya sistem upah sendiri, terpisah dari `salary_components`).

**Fitur:**
- Kolom baru **Tunjangan Khusus** di Komponen Gaji — terpisah dari Tunjangan Jabatan/Tetap, khusus untuk pengecualian per orang. Muncul sebagai baris tersendiri di semua slip gaji (admin & karyawan).
- **Gaji Standar** — acuan gapok+tunjangan yang bisa diedit HR (menu "Kelola Gaji Standar" di halaman Komponen Gaji), dipakai untuk:
  - **Autofill** — form karyawan baru yang belum punya gaji otomatis terisi angka standar, HR tinggal cek/simpan.
  - **Terapkan ke Karyawan Terpilih** — pilih banyak karyawan sekaligus (centang), sekali klik langsung menyamakan gaji pokok & tunjangan mereka ke angka standar, tanpa ketik ulang satu-satu. Tunjangan khusus masing-masing tidak ikut berubah.
  - Mengubah angka Gaji Standar TIDAK otomatis mengubah gaji siapa pun yang sudah diatur — tetap harus lewat "Terapkan" secara sadar, supaya tidak ada perubahan gaji yang tidak disengaja.
- Sekalian dibenahi bug lama: form edit Komponen Gaji per-karyawan dulu selalu menimpa baris riwayat TERAKHIR apa pun tanggal efektifnya — sekarang baris baru hanya ditambah kalau tanggal efektifnya benar-benar beda, kalau sama berarti koreksi ke baris itu (riwayat kenaikan gaji jadi tersimpan benar).

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Kolom `salary_components.special_allowance` & `payrolls.special_allowance`, tabel `salary_defaults` (seed "Standar Staff & Team Toko" 600rb+600rb) |
| `app/(dashboard)/penggajian/komponen/page.tsx` | Bulk-select + "Terapkan Gaji Standar" + editor Gaji Standar |
| `app/(dashboard)/penggajian/komponen/[employee_id]/page.tsx` | Field Tunjangan Khusus, autofill dari Gaji Standar, fix bug timpa riwayat |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Tunjangan Khusus ikut kalkulasi gaji, daily rate, slip, cetak |
| `app/(dashboard)/penggajian/ringkasan/page.tsx` | Tunjangan Khusus ikut rincian gaji awal |
| `app/(dashboard)/portal/slip-gaji/page.tsx` | Tunjangan Khusus tampil di slip gaji karyawan |

---

### 114. Fix Bug: Pengajuan Jadwal Libur Awal Tidak Muncul di Persetujuan

**Konteks:** Owner melaporkan ada karyawan yang sudah mengajukan jadwal libur bulan depan, tapi di halaman Persetujuan Libur tetap tertulis "Belum ada pengajuan yang menunggu" — padahal datanya benar-benar ada dan valid di database (dikonfirmasi langsung lewat query, 8 pengajuan pending). Setelah ditelusuri, penyebabnya: tabel `roster_pick_requests` punya DUA relasi ke tabel `employees` (`employee_id` dan `decided_by`), sehingga saat halaman minta data karyawan lewat `employees(...)` tanpa menyebutkan relasi mana yang dimaksud, Supabase bingung dan menolak permintaannya — tapi errornya tidak pernah ditangkap/ditampilkan oleh kode, jadi yang terlihat cuma daftar kosong tanpa pesan error sama sekali. Bug yang sama juga ditemukan baru saja tercipta di fitur Promosi Training (dibangun hari ini, tabel `training_promotion_candidates` punya masalah relasi yang identik) — untungnya ketemu sebelum sempat dipakai.

**Fix:**
- Query di halaman Persetujuan Libur (tab Jadwal Libur Awal) dan Promosi Training sekarang menyebutkan secara eksplisit relasi mana yang dipakai (`employee_id`, bukan `decided_by`), sesuai isi pengajuannya.
- Error dari query sekarang selalu dicatat ke console — supaya masalah serupa di masa depan tidak lagi "hilang diam-diam" tanpa jejak.

| File | Perubahan |
|---|---|
| `app/(dashboard)/absensi/persetujuan-libur/page.tsx` | Fix relasi eksplisit ke `employees` untuk kedua tab + logging error |
| `app/(dashboard)/karyawan/promosi-training/page.tsx` | Fix relasi eksplisit + logging error |
| `components/NotifikasiBell.tsx` | Fix relasi eksplisit untuk notifikasi promosi training |

---

### 115. Fitur: Batas 1 Hari Weekend per Periode untuk Pengajuan Libur

**Konteks:** Owner menemukan pola tidak adil — Rijal Rijaldi (Toko Pusat, 7 karyawan) mengajukan 4 hari liburnya untuk periode depan, dan **ke-4nya jatuh di weekend** (3 Sabtu + 1 Minggu). Karena toko buka setiap hari, weekend jadi hari primadona — kalau 1 orang terus-menerus menguasai weekend, rekan lain di cabang yang sama tidak pernah kebagian giliran. Aturan baru: di cabang dengan **lebih dari 2 karyawan aktif**, satu karyawan cuma boleh pilih **1 tanggal weekend (Sabtu/Minggu)** dari maksimal 4 pengajuan liburnya per periode. Cabang kecil (2 karyawan atau kurang) dikecualikan — tidak ada rekan yang dirugikan kalau cuma sendiri/berdua. Berlaku untuk periode mendatang (tidak menyentuh pengajuan yang sudah ada).

**Fitur:**
- Halaman **Portal Saya → Ajukan Libur** menampilkan banner penjelasan yang jelas begitu halaman dibuka (khusus cabang yang kena aturan ini) — supaya karyawan langsung paham aturannya sendiri tanpa perlu dijelaskan manual oleh Owner/HR. Ditambah penghitung "Weekend: 0/1", label "Weekend" di tanggal Sabtu/Minggu, dan begitu jatah habis, tanggal weekend lain otomatis tidak bisa dipilih lagi (dengan keterangan alasannya).
- Aturan ini ditegakkan juga di level database (bukan cuma tampilan) — jadi tidak bisa dilewati lewat jalur lain.
- 4 pengajuan Rijal Rijaldi yang sudah terlanjur (semuanya weekend, sebelum aturan ini ada) dihapus atas persetujuan Owner — dia diminta mengajukan ulang sesuai aturan baru.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Fungsi `get_my_branch_employee_count`; RLS `roster_pick_requests_insert` diperluas dengan batas 1 weekend/periode untuk cabang >2 karyawan |
| `app/(dashboard)/portal/ajukan-libur/page.tsx` | Penghitung & label Weekend, tanggal weekend nonaktif otomatis setelah jatah habis |

---

### 116. Fix: Konfirmasi Sebelum Batalkan Pengajuan Libur

**Konteks:** Owner khawatir soal risiko salah klik tombol "Batalkan" di halaman Ajukan Libur. Dicek: tombol itu sudah aman secara struktural — hanya muncul untuk tanggal milik sendiri (dijamin RLS di database, bukan cuma tampilan), jadi karyawan tidak mungkin membatalkan pengajuan rekan. Tapi ditemukan celah kecil: membatalkan pengajuan **milik sendiri** langsung terjadi tanpa konfirmasi apa pun — sekali salah pencet, langsung hilang.

**Fix:** Tombol "Batalkan" sekarang menampilkan dialog konfirmasi ("Batalkan pengajuan libur tanggal ...?") sebelum benar-benar menghapus.

| File | Perubahan |
|---|---|
| `app/(dashboard)/portal/ajukan-libur/page.tsx` | Tambah dialog konfirmasi sebelum batalkan |

---

### 117. Perjelas Tombol Batalkan di Ajukan Libur (Merah Solid)

**Konteks:** Tombol "Batalkan" sebelumnya cuma outline merah tipis — gampang tidak disadari kalau tanggal itu sebenarnya sudah dipilih. Owner minta diperjelas jadi tombol merah solid begitu tanggal sudah diajukan, supaya lebih gampang dikenali kapan sebuah tanggal sudah jadi pilihan sendiri dan bisa dibatalkan.

**Fix:**
- Tanggal yang statusnya masih "Menunggu HR" (pending) sekarang tombolnya merah solid "Batalkan" — jelas kelihatan aktif dan bisa diklik.
- Tanggal yang sudah "Disetujui" tetap tombol abu-abu "Terkunci" (tidak bisa dibatalkan sendiri), supaya tidak tertukar dengan yang masih bisa dibatalkan.
- Data pengajuan Rijal Rijaldi yang tersisa (24 Okt & 5 Okt) dihapus atas permintaan Owner.

| File | Perubahan |
|---|---|
| `app/(dashboard)/portal/ajukan-libur/page.tsx` | Tombol Batalkan jadi merah solid untuk pengajuan pending |

---

### 118. Fitur: Undang Karyawan Baru (Onboarding Mandiri via Link Sekali Pakai)

**Konteks:** Owner capek input data pribadi karyawan baru satu-per-satu manual. Sekarang bisa didelegasikan ke karyawan itu sendiri — Owner/HR cukup tentukan penempatan (cabang, posisi, tipe karyawan), sistem buatkan link sekali pakai, karyawan baru yang isi data pribadinya sendiri + bikin password sendiri. Beda dari `/signup` yang sudah ada (itu untuk karyawan yang datanya SUDAH ada di HR) — ini khusus untuk yang benar-benar baru, belum ada baris datanya sama sekali.

**Fitur:**
- Halaman baru **SDM/HR → Undang Karyawan Baru** — HR pilih Cabang, Posisi, Tipe Karyawan (default Training, karena ada auto-promosi ke Tetap setelah 3 bulan), dan Tanggal Bergabung, lalu dapat link sekali pakai (berlaku **1x24 jam**) untuk disalin & dikirim ke karyawan baru. Ada riwayat undangan (Menunggu Diisi / Sudah Dipakai / Dibatalkan) dengan tombol Salin Link dan Batalkan.
- Halaman publik baru **`/daftar-baru/[token]`** — karyawan baru buka link, lihat penempatannya (cabang & posisi, read-only), isi data pribadi lengkap (NIK, tanggal lahir, alamat, data bank, kontak darurat, dll — field yang sama dengan yang dipakai form Tambah Karyawan manual), dan buat password sendiri. Email login otomatis dibuat dari nama lengkapnya (format `nama@hammielion.com`).
- Link otomatis tidak bisa dipakai lagi setelah berhasil dipakai sekali, kadaluarsa setelah 1x24 jam, atau dibatalkan manual oleh HR — pesan errornya spesifik per kondisi.
- Kode karyawan (EMP-XXX) di-generate otomatis, sama seperti form Tambah Karyawan manual.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Tabel `employee_invites` (token, penempatan, status, kadaluarsa) |
| `app/api/invite/[token]/route.ts` (baru) | GET validasi+tampilkan penempatan, POST proses pendaftaran (buat baris employees + akun login) |
| `app/(dashboard)/karyawan/undang/page.tsx` (baru) | Halaman HR buat & kelola link undangan |
| `app/(auth)/daftar-baru/[token]/page.tsx` (baru) | Halaman publik karyawan baru isi data sendiri |
| `proxy.ts` | Tambah `/daftar-baru` dan `/api/invite` ke rute publik |
| `components/sidebar.tsx` | Menu "Undang Karyawan Baru" di grup SDM/HR |

---

### 119. Fitur: Wajib Isi Penuh 4/4 Sebelum Bisa Diajukan ke HR

**Konteks:** Owner minta pengajuan libur tidak lagi diproses satu-satu begitu dipilih — karyawan wajib mengisi tepat 4 dari 4 kuota liburnya dulu, baru bisa benar-benar diajukan ke HR sekaligus. Kalau belum genap 4, pengajuan tidak akan pernah sampai ke HR sama sekali.

**Fitur:**
- Tanggal yang dipilih karyawan sekarang masuk dulu sebagai **Draf** (badge abu-abu) — belum kelihatan sama sekali oleh HR, bisa dibatalkan/diganti bebas.
- Tombol baru **"Ajukan ke HR"** cuma aktif kalau sudah tepat 4/4 — begitu diklik, keempat tanggal draf dikirim sekaligus ke HR (status berubah jadi "Menunggu HR" bareng-bareng), baru di titik ini HR bisa melihat & memprosesnya di Persetujuan Libur.
- Diberlakukan lewat RLS (bukan cuma tampilan) — permintaan "ajukan" ke database ditolak kalau belum genap 4.
- Pengajuan yang sudah ada sebelumnya (misal punya Ridwan Maulana yang sudah 4/4 pending) tidak terganggu — aturan ini murni untuk alur baru ke depan.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Status baru `draft` di `roster_pick_requests`; RLS insert ganti syarat jadi `status='draft'`; RPC `submit_roster_picks` pindahkan draft→pending sekaligus HANYA kalau genap 4 |
| `app/(dashboard)/portal/ajukan-libur/page.tsx` | Alur pilih (draf) → tombol "Ajukan ke HR" terpisah, badge status Draf |
| `app/(dashboard)/absensi/persetujuan-libur/page.tsx` | Pastikan status `draft` tidak pernah ikut tampil ke HR |

---

### 120. Fitur: Wajib H-2 untuk Cuti Tahunan/Izin Pilihan, Otomatis Alpha Kalau Dadakan

**Konteks:** Diskusi dengan Owner soal "libur seenaknya" — ditemukan 3 sistem yang jalan sendiri-sendiri tanpa saling kenal: Jadwal/Roster (Ajukan Libur), Cuti & Izin (`leave_requests` — bisa diajukan untuk tanggal apa saja tanpa batas notice sama sekali), dan potongan gaji (menghitung izin/alpha tapi tidak peduli apakah direncanakan atau dadakan). Solusi yang disepakati: Cuti Tahunan dan Izin Periksa/Keperluan (jenis yang sifatnya BISA direncanakan) wajib diajukan minimal H-2 sebelum tanggal mulai — dihitung dari kapan pengajuan DIBUAT, bukan kapan HR memprosesnya. Sakit & Izin Duka Keluarga dikecualikan karena memang mendadak. Kalau tetap dipaksakan kurang dari H-2, begitu disetujui otomatis dicatat sebagai **Alpha (potongan 1.5x)**, bukan izin biasa (1x) — pengajuannya sendiri tidak diblokir, tapi konsekuensinya otomatis lebih mahal.

**Fitur:**
- Form **Ajukan Cuti/Izin** menampilkan peringatan jelas kalau tanggal yang dipilih kurang dari H-2 untuk jenis Cuti Tahunan/Izin Periksa-Keperluan, sebelum karyawan submit.
- Halaman admin **Cuti & Izin** menampilkan tanda peringatan yang sama di baris pengajuan yang masih pending, supaya HR tidak kaget kenapa nanti tercatat Alpha.
- `leave_requests.leave_type` yang tersimpan TIDAK diubah (tetap tercatat apa yang sebenarnya diajukan) — cuma status absensi hasil approval-nya yang jadi Alpha, supaya riwayat pengajuan tetap jujur untuk diaudit.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | RPC `approve_leave_request` — cek H-2 untuk `annual`/`permission`, catat `absent` (bukan `leave`/`permission`) kalau kurang dari itu |
| `app/(dashboard)/cuti/ajukan/page.tsx` | Peringatan H-2 di form pengajuan |
| `app/(dashboard)/cuti/page.tsx` | Tanda peringatan di daftar pengajuan pending untuk HR |

---

### 121. Rombak Total Aturan Potongan: Eskalasi Per Kejadian, Tarif Telat Universal, Cuti Tahunan Dibayar Penuh

**Konteks:** Lanjutan diskusi soal "libur seenaknya" — Owner tentukan aturan potongan baru yang lebih detail setelah melihat tabel aturan lama. Perubahan besar:

1. **Terlambat** — tarif per-karyawan dihapus total, diganti **1 tarif universal Rp1.000/menit** untuk semua staff (bukan driver/kenek yang sistem upahnya terpisah), diatur di satu tempat: Kelola Gaji Standar.
2. **Cuti Tahunan** — sekarang **tidak pernah dipotong sama sekali** dan **tidak lagi ikut kuota 4-hari/periode** — itu memang hak karyawan (dibatasi terpisah oleh jatah 12 hari/tahun yang sudah ada).
3. **Izin Duka + Izin Periksa/Keperluan + Sakit TANPA surat dokter** — digabung 1 kelompok, dihitung **per kejadian terpisah** (bukan per hari), reset tiap periode: kejadian ke-1 = 1×, ke-2 = 1.25×, ke-3 = 1.5×, ke-4 = 1.75×, ke-5 = 2× (mentok). Ini menutup celah "pura-pura sakit" untuk maksa libur berulang kali.
4. **Alpha** (termasuk hari kosong tanpa keterangan apa pun di luar kuota) — per kejadian juga, reset tiap periode: ke-1 = 1.5×, ke-2 = 2×, ke-3 = 2.25×, ke-4 = 2.5×, ke-5 = 2.75×, ke-6 = 3× (mentok).
5. **Sakit DENGAN surat dokter** — tidak berubah: hari ke-1 gratis, hari ke-2&3 = 0.5×, hari ke-4 dst = 1× (dihitung per hari berturut, bukan per kejadian) — status absensinya sekarang punya nilai sendiri (`sick_doc`) supaya bisa dibedakan dari sakit tanpa surat.

"1 kejadian" = 1 blok tanggal yang bersambung (kalau ada 2 pengajuan terpisah tapi tanggalnya kebetulan bersambung, disederhanakan jadi 1 kejadian).

**Fitur:**
- Halaman **Ajukan Cuti/Izin** menampilkan peringatan real-time: "Anda sudah punya N kejadian periode ini, kejadian berikutnya kena potongan X×" — supaya karyawan sadar konsekuensinya sebelum submit, sesuai permintaan Owner.
- Rincian potongan di Slip Gaji Bulanan (admin) sekarang menampilkan breakdown per-kejadian yang jelas: tanggal, urutan kejadian, dan pengalinya.
- Ranking/KPI ikut disesuaikan: hari kosong di luar kuota sekarang terhitung Alpha (bukan izin) untuk skor kedisiplinan juga.

| File | Perubahan |
|---|---|
| Migrasi DB (Supabase) | Nilai enum `attendance_status` baru `sick_doc`; `approve_leave_request` diperbarui; kolom `late_penalty_per_minute` pindah ke `salary_defaults`; RLS baca `salary_defaults` dibuka untuk semua karyawan |
| `lib/escalatingDeduction.ts` (baru) | Helper pengelompokan tanggal bersambung + kalkulasi potongan eskalasi, dipakai bersama beberapa halaman |
| `app/(dashboard)/penggajian/bulanan/page.tsx` | Rombak total kalkulasi potongan tidak hadir + tarif telat universal |
| `app/(dashboard)/penggajian/ringkasan/page.tsx` | Ikut rombak kalkulasi supaya konsisten dengan Slip Gaji Bulanan |
| `app/(dashboard)/portal/slip-gaji/page.tsx` | Tarif telat universal |
| `app/(dashboard)/penggajian/komponen/page.tsx` | Input tarif telat universal di Kelola Gaji Standar |
| `app/(dashboard)/penggajian/komponen/[employee_id]/page.tsx` | Input tarif telat per-karyawan dihapus |
| `app/(dashboard)/cuti/ajukan/page.tsx` | Peringatan real-time jumlah kejadian & pengali berikutnya |
| `app/(dashboard)/absensi/rekap/page.tsx`, `app/(dashboard)/portal/absensi/page.tsx`, `app/(dashboard)/ranking/page.tsx` | Dukungan status `sick_doc` + reklasifikasi hari kosong ke Alpha |

---

*Terakhir diupdate: Sesi 7 (2026-09-18 s/d 20) — fitur Lupa Password + fix 4 bug + redesain menu karyawan + undangan interview seragam + tutup akses data rekening + fix race condition cuti + panel filter pelamar + sort jarak & kesan tes + info lokasi training + tabel rekap konfirmasi interview + jalur kedua ke rekap + auto-advance status interview + form hasil interview + fix bug limit 1000 baris + peringatan pending + Saldo Real vs Proyeksi Cash Flow + rombak ledger Supplier + fix sticky header modal supplier + fitur Catatan Meeting + fix baris Kelola Pembelian + modal diperlebar & Aksi di tabel ledger + rombak sidebar 4 kelompok + hapus menu Laporan + tutup 2 jalur bocor Kas Keluar + approval wajib kasbon driver/kenek + fix RLS terbuka + fix /signup tidak bisa diakses + fitur Preview Tampilan Karyawan + penyempurnaan portal karyawan (keamanan RLS + fitur baru) + fitur tukar hari libur saat absen masuk + fitur Absen QR menggantikan sementara Absen HP GPS + fitur Daftar Cepat kode karyawan saja + fitur Perbarui Akun Saya (email standar + password mandiri) + Portal Saya untuk semua role + fix Absen QR gagal tersimpan + fix tombol Ambil Foto tidak berfungsi + fix layar kamera hitam + jalur cadangan kamera bawaan HP + fix Kode Karyawan case-sensitive + pesan error kamera lebih detail + fix macet di Menyiapkan Kamera + cetak QR 2 per halaman lebih besar + cetak QR 1/halaman & pilih cabang + verifikasi Daftar Cepat via nama+tanggal lahir + jalur cadangan Kode Karyawan saja + edit data pribadi sendiri di Profil Saya + lihat akun baru daftar di Manajemen User + upload foto profil sendiri + fix RLS foto karyawan terbuka + tampilkan email login di Profil Saya + karyawan bisa merangkap jabatan Driver + rombak verifikasi Sudah Jadi Karyawan tanpa Kode Karyawan + fix foto absen tidak muncul di mode Semua Karyawan + konfirmasi eksplisit absen masuk/pulang + pengaman jarak waktu absen + kartu Tidak Absen di dashboard + fitur Pengajuan Jadwal Libur Awal + fix kasbon driver/kenek tidak muncul di Verifikasi Keuangan + fitur Pengajuan Ganti Hari Libur dengan tukar mutual + fix bug edit keterlambatan tidak tersimpan + toleransi 5 menit absen QR + auto-promosi training ke staff tetap + gaji standar staff/Team Toko & tunjangan khusus + fix pengajuan jadwal libur awal tidak muncul di persetujuan + batas 1 hari weekend per periode untuk pengajuan libur + konfirmasi sebelum batalkan pengajuan libur + tombol Batalkan merah solid + fitur Undang Karyawan Baru via link sekali pakai + wajib isi penuh 4/4 sebelum diajukan ke HR + wajib H-2 cuti/izin pilihan otomatis Alpha kalau dadakan + rombak potongan eskalasi per kejadian & tarif telat universal*
