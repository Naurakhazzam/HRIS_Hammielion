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

---

*Terakhir diupdate: Sesi 3 (2026-09-01)*
