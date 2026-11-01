# Aturan Penggajian Staff

Satu sumber aturan tertulis untuk slip gaji staff (permanent & training). Rumusnya ada di kode:

| Bagian | Kode |
|---|---|
| Potongan tidak hadir, jatah libur, kompensasi libur | `lib/payrollAbsence.ts` → `calcAbsence()` |
| Tabel pengali eskalasi, tanggal aturan baru | `lib/escalatingDeduction.ts` |
| Toleransi telat absen QR | `lib/lateTolerance.ts` |
| Gaji bersih | `calcNet()` di `app/(dashboard)/penggajian/bulanan/page.tsx` dan `recalc_payroll_totals()` di DB |

**Kalau aturan berubah, ubah dokumen ini dan kodenya bersamaan.** Halaman lain (Ringkasan Gaji,
Aturan Potongan, estimasi di Portal) tidak boleh menulis ulang rumusnya. Mereka memanggil
`calcAbsence()` atau membaca snapshot slip.

---

## 1. Periode & dasar hitung

- Periode gaji: **tanggal 26 bulan lalu – tanggal 25 bulan ini**.
- Komponen gaji yang dipakai adalah yang **berlaku di periode itu**: `effective_date` ≤ tanggal 25
  akhir periode. Kenaikan gaji yang berlaku mulai periode depan tidak ikut ke slip ini.
- **Gaji harian** = (gaji pokok + tunj. jabatan + tunj. tetap + tunj. khusus) ÷ 26, dari komponen
  **penuh**. Pro-rata training tidak mengubah harga 1 hari.
- **Pro-rata** hanya untuk karyawan **training** yang join di tengah periode: gaji pokok &
  tunjangan × (hari aktif ÷ hari periode). Jatah libur ikut di-pro-rata. Bonus tidak di-pro-rata.
- Hari **sebelum tanggal join** dan hari yang **belum terjadi** tidak dihitung sama sekali.
- Karyawan **gaji flat** (`flat_salary`): gaji pokok apa adanya. Tanpa lembur, telat, potongan
  tidak hadir, kompensasi libur, kehilangan barang/kasir, maupun bonus.

## 2. Jatah libur 4 hari per periode

Jatah dipakai **berurutan** (yang lebih dulu menghabiskan jatah):

1. **Libur terjadwal** (`employee_roster.is_day_off`) yang tidak dimasuki kerja.
2. **Cuti** (status `leave`).
3. **Izin / sakit tanpa surat / sakit dengan surat**, digabung satu antrean dari tanggal paling awal.
4. **Hari kosong** (tidak ada absen, bukan libur terjadwal).

Aturan tambahan:

- Hari yang masuk jatah **tidak dipotong**.
- **Alpha** dan **Izin Mendadak** tidak pernah mengisi jatah.
- Libur terjadwal **selalu gratis**, walau melebihi jatah (sudah disetujui HR). Kalau di tanggal
  itu tercatat izin/sakit/alpha, tetap dianggap libur.
- Masuk kerja di hari libur terjadwal = bukan libur. Jatahnya tidak terpakai.
- **Kompensasi libur**: sisa jatah yang tidak terpakai × gaji harian, dibayar di Pendapatan.
  Tidak berlaku untuk karyawan dengan `libur_compensation_applicable = false`.

## 3. Potongan tidak hadir (di luar jatah)

Untuk karyawan permanent, periode yang berakhir **mulai 26 Sep 2026**:

| Jenis | Cara hitung |
|---|---|
| Izin / Sakit tanpa surat | Eskalasi per hari, berlanjut lintas kejadian dalam periode: 1× → 1,25× → 1,5× → 1,75× → maks 2× |
| Alpha (eksplisit + hari kosong di luar jatah) | 1,5× → 2× → 2,25× → 2,5× → 2,75× → maks 3× |
| Izin Mendadak (tanpa H-2) | 1,25× → 1,5× → 1,6× → 1,7× → 1,8× → 1,9× → maks 2× |
| Sakit dengan surat | Hari ke-1 gratis, ke-2 & 3 = 0,5×, ke-4 dst = 1× |
| Lupa Absen Masuk / Pulang | Denda tetap Rp15.000 / Rp5.000 per kejadian (`attendances.admin_fee`) |
| Telat ajukan libur | Rp10.000 per tanggal, hanya untuk libur yang **disetujui** atau **disetujui lalu dipindah**. Pending & ditolak tidak didenda. |

- Eskalasi direset setiap periode baru.
- **Training**: Izin / Alpha / Izin Mendadak **flat 1×**, tanpa eskalasi.
- **Periode lama** (berakhir sebelum 26 Sep 2026): flat 1× dan tanpa denda Lupa Absen.
- Sakit dengan surat memakai tarif yang sama untuk semua periode.

## 4. Telat & lembur

- Telat = menit × tarif universal (`salary_defaults.late_penalty_per_minute`).
- *(Internal, tidak ditampilkan ke karyawan)* Absen QR: telat ≤ 5 menit tidak dipotong. Toleransi
  yang sama dipakai KPI Tepat Waktu.
- Klarifikasi telat > 30 menit yang disetujui HR → `late_minutes` hari itu jadi 0 (gaji & KPI).
- Lembur hanya dari hari yang divalidasi di checklist slip (cocok surat lembur ter-ACC), jam
  dibulatkan ke bawah per jam penuh.
- Dikecualikan per karyawan lewat `overtime_applicable` / `late_penalty_applicable`.

## 5. Tabungan Loyalitas

- Setiap bulan dipotong `loyalitas_per_month` (baris Potongan "Tabungan Loyalitas").
- Bulan pencairan = bulan tabungan ke-N (N = `loyalitas_duration_months`). Di bulan itu:
  - Tabungan bulan itu **tetap dipotong**.
  - **Seluruh** tabungan (saldo lama + bulan itu = N × nominal) dicairkan di Pendapatan.
- Siklus baru dimulai dari potongan **bulan berikutnya**, jadi setiap siklus tepat N bulan.

## 6. KPI vs potongan gaji

Telat & tidak hadir memengaruhi dua hal yang **berbeda tujuan**. Ini disengaja, bukan potongan dobel:

- **Potongan gaji**: mengganti waktu kerja yang hilang (aturan di atas).
- **KPI Tepat Waktu / Kehadiran**: menilai kedisiplinan, menentukan besar Bonus KPI. Libur
  terjadwal tidak dihitung hari wajib kerja. Sakit dengan surat & cuti dianggap hadir.

Hal ini ditulis terbuka di Panduan Karyawan bagian 12.

## 7. Snapshot slip

Saat slip dibuat, rincian potongan tidak hadir & pemakaian jatah libur disimpan di
`payrolls.absent_breakdown`. Detail slip, slip cetak, dan Ringkasan Gaji membaca snapshot ini,
jadi rincian selalu sama dengan yang dipotong walau absensi/gaji diedit belakangan. Slip lama
(sebelum migrasi 109) tidak punya snapshot dan dihitung ulang dengan rumus yang sama.

## 8. Estimasi di Portal karyawan

Estimasi saldo berjalan memakai `calcAbsence()` dengan `applyQuota: false`:

- **Tanpa** jatah 4 hari: izin langsung dipotong, hari kosong langsung Alpha.
- Libur terjadwal & cuti tetap gratis.
- Sengaja lebih konservatif dari slip asli, karena jatah baru bisa dinilai di akhir periode.
