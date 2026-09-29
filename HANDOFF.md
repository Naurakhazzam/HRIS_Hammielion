# Catatan Serah Terima Sesi — HRIS Hammielion

> Ditulis untuk Claude di komputer lain (kantor) supaya tidak perlu menebak ulang apa yang
> sudah dikerjakan. Baca file ini dulu sebelum melanjutkan pekerjaan apapun di repo ini.
> Ditulis: 30 September 2026 (Asia/Jakarta).

## Ringkasan singkat

Sesi ini membangun 3 fitur besar (rombak total KPI, cadence Tugas Rutin, Target Penjualan
Promo + bonus per pcs), plus beberapa perbaikan bug nyata (batas lembur, dashboard karyawan).
Semua perubahan database (Supabase project `rwzerjfzazhpcnfktgax`) **sudah live**, diuji lewat
transaksi SQL sungguhan (`begin; ... rollback;`) sebelum dipakai di frontend. Kode frontend
**sebagian besar sudah di-commit & push**, tapi ada 1 batch terakhir yang **masih perlu
diverifikasi build + commit + push** (lihat bagian "Belum Selesai" di bawah — shell/terminal
sempat down transient di akhir sesi ini sebelum sempat dites `tsc`/`next build`/`git push`).

## 1. Rombak Total KPI (selesai, sudah live & di-push)

Sistem KPI lama (checklist harian per-jabatan) diganti total — semua tabel lama kosong (0 baris,
tidak pernah dipakai), jadi aman dihapus tanpa migrasi data.

- **Tabel baru**: `kpi_criteria` (+ `kpi_criteria_audiences`, target cabang/divisi/karyawan/semua
  — pola sama seperti Tugas Rutin), `kpi_manual_scores` (skor manual 1x/periode, ganti checklist
  harian), `kpi_evaluations` (rekap tersimpan per karyawan/periode, dipakai kunci bonus).
- **Dihapus**: `kpi_templates`, `kpi_daily_entries`, `kpi_scores`, `kpi_task_weight`.
- **4 sumber otomatis awal**: `task_completion` (Tugas Rutin), `punctuality`, `attendance`
  (kedisiplinan, sudah ada sebelum sesi ini), `manual`.
- **4 sumber otomatis tambahan** (dibangun setelah diskusi KPI umum retail):
  - `sales_target` — realisasi `fin_cash_in` (status approved) vs `branch_sales_targets`
    (target per cabang, sudah di-seed: Toko Pusat 500jt, Toko Depan 100jt, Raja Petshop 100jt,
    Markas Petshop 50jt — bisa diubah di `/kpi/setup`).
  - `stock_shrinkage` — data `loss_monthly_inputs` (fitur Kehilangan Barang yang SUDAH ADA
    sebelumnya) vs toleransi % dari target omset cabang (`kpi_criteria.threshold_value`).
  - `cash_variance` — `fin_cash_in.cash_adjustment` (selisih kas per transaksi) vs toleransi
    Rp/transaksi (`threshold_value`).
  - `rack_display` — ronde before-after Tugas Rutin tertentu (`kpi_criteria.linked_daily_task_template_id`)
    dibagi jatah rak (`branch_racks.rack_count` dibagi rata karyawan aktif cabang, sisa
    dibulatkan ke atas untuk sebagian orang, urutan nama).
  - `promo_sales` — lihat bagian 3 di bawah.
- **Formula blending**: `get_employee_kpi_breakdown()` return per-kriteria achievement%, lalu
  frontend/`save_kpi_evaluation()` hitung rata-rata berbobot HANYA dari kriteria yang punya data
  (achievement != null) — bobot kriteria yang belum ada datanya (skor manual belum diisi, dll)
  TIDAK ikut menyusutkan skor.
- **Frontend**: `/kpi` (dashboard + rincian per karyawan, input skor manual inline), `/kpi/setup`
  (kelola kriteria + kartu Target Omset per Cabang + kartu Jatah Rak per Cabang).
- **Catatan bonus KPI**: nominal bonus (`employees.kpi_bonus_max`) semua masih Rp0 sesuai
  permintaan awal user ("set dulu semua bonus KPI jadi 0, tapi persentasenya diaktifkan") — user
  belum mengisi nominal per karyawan.

## 2. Tugas Rutin: cadence + mode Tim (selesai, sudah live & di-push)

- `daily_tasks.task_type` → di-rename jadi `cadence` (`once`/`daily`/`weekly`/`monthly`).
- `assignment_mode` baru (`individual`/`team`) + tabel `daily_task_pics` (1 PIC per cabang,
  laporan PIC otomatis berlaku untuk seluruh tim di cabang itu).
- Multi-ronde before/after per hari (misal "bersihkan 5 rak" = 5 ronde before-after dalam 1
  bucket periode) — index unik lama diganti partial index (cuma 1 ronde `before_only` yang
  boleh menggantung per employee+task).
- RPC berubah nama field: `work_days/done_days/today_phase/today_done_count` →
  `total_buckets/done_buckets/current_phase/current_done_count` (field `once_phase`/
  `once_done_count`/`has_logged_once` untuk tugas cadence `once` TIDAK berubah).
- Frontend `/tugas-harian` + `components/dailyTasks/*` sudah disesuaikan penuh.

## 3. Target Penjualan Promo + Bonus per Pcs (kode sudah ditulis, BELUM diverifikasi build/push — lihat "Belum Selesai")

Tab baru `/penjualan-promo`. Alur: HR/Owner bikin target qty per cabang+produk+periode (opsional
+ tarif bonus per pcs), karyawan cabang itu lapor qty terjual + foto struk (banyak karyawan bisa
lapor untuk produk yang sama, saling menjumlah — target milik CABANG, bukan per orang).

**Alur validasi (PENTING, beda dari desain awal)**: awalnya laporan langsung dihitung begitu
dikirim (cuma bisa "ditandai tidak valid" belakangan). User lalu minta alur klaim yang benar:
laporan masuk status **pending** dulu, HARUS di-approve Owner/HR/**Finance** (role baru yang
boleh review) baru dihitung ke progres/KPI/bonus. Kolom `is_invalid`/`invalid_reason` diganti
`status` (`pending`/`approved`/`rejected`) + `rejection_reason`.

**Bonus per pcs** (fitur terakhir yang diminta): tiap produk promo punya 2 tarif opsional —
`bonus_rate_reached` (Rp/pcs kalau total qty APPROVED cabang >= target) dan `bonus_rate_below`
(Rp/pcs kalau di bawah target). Berlaku ke SEMUA pcs (bukan cuma kelebihannya). Dihitung PER
KARYAWAN dari qty approved milik dia sendiri (bukan dibagi rata pool cabang) — dikonfirmasi user
lewat AskUserQuestion. Fungsi `get_employee_promo_bonus()`.

**Sinkron ke payroll**: kolom baru `payrolls.promo_bonus`. RPC `sync_promo_bonus_to_payroll()`
(owner/hr/finance) — idempotent, HANYA jalan kalau ada slip gaji `status='draft'` untuk
karyawan+periode itu, dan SEKALIAN menghitung ulang `gross_total`/`net_total` dari semua kolom
bonus yang ada di baris payroll itu (base+tunjangan+overtime+kpi_bonus+loyalitas_auto_release+
libur_compensation+conditional_bonus+extra_bonus_total+promo_bonus, dikurangi semua deduction
untuk net — floor di 0). Ini LEBIH BAIK dari pola `kpi_bonus` lama yang cuma nulis 1 kolom tanpa
recompute gross/net (jadi kalau nanti mau, `kpi_bonus` sync sebaiknya juga dirapikan supaya
konsisten — belum dilakukan sesi ini, di luar scope).

`penggajian/bulanan/page.tsx` diupdate: field `promo_bonus` ditambahkan ke type, select query,
KEDUA formula `newGross` (baris ~1717 & ~1771 — untuk handler Bonus Kondisional & Bonus
Tambahan supaya promo_bonus yang sudah tersinkron tidak ketimpa/hilang saat Finance recompute
gross lewat 2 modal itu), dan ditambahkan sebagai baris "Bonus Promo" di struk HTML (~1930) &
daftar PDF/export (~2698) -- SENGAJA TIDAK ditambahkan sebagai kolom baru di tabel utama
on-screen (cuma "Bonus KPI" yang punya kolom sendiri; Bonus Kondisional/Tambahan juga tidak
punya kolom sendiri, jadi konsisten). `portal/slip-gaji/page.tsx` juga diupdate serupa (type,
select, baris tabel).

RLS: role `finance` sekarang boleh baca+approve/reject `promo_sales_reports` dan panggil
`sync_promo_bonus_to_payroll`/`get_promo_sales_admin`/`get_promo_sales_reports` (sebelumnya
cuma owner/hr). Target/produk (`save_promo_product`) tetap owner/hr saja.

## 4. Bug nyata yang ditemukan & diperbaiki

- **Batas lembur maks 3 jam/hari**: sebelumnya `calc_attendance_times()` (trigger di tabel
  `attendances`) TIDAK punya batas maksimal sama sekali — selisih jam pulang aktual vs jadwal
  langsung jadi `overtime_hours` tanpa cap. Ditemukan lewat kasus Rahmat Saleh (29 Sep: pulang
  22:06 WIB vs jadwal 18:00 → tercatat 4 jam lembur). Trigger diperbaiki (`LEAST(3, ...)`),
  berlaku SEMUA karyawan tanpa kecuali (dikonfirmasi user). Backfill data yang sudah tercatat >3
  jam untuk periode 26 Agu - 25 Okt 2026 (periode gajian September & Oktober — aman, belum ada
  yang tervalidasi/diklaim/dibayar). Input edit manual absensi di `absensi/rekap/page.tsx` juga
  dibatasi `max="3"` di client (HR override).
- **Dashboard karyawan tidak ada estimasi pendapatan bulan berjalan**: sebelumnya cuma ada
  "Rincian Pendapatan" (slip gaji TERAKHIR yang sudah final, bisa bulan lalu) dan "Perkiraan
  Potongan Bulan Ini" (live) — tidak ada sisi pendapatan yang live. Ditambahkan kartu baru
  "💰 Perkiraan Pendapatan Bulan Ini" di `portal/page.tsx` (gaji pokok+tunjangan dari
  `salary_components` aktif + lembur yang sudah approved bulan berjalan; bonus sengaja tidak
  diikutkan, baru final saat Finance proses slip).

## 5. Audit menyeluruh yang sudah dilakukan

`tsc --noEmit` bersih + `next build` PENUH (101 route, semua sukses) dilakukan SETELAH fitur KPI
rebuild + Tugas Rutin cadence + Target Penjualan Promo versi awal (sebelum bonus per pcs) —
tidak ada kode rusak/terputus ditemukan. Di-grep juga untuk memastikan tidak ada referensi basi
ke nama kolom/tabel lama (`task_type` lama, `work_days`/`today_phase`/`today_done_count`,
`kpi_templates`/`kpi_daily_entries`/`kpi_scores`/`kpi_task_weight`, `monthly_payrolls`) — semua
bersih.

## Status akhir sesi: SEMUA SUDAH SELESAI & DI-PUSH

Update: sempat ada gangguan transient di shell/terminal sebelum verifikasi akhir batch bonus per
pcs, tapi sudah pulih dan semuanya sudah dituntaskan di sesi yang sama:

1. `npx tsc --noEmit` — bersih.
2. `npx next build` penuh (semua route, termasuk `/penjualan-promo`, `/kpi`, `/penggajian/bulanan`,
   `/portal/slip-gaji`) — sukses semua.
3. Verifikasi end-to-end via transaksi SQL rollback: buat produk promo dengan tarif bonus, submit
   laporan (105 qty), approve, sync ke payroll draft → `promo_bonus=105000`, `gross_total` &
   `net_total` naik dari 3.000.000 → 3.105.000 dengan benar.
4. Commit & push — sudah dilakukan untuk semua file (`penjualan-promo/page.tsx`,
   `penggajian/bulanan/page.tsx`, `portal/slip-gaji/page.tsx`, `HANDOFF.md` ini sendiri).

**Kalau membaca ini setelah `git pull`, berarti tidak ada pekerjaan kode yang tertunda dari sesi
ini.** Yang tersisa murni tugas MANUAL untuk user (lihat bagian di bawah), bukan tugas coding.

## Item yang masih dijanjikan ke user tapi belum dikerjakan sama sekali

- **Kondisi Mobil Mingguan** & **checklist SOP (Buka/Tutup Toko)** — user sudah setuju
  pendekatannya (pecah jadi Tugas Rutin checklist + skor manual sidak untuk sisanya), tapi belum
  ada satupun Tugas Rutin/kriteria KPI yang benar-benar dibuat untuk ini. Tidak butuh fitur baru,
  tinggal dibuat lewat UI yang sudah ada (`/tugas-harian` lalu daftarkan sebagai kriteria KPI
  `task_completion` di `/kpi/setup`).
- **Penjualan Produk Promo per-produk tracking** sudah selesai (lihat bagian 3) — tapi user
  awalnya menyebut ini sebagai "tab khusus" yang terpisah dari KPI; sudah terwujud di
  `/penjualan-promo`.
- User belum mengisi: `branch_racks` (jatah rak per cabang, perlu diisi manual di `/kpi/setup`
  sebelum kriteria `rack_display` bisa jalan), `employees.kpi_bonus_max` (nominal bonus KPI
  masih 0 semua), belum ada kriteria KPI yang benar-benar dibuat (tabel `kpi_criteria` kemungkinan
  masih kosong di produksi — semua pengetesan sesi ini pakai transaksi `rollback`, TIDAK
  meninggalkan data sungguhan).

## Konteks bisnis penting yang perlu diingat

- Owner: Fauzan Rahman (fauzan.rahman@hammielion.com, role `owner`). Bahasa: Indonesia informal.
- Periode gajian: 26 bulan lalu s/d 25 bulan ini ("26-25"), bukan kalender bulan biasa (kecuali
  beberapa kartu dashboard lama yang sengaja pakai kalender bulan untuk kesederhanaan — lihat
  komentar di kode).
- Proyek Supabase: `rwzerjfzazhpcnfktgax`. Vercel: hris-hammielion.vercel.app. Repo GitHub:
  `Naurakhazzam/HRIS_Hammielion`, branch `main`.
- Konvensi: commit & push SEGERA setelah tiap perubahan selesai diuji (jangan menumpuk banyak
  perubahan belum di-commit) — sempat dilanggar di sesi ini karena banyak fitur besar berurutan,
  tapi tetap diusahakan commit per-fitur, bukan 1 commit raksasa di akhir.
