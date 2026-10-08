# Rencana: Pengiriman Multi-Cabang & Jemput Grooming

Dokumen kerja untuk dikerjakan **per fase di sesi chat terpisah**. Cara pakai:

> Baca `hris-app/docs/RENCANA-PENGIRIMAN-GROOMING.md`, kerjakan Fase N.

Setiap fase selesai: centang checklist di bagian **Status**, catat nomor migrasi & commit, lalu
push (user selalu tes di app yang sudah di-deploy, bukan localhost).

Bahasa ke user: **Bahasa Indonesia**.

---

## Status

- [x] **Fase 0** — Kirim Barang Toko Pusat (sudah live, commit `2f926d9`, migrasi `067_toko_pusat_self_delivery.sql`)
- [x] **Fase 1** — Kiriman barang multi-cabang (migrasi `068_multi_branch_delivery.sql`, commit `330e0db`)
- [x] **Fase 2** — Master Toko: label Toko/Pelanggan, nomor HP, pengaturan cabang grooming (migrasi `069_store_kind_grooming_branches.sql`, commit `d7ea5cf`)
- [x] **Fase 3** — Order grooming (buat order, status grooming, ganti groomer, paksa lanjut) (migrasi `070_grooming_orders.sql`, commit `2a9355a`)
- [x] **Fase 4** — Perjalanan jemput & antar grooming (migrasi `071_grooming_trips.sql`, commit `2052af5`)
- [x] **Fase 5** — Bonus grooming + slip gaji + penutupan lapor manual (migrasi `072_grooming_bonus.sql`, commit `bca03d0`)
- [x] **Tambahan** — Kirim pesanan konsumen lewat Laporan Muat. Master Toko satu sumber untuk Toko &
  Pelanggan, dan **pelanggan boleh lewat semua jalur** (Antar Sendiri, Driver Gudang, Rencana
  Pengiriman). Pengaman jenis dari 069/077 dicabut (migrasi `077_pelanggan_antar_sendiri.sql`,
  `079_pelanggan_semua_jalur.sql`). Jenis kini hanya membedakan aturan No. HP. Tugas Ambil Retur
  tetap khusus Toko. Jeda foto trip 5 → 2 menit (migrasi `078_jeda_foto_kirim_2_menit.sql`).

---

## 0. Kondisi yang SUDAH ADA (Fase 0)

Baca dulu sebelum mengubah apa pun:

- `database/migrations/067_toko_pusat_self_delivery.sql` — sumber kebenaran logika DB.
- `hris-app/app/(dashboard)/logistik/laporan-muat/page.tsx` — buat Laporan Muat, Tandai Selesai
  (pilih jalur driver / toko_pusat + ongkir), pindah jalur, ubah ongkir, tambah toko baru.
- `hris-app/app/(dashboard)/logistik/kirim-barang/page.tsx` — menu Kirim Barang (alur 3 foto,
  riwayat, rekap per karyawan, tutup paksa & alihkan PJ oleh Owner).
- `hris-app/app/(dashboard)/logistik/jemput-toko-pusat/page.tsx` — halaman driver (sudah filter
  `delivery_method = 'driver'`).
- `hris-app/components/sidebar.tsx` — menu + badge (`get_tp_delivery_badge_count`,
  `get_central_pickup_badge_count`, event `kirim-barang-badge-refresh`).
- `hris-app/components/LogisticsCameraCapture.tsx` — prop `maxFileAgeMs` (tolak foto galeri lewat
  jalur kamera bawaan HP).
- Payroll: kolom `payrolls.ongkir_bonus`, `get_employee_ongkir_bonus`, `resync_ongkir_bonus_payroll`
  (auto-sinkron ke slip **draft**), baris "Bonus Ongkir" di `penggajian/bulanan` & `portal/slip-gaji`.

### Struktur DB saat ini
- `logistics_central_loadings` + kolom `delivery_method ('driver'|'toko_pusat')`, `ongkir`,
  `ongkir_set_by`, `ongkir_set_at`.
- `logistics_ongkir_changes` — jejak perubahan ongkir.
- `logistics_tp_trips` — trip (PJ, foto 1 ambil, foto 3 kembali, depart/return_minutes, alasan,
  batal, tutup paksa, alihkan PJ). Status: `berjalan|selesai|batal|tutup_paksa`.
- `logistics_tp_trip_stops` — 1 baris per kiriman di trip (foto 2 sampai, `arrival_order`, dilepas).
- RPC: `finish_central_loading`, `set_central_loading_method`, `set_central_loading_ongkir`,
  `quick_create_logistics_store`, `start_tp_trip`, `arrive_tp_stop`, `finish_tp_trip`,
  `release_tp_stop`, `cancel_tp_trip`, `force_close_tp_trip`, `reassign_tp_trip`,
  `tp_trip_last_event_at`, `payroll_period_of`.
- Semua tulis ke tabel trip **lewat RPC** (RLS tabel trip cuma SELECT).

### Aturan yang SUDAH berlaku (pertahankan di semua fase)
- Semua waktu dari **jam server** (`now()`), bukan jam HP.
- Tiap tahap foto **minimal 2 menit** dari foto sebelumnya (dulu 5 menit; diubah di migrasi `078`).
  Foto selesai grooming tetap ≥ 5 menit sejak kucing sampai.
- |lama berangkat − lama kembali| **≥ 20 menit → alasan wajib** (macet, bensin, istirahat,
  menunggu_toko, tugas_lain*, lainnya* — *wajib keterangan).
- PJ tidak bisa ambil trip baru sebelum foto kembali.
- Batal antar / lepas toko hanya sebelum toko itu difoto sampai.
- **Tutup Paksa & Alihkan PJ: Owner saja.** Trip tutup paksa **tidak dapat bonus**.
- Peringatan trip > **6 jam** tanpa foto → merah + masuk badge Owner.
- Bonus ongkir **50%** (dibulatkan ke bawah), hanya trip **selesai normal**. Periode gaji
  **26 bulan lalu – 25 bulan ini (WIB)**.
- Kamera: wajib kamera langsung; jalur cadangan menolak file > 2 menit (`maxFileAgeMs`).
- Pengisi ongkir **boleh** jadi PJ (kecurangan ketahuan saat settlement kasir; ongkir terkunci
  setelah foto 1, perubahan setelahnya hanya Owner dan tercatat).

---

## Data cabang & orang (per 7 Okt 2026)

| Sebutan user | Nama di `branches` | Grooming? |
|---|---|---|
| Toko Pusat | `Toko Pusat` | Ya (mengerjakan) |
| Toko Raja | `Raja Petshop` | Ya (mengerjakan) |
| Toko Depan | `Toko Depan` | Terima order, dikerjakan **Toko Pusat** |
| Toko Markas | `Markas Petshop` | Terima order, dikerjakan **Raja Petshop** |

- Groomer terdaftar di produk promo "Grooming Kucing": **Rahmat Saleh** (Toko Pusat, Groomer) dan
  **Fikri Mulyana** (Raja Petshop, Kasir).
- **Elan Suherlan**: Back Office / Owner, **tidak punya akun aplikasi**, harus selalu muncul di
  pilihan groomer, **dapat bonus** grooming (catatan terpisah → slip gajinya).
- Master Toko (`logistics_stores`): 268 baris, 174 tanpa nomor HP.
- Produk promo "Grooming Kucing" (Okt 2026): bonus 10% × harga, harga pilihan
  40rb/50rb/55rb/75rb/100rb, `max_late_days = 2`, cabang Toko Pusat (target 80) & Raja (target 60).

---

## FASE 1 — Kiriman barang multi-cabang

### Keputusan
1. Berlaku untuk 4 cabang: Toko Pusat, Toko Depan, Markas Petshop, Raja Petshop.
2. Pembuat kiriman **wajib memilih nama pengantar** (boleh **lintas cabang**). Tugas hanya
   tampil (dan menyalakan badge) di orang itu. Pengantar pasti punya akun aplikasi → pilihan
   pengantar hanya karyawan aktif yang punya baris di `users`.
3. **Ganti Penerima Tugas**: pembuat kiriman atau rekan **satu cabang pembuat**, alasan wajib,
   hanya **sebelum foto 1**. Setelah foto 1 → Owner saja (`reassign_tp_trip` yang sudah ada).
4. Opsi driver diberi label **"🚚 Diantar Driver Gudang"**, berlaku semua cabang.
5. Tiap cabang hanya melihat kiriman cabangnya. Pengecualian: pengantar yang ditugaskan (lintas
   cabang) melihat tugasnya; Owner/Kepala Gudang/HR/Finance melihat semua.

### Perubahan DB (migrasi baru, nomor berikutnya setelah yang terakhir di `database/migrations`)
- Konstanta cabang toko: buat helper `is_store_branch(branch_name)` atau tabel kecil
  `logistics_store_branches(branch_id, can_groom, groom_branch_id)` — **lebih baik tabel** karena
  Fase 2 butuh pengaturan cabang grooming juga (lihat Fase 2; boleh dibuat di Fase 1 dengan kolom
  grooming dibiarkan untuk Fase 2).
- `logistics_central_loadings`: tambah `origin_branch_id` (backfill = Toko Pusat), `assigned_to`
  (employee, wajib untuk jalur `toko_pusat` — pertimbangkan rename nilai `toko_pusat` →
  `antar_sendiri`; kalau rename, update SEMUA RPC & UI yang memakai string itu).
- Tabel jejak `logistics_assignment_changes(loading_id, old_emp, new_emp, changed_by, reason, at)`.
- Helper baru `is_store_branch_staff()` (karyawan aktif di salah satu cabang toko, atau owner)
  menggantikan `is_toko_pusat_or_owner()` di RLS/RPC Laporan Muat & Kirim Barang.
- RLS baca `logistics_central_loadings` & turunannya: cabang sendiri **atau** `assigned_to = saya`
  **atau** pengantar di trip **atau** owner/kepala gudang/hr/finance **atau** driver (hanya jalur
  driver). Hati-hati: driver tetap perlu baca kiriman jalur driver dari cabang mana pun.
- `finish_central_loading(p_loading_id, p_method, p_ongkir, p_assigned_to)` — wajib
  `p_assigned_to` untuk antar sendiri; validasi orang aktif + punya akun.
- RPC baru `reassign_loading_before_pickup(p_loading_id, p_new_emp, p_reason)`.
- `start_tp_trip`: hanya kiriman dengan `assigned_to = saya`; hapus syarat "harus karyawan Toko
  Pusat" (ganti: karyawan aktif yang ditugaskan).
- `finish_tp_trip`: foto 3 = **kembali ke cabang asal PJ** (teks UI), logika waktu tetap.
- Badge `get_tp_delivery_badge_count`: hitung kiriman `assigned_to = saya` yang belum diambil +
  trip saya berjalan (+ Owner: trip > 6 jam). Jangan lagi hitung semua kiriman cabang.
- `get_central_pickup_badge_count`: tetap (jalur driver, semua cabang).
- `quick_create_logistics_store`: izinkan staf 4 cabang (bukan cuma Toko Pusat).

### Perubahan UI
- Sidebar: menu Laporan Muat & Kirim Barang tampil untuk staf 4 cabang (bukan cuma
  `isTokoPusat`). Ganti `isTokoPusat` → `isStoreBranchStaff` (cek dari tabel cabang toko / daftar).
- Halaman driver: ganti judul & menu **"Jemput Toko Pusat" → "Jemput Barang Cabang"**, tampilkan
  **cabang asal** (lokasi ambil) per paket. Route boleh tetap `/logistik/jemput-toko-pusat`.
- Laporan Muat: teks "Toko Pusat" → nama cabang asal; Tandai Selesai jalur antar sendiri wajib
  pilih pengantar (dropdown dicari, tampil nama + cabang); tombol **Ganti Penerima Tugas**.
- Kirim Barang: "Menunggu Diambil" hanya kiriman `assigned_to = saya` (checkbox ambil sekaligus
  tetap); Owner melihat semua. Teks foto 3: "Kembali di [cabang asal]".
- `penerimaan-retur` juga masih hard-code Toko Pusat — **jangan diubah** di fase ini (di luar scope).

### Tes (wajib, simulasi DB dalam `DO $$ ... RAISE EXCEPTION 'RESULT ...' $$` agar ter-rollback)
- Staf Toko Depan buat kiriman, tugaskan ke staf Toko Pusat → hanya staf itu yang lihat & bisa foto 1.
- Staf lain (cabang sama/beda) tidak bisa `start_tp_trip` kiriman itu.
- Ganti penerima sebelum foto 1 oleh rekan satu cabang → sukses; setelah foto 1 → ditolak.
- Driver tidak melihat kiriman antar sendiri; melihat jalur Driver Gudang dari semua cabang.
- Staf Markas tidak melihat Laporan Muat Toko Pusat.

### Hasil Fase 1 (sudah live) — yang perlu diketahui fase berikutnya
- Nilai jalur **sudah di-rename** `toko_pusat` → `antar_sendiri` (DB, RPC, UI).
- Tabel `logistics_store_branches(branch_id, can_groom, groom_branch_id)` sudah ada, isi 4 cabang;
  kolom grooming masih default (diisi di Fase 2). RLS: baca semua, tulis Owner.
- `logistics_central_loadings`: `origin_branch_id` (NOT NULL, diisi trigger dari cabang pembuat;
  Owner kirim sendiri), `assigned_to`, `assigned_at`. Constraint: `antar_sendiri` + `selesai` wajib
  `assigned_to`. Update langsung dari klien **hanya** kolom `status/cancelled_by/cancelled_at`
  (column grant) dan hanya untuk membatalkan; sisanya lewat RPC.
- Helper: `is_store_branch_staff()`, `is_logistics_overseer()` (owner/kepala gudang/hr/finance),
  `can_manage_branch_loading(branch)`, `is_valid_delivery_assignee(emp)`,
  `list_store_delivery_candidates()` (RPC dropdown pengantar), `can_read_central_loading(id)`,
  `can_read_tp_trip(id)`, `is_my_tp_loading(id)`.
- **Jebakan RLS**: policy SELECT tabel induk jangan pakai fungsi lookup-by-id (baris hasil INSERT
  belum terlihat → `insert().select()` gagal). Pakai kolom langsung; fungsi by-id hanya utk tabel anak.
- RPC baru `reassign_loading_before_pickup`; `finish_central_loading` & `set_central_loading_method`
  sekarang 4 argumen (`p_assigned_to`). `reassign_tp_trip` ikut memindah `assigned_to` stop yang
  belum sampai + catat jejak. Jejak di `logistics_assignment_changes` (penugasan awal: old NULL).
- Pengantar dibatasi ke karyawan aktif **4 cabang toko** yang punya akun (supaya menu Kirim Barang
  pasti tampil di dia).
- UI: komponen `components/DeliveryAssigneePicker.tsx` (cari nama + cabang) — pakai ulang di Fase 3/4.
- `is_toko_pusat_or_owner()` masih dipakai Penerimaan Retur (sengaja tidak diubah).

---

## FASE 2 — Master Toko & pengaturan cabang grooming

### Keputusan
- Pelanggan grooming disimpan di **tabel yang sama** dengan Master Toko (`logistics_stores`),
  diberi label **jenis: `toko` | `pelanggan`**. Data lama = `toko`.
- Rencana Pengiriman driver (dan pilihan toko lain milik gudang) hanya menampilkan `toko`.
  Order grooming bisa pilih keduanya.
- **Nomor HP wajib** saat dipakai di order grooming: kalau pelanggan yang dipilih belum punya
  nomor → wajib diisi dulu (tersimpan ke Master Toko). Nomor dinormalisasi (08xx / 62xx → satu
  format) dan **unik** → mencegah pelanggan dobel.
- Pengaturan cabang grooming (Owner bisa ubah): cabang mana yang **mengerjakan** grooming dan
  cabang penerima order dikerjakan oleh cabang mana:
  Toko Pusat→Toko Pusat, Raja→Raja, Toko Depan→Toko Pusat, Markas→Raja.

### Perubahan
- `logistics_stores`: kolom `kind text default 'toko' check in ('toko','pelanggan')`,
  `phone_normalized` + unique partial index (where not null).
- Tabel `logistics_store_branches` (dari Fase 1) kolom `can_groom bool`, `groom_branch_id uuid`.
- Halaman `logistik/toko` (Master Toko): filter & kolom jenis, edit nomor; halaman pengaturan
  cabang grooming (Owner) — boleh di Master Toko sebagai tab.
- Cek semua query `logistics_stores` di halaman driver/rencana (`grep logistics_stores`) → tambah
  filter `kind = 'toko'` di pilihan toko pengiriman.

### Hasil Fase 2 (sudah live) — yang perlu diketahui fase berikutnya
- `logistics_stores.kind ('toko'|'pelanggan')`, `phone_normalized` (kolom generated dari
  `normalize_phone_id(phone)`: +62/62/8xx → 08xx). Nomor yang diisi/diubah **disimpan** dalam
  format 08xx oleh trigger `guard_logistics_store_phone` (validasi `^0[0-9]{8,13}$`).
- **Unik hanya antar pelanggan** (`logistics_stores_pelanggan_phone_uniq`), bukan semua baris:
  beberapa toko sah berbagi nomor pemilik (Sulung Ps ×3, Koinami/Milan). Pelanggan **wajib** nomor.
  Nama pelanggan boleh sama (dibedakan nomor).
- Trigger `guard_store_kind_toko` menolak pelanggan di `logistics_plan_stores` &
  `logistics_central_loadings`. UI Rencana & Laporan Muat filter `kind = 'toko'`.
- `quick_create_logistics_store(p_name, p_address, p_phone, p_kind default 'toko')` — untuk
  pelanggan: nomor wajib, alamat opsional, cek dobel lewat nomor (bukan nama).
- RPC `set_logistics_store_phone(p_store_id, p_phone)` → staf 4 cabang boleh isi nomor yang
  **kosong**; ganti nomor yang sudah ada hanya Kepala Gudang/Owner. Dipakai order grooming (Fase 3).
- `logistics_store_branches` terisi: Pusat & Raja `can_groom`; Depan→Pusat, Markas→Raja.
  Tulis **hanya** lewat RPC `save_grooming_branch_settings(p_rows jsonb)` (Owner; validasi lintas
  baris). Helper `get_groom_branch_id(branch)` → cabang pengerja (NULL = tidak terima order).
- Tabel ini punya **2 FK ke `branches`** → embed wajib pakai nama FK:
  `branches!logistics_store_branches_branch_id_fkey(...)` (query Laporan Muat sudah diperbaiki).
- UI Master Toko: tab "Daftar Toko & Pelanggan" (filter jenis, filter tanpa nomor HP, kolom
  Jenis, form pilih jenis) + tab "✂️ Cabang Grooming" (Owner edit, lainnya lihat).

---

## FASE 3 — Order Grooming

### Alur
```
① ORDER DIBUAT (siapa saja di cabang penerima order)
   - foto struk WAJIB + nomor nota WAJIB & UNIK per cabang
   - pelanggan (Master Toko, jenis pelanggan; nomor HP wajib)
   - qty kucing → tiap kucing: harga layanan (dari price_options produk promo) + groomer
   - cara DATANG: dijemput | datang sendiri
   - cara PULANG: diantar | diambil sendiri          (4 kombinasi, bebas)
   - ongkir per perjalanan (jemput / antar) + pengantar yang ditugaskan per perjalanan
② (kalau dijemput) perjalanan jemput — Fase 4
③ 📸 SAMPAI DI CABANG GROOMING → status DIKERJAKAN
④ 📸 SELESAI GROOMING (per kucing, oleh groomer) → status KUCING SELESAI
⑤ (kalau diantar) perjalanan antar — Fase 4; (kalau diambil sendiri) 📸 serah terima di toko
⑥ ORDER SELESAI → semua bonus jadi sah (Fase 5)
```

### Keputusan
- Pilihan groomer: semua karyawan aktif **cabang yang mengerjakan grooming** (sesuai pengaturan
  Fase 2: Toko Pusat & Raja Petshop) **+ Elan Suherlan selalu muncul**. Groomer boleh tidak
  punya akun.
- Qty > 1 → pilih groomer per kucing (boleh beda-beda).
- Groomer **bisa diganti kapan saja** sampai kucing selesai; alasan wajib; tercatat (dari, ke,
  oleh, kapan); pergantian setelah DIKERJAKAN diberi tanda ⚠️ di laporan persetujuan.
- **Bonus selalu ke groomer terakhir** (yang tercatat saat kucing selesai).
- **Paksa lanjut fase**: pembuat order atau Owner bisa menandai fase sudah dikerjakan (untuk
  orang tanpa aplikasi, mis. Elan). Tetap wajib foto oleh yang menekan + alasan, tercatat.
- Harga per kucing bisa dikoreksi pembuat order / Owner selama bonusnya belum disetujui (tercatat).
- **Batal** order (kapan pun) → **tidak ada bonus apa pun** (grooming & ongkir).
- Order dari Toko Depan dikerjakan di Toko Pusat; Markas di Raja → "sampai di cabang grooming"
  = cabang pengerja, bukan cabang penerima order.

### Perubahan (rancangan, sesuaikan saat mengerjakan)
- Tabel `grooming_orders` (cabang penerima, cabang pengerja, pelanggan, nomor nota, foto struk,
  mode datang/pulang, status, dibuat oleh, batal...). Unique `(branch_id, nota_number)`.
- Tabel `grooming_order_cats` (order, nama/keterangan kucing, harga, groomer_id, status,
  foto mulai/selesai, waktu, forced_by...).
- Tabel `grooming_groomer_changes` (jejak ganti groomer).
- RPC atomik untuk tiap transisi (pola sama dgn migrasi 067), semua waktu server.
- Halaman baru (mis. `/grooming/order`) + menu sidebar dengan badge (order yang menunggu aksi saya:
  kucing yang saya groom & belum selesai, dsb).

### Hasil Fase 3 (sudah live) — yang perlu diketahui fase berikutnya
- Halaman **`/logistik/grooming`** ("Order Grooming"): tab Order Aktif / + Buat Order / Riwayat
  (periode gaji, rekap per groomer). Menu: staf 4 cabang (link ✂️) + submenu Pengiriman Logistik
  (admin & Kepala Gudang). Badge `get_grooming_badge_count()` + event `grooming-badge-refresh`.
- Tabel: `grooming_orders` (status `menunggu → dikerjakan → siap → selesai`, atau `batal` +
  `status_before_cancel`), `grooming_order_cats` (harga, `groomer_id`, foto selesai, `forced_reason`,
  `groomer_changed_after_start` = ⚠️), `grooming_groomer_changes` (penugasan awal old NULL),
  `grooming_price_changes`, `grooming_extra_groomers` (isi: Elan Suherlan; Owner bisa tambah).
  Semua tulis lewat RPC; RLS hanya SELECT.
- Nomor nota disimpan **UPPERCASE** & unik per cabang penerima **kecuali order batal**
  (partial unique index) — order batal membebaskan nomornya.
- Kolom ongkir & pengantar per perjalanan sudah ada: `pickup_ongkir/pickup_assignee` (jemput),
  `delivery_ongkir/delivery_assignee` (antar); constraint wajib isi sesuai mode.
- RPC: `create_grooming_order(12 arg, p_cats jsonb)`, `mark_grooming_arrived`, `finish_grooming_cat
  (p_cat_id, p_photo_url, p_forced_reason)`, `change_grooming_groomer`, `correct_grooming_price`,
  `complete_grooming_handover`, `cancel_grooming_order`, `list_groomer_candidates`,
  `get_grooming_price_options(groom_branch)`. Helper: `is_valid_groomer`, `get_grooming_promo_product
  (groom_branch)` (produk promo aktif bernama *groom*, periode terbaru — **dipakai Fase 5 untuk % bonus**),
  `is_grooming_order_staff`, `can_read_grooming_order`, `is_my_grooming_cat_order`.
- Aturan yang diterapkan: harga saat buat order harus salah satu `price_options` (koreksi bebas >0
  oleh pembuat/Owner, tercatat); foto selesai kucing ≥ 5 menit sejak sampai; Paksa Lanjut = pembuat
  order/Owner + alasan ≥ 5 huruf; ganti groomer oleh staf cabang penerima/pengerja/pembuat/Owner
  selama kucing belum selesai; batal oleh pembuat/staf cabang penerima/Owner, order **selesai** hanya
  Owner. Foto di bucket `logistics-photos` folder `grooming/<order_id atau uuid>/`.
- **SEMENTARA sampai Fase 4**: langkah "sampai di cabang grooming" untuk order **jemput** dan
  "serah terima" untuk order **antar** cukup 1 foto (`mark_grooming_arrived` boleh juga oleh
  penjemput; `complete_grooming_handover` boleh juga oleh pengantar). Fase 4 harus mengganti ini
  dengan trip 3 foto (dan menolak jalur foto tunggal untuk mode jemput/antar).
- **Untuk Fase 5**: `correct_grooming_price` & `cancel_grooming_order` belum cek "bonus sudah
  disetujui" — tambahkan saat ledger/approval dibuat.

---

## FASE 4 — Perjalanan jemput & antar grooming

### Keputusan user (7 Okt 2026)
- Tugas jemput/antar kucing tampil di menu **Kirim Barang** (satu tempat untuk semua tugas antar),
  bukan dipisah di Order Grooming.
- **Satu trip boleh campur**: antar barang + antar kucing + jemput kucing sekaligus ("kadang antar
  barang sekalian ambil/jemput kucing"). Jadi stop trip harus generik (kiriman barang / antar kucing /
  jemput kucing) dan PJ bisa mencentang tugas dari jenis berbeda saat foto 1.
- Konsekuensi yang harus dirancang: untuk stop **jemput**, foto di pelanggan = kucing diambil, lalu
  kucing baru "sampai di cabang grooming" saat ada foto di cabang pengerja — bisa berupa foto 3
  (kalau cabang asal PJ = cabang pengerja) atau stop tambahan "serahkan kucing di [cabang pengerja]"
  dalam trip yang sama. Untuk stop **antar kucing**, kucing harus ikut dibawa sejak foto 1 (order
  berstatus `siap`); foto sampai di pelanggan = serah terima → order `selesai`.

- Pakai ulang mesin trip 3 foto (Fase 0/1). Perlu dibuat **generik**: stop trip bisa menunjuk
  ke kiriman barang **atau** perjalanan grooming (jemput/antar). Opsi: kolom `kind` + FK nullable
  di `logistics_tp_trip_stops`, atau tabel trip terpisah yang memanggil fungsi waktu yang sama.
- **Jemput**: foto 1 = berangkat dari cabang, foto 2 = **jemput kucing di pelanggan**, foto 3 =
  **sampai di cabang grooming** (= otomatis status DIKERJAKAN di Fase 3). Aturan 5 menit & 20
  menit berlaku.
- **Antar**: sama seperti Kirim Barang (ambil di cabang grooming → sampai pelanggan → kembali).
- **Diambil sendiri**: tidak ada trip, cukup 📸 serah terima di toko.
- Pengantar tiap perjalanan ditugaskan (Fase 1: tampil hanya ke orang itu); bisa beda orang.
- Ongkir **per perjalanan**, bonus 50% untuk PJ perjalanan itu — **cair hanya jika order selesai
  total** (bukan saat trip selesai). Trip grooming tutup paksa / order batal → 0.

### Hasil Fase 4 (sudah live) — yang perlu diketahui fase berikutnya
- `logistics_tp_trip_stops` generik: `kind ('barang'|'antar_kucing'|'jemput_kucing'|'serah_kucing')`,
  `loading_id` (nullable, wajib utk barang), `grooming_order_id` (wajib utk kucing), `auto_on_return`.
  Unik: 1 stop hidup per (order, kind). Jemput selalu dibuat **berpasangan** dengan serah.
- `start_tp_trip(p_loading_ids, p_photo_url, p_grooming jsonb [{order_id, leg:'jemput'|'antar'}])` —
  satu trip boleh campur barang + kucing. Jemput: order `menunggu` & `pickup_assignee = saya`;
  antar: order `siap` & `delivery_assignee = saya`.
- `arrive_tp_stop`: serah → order `dikerjakan` (arrived_by = PJ); antar → order `selesai`
  (handover_by = PJ). Serah butuh jemput order itu sudah difoto. `release_tp_stop`: jemput+serah dilepas
  berpasangan; tidak bisa dilepas setelah kucing dijemput.
- `finish_tp_trip`: serah kucing yang cabang pengerjanya = cabang PJ **otomatis** selesai dengan foto 3
  (`auto_on_return = true`); kalau beda cabang wajib foto serah dulu. Waktu berangkat/kembali dihitung
  sebelum serah otomatis.
- Bonus ongkir: satu sumber rumus `tp_ongkir_bonus_items(emp)` (internal) dipakai
  `get_employee_ongkir_bonus` & `resync_ongkir_bonus_payroll`. Stop grooming hanya dihitung kalau trip
  `selesai` **dan** order `selesai`; jatuh di periode `payroll_period_of(GREATEST(return_at, completed_at))`.
  `resync_grooming_order_ongkir(order)` dipanggil saat order selesai/batal/ongkir diubah.
  ⇒ **Fase 5 tidak perlu lagi mengubah `get_employee_ongkir_bonus`** (sudah beres di sini).
- Jalur foto tunggal Fase 3 untuk order jemput/antar → sekarang jalur darurat: `mark_grooming_arrived` &
  `complete_grooming_handover` punya arg ke-3 `p_forced_reason`; untuk mode jemput/antar hanya pembuat
  order/Owner + alasan, ditolak saat trip-nya masih berjalan; tercatat di `arrived_forced_reason` /
  `handover_forced_reason`; ongkir leg itu tidak jadi bonus (tidak ada trip selesai).
- RPC baru: `reassign_grooming_leg(order, leg, emp, reason)` (sebelum foto 1; staf cabang/pembuat/Owner),
  `set_grooming_ongkir(order, leg, ongkir)` (setelah diambil hanya Owner). Jejak:
  `grooming_assignment_changes`, `grooming_ongkir_changes`. `reassign_tp_trip` (Owner) ikut memindah
  penjemput/pengantar grooming yang belum selesai. `cancel_grooming_order` melepas stop yang belum
  difoto (trip jadi batal kalau kosong).
- Badge Kirim Barang (`get_tp_delivery_badge_count`) + tugas jemput/antar kucing saya yang belum diambil.
- UI: Kirim Barang menampilkan kartu 🐱 jemput/antar (bisa dicentang bareng kiriman barang), stop kucing
  di trip, bonus "menunggu order grooming selesai". Order Grooming menampilkan status perjalanan, ganti
  penjemput/pengantar, ubah ongkir, foto jemput, jalur darurat, riwayat penugasan/ongkir.

---

## FASE 5 — Bonus grooming & slip gaji

### Keputusan
- Bonus grooming = **10% × harga** kucing (persen diambil dari produk promo cabang pengerja).
- Groomer **Rahmat Saleh / Fikri Mulyana** (yang terdaftar di `target_employee_ids` produk
  Grooming Kucing) → **otomatis** dibuat `promo_sales_reports` (status `pending`, `unit_price` =
  harga, tanggal = tanggal kucing selesai, foto = struk order, `late_penalty_pct = 0`) saat order
  SELESAI → jalur Bonus Promo yang sudah ada (perlu approve + sync).
- Groomer **lain (termasuk Elan Suherlan)** → **catatan terpisah** (tabel baru mis.
  `grooming_bonus_ledger`): bisa dilihat & dibaca, perlu approve Owner/HR/Finance, masuk slip gaji
  sebagai baris sendiri **"Bonus Grooming"** (kolom baru `payrolls.grooming_bonus`, pola sama
  dengan `ongkir_bonus`: hitung saat buat slip + auto-resync ke slip draft). **Pisah** dari Bonus
  Promo, tidak ikut target cabang.
- Bonus ongkir grooming → ikut `ongkir_bonus` yang sudah ada, tapi hanya dihitung bila order
  grooming selesai total (perlu ubah `get_employee_ongkir_bonus` & `resync_ongkir_bonus_payroll`).
- Setiap rumus gross di DB/klien harus ikut menjumlah kolom bonus baru:
  `sync_promo_bonus_to_payroll`, `resync_ongkir_bonus_payroll`, 2 rumus `newGross` di
  `penggajian/bulanan/page.tsx`, `buildSlipPreview`, struk HTML, export, `portal/slip-gaji`.
- Laporan bonus otomatis: tidak bisa diedit manual oleh groomer; koreksi lewat order.

### Penutupan lapor manual Grooming Kucing
- Lapor manual **ditutup otomatis pada tanggal fitur order grooming mulai dipakai** (tanggal
  diatur Owner di pengaturan, mis. kolom di tabel pengaturan cabang grooming). Sebelum tanggal
  itu lapor manual tetap jalan (aturan H+2 / potong 50% tetap). JANGAN menutup sebelum Fase 3–5
  live, supaya groomer tidak kehilangan jalur lapor.
- Implementasi: `submit_promo_sales_report` menolak produk grooming (mis. `bonus_percent` not null
  + flag `is_grooming`) bila tanggal lapor ≥ tanggal penutupan.

### Hasil Fase 5 (sudah live)
- Trigger `trg_grooming_order_bonus` di `grooming_orders`: status → `selesai` memanggil
  `create_grooming_bonus_records` (idempoten per kucing); status → `batal` memanggil
  `void_grooming_bonus_records` (ledger `void`, laporan promo otomatis `rejected`, slip draft disinkron).
- Groomer target produk promo Grooming **cabangnya sendiri** pada periode gaji tanggal kucing selesai
  (`grooming_promo_product_for`) → `promo_sales_reports` (pending, qty 1, foto = URL publik struk,
  `grooming_cat_id`). Selain itu → `grooming_bonus_ledger` (persen dari `get_grooming_promo_product`
  cabang pengerja, default 10; periode = periode gaji order **selesai**).
- `payrolls.grooming_bonus` ("Bonus Grooming"); `get_employee_grooming_bonus`, `review_grooming_bonus`
  (Owner/HR/Finance) → `resync_grooming_bonus_payroll` (slip draft). Rumus gross server sekarang satu:
  `recalc_payroll_totals(payroll_id)` (dipakai resync ongkir, sync promo, resync grooming). Klien:
  2 `newGross`, preview buat slip, struk HTML, detail slip admin & `portal/slip-gaji` ikut menjumlah.
- `correct_grooming_price` menolak kalau bonus kucing sudah disetujui; kalau belum, ikut mengubah
  laporan promo otomatis / ledger. `edit_promo_sales_report` menolak laporan otomatis.
  `get_promo_sales_reports` + kolom `grooming_cat_id`, `grooming_warning` (badge ✂️ & ⚠️ di halaman promo).
- `grooming_settings.manual_report_close_date` (Owner, tab "Persetujuan Bonus" di Order Grooming).
  `submit_promo_sales_report` menolak produk *groom* (bonus_percent) bila tanggal struk ≥ tanggal itu.
  Halaman Target Penjualan Promo karyawan menyembunyikan tombol lapor setelah tanggal itu.
  **Belum diisi** — Owner yang menentukan kapan.
- `lib/meeting.ts signedPhotoUrls` meneruskan URL http apa adanya (foto struk dari logistics-photos).
- Badge Order Grooming: + jumlah ledger `pending` untuk Owner/HR/Finance; order siap buatan saya hanya
  yang diambil sendiri.

### Lanjutan setelah Fase 5 (permintaan user 7 Okt 2026)
- `DeliveryAssigneePicker` tidak lagi pakai `<datalist>` (saran tidak muncul di HP Android) → daftar
  sendiri (commit `54f8250`). Dipakai Laporan Muat & Order Grooming.
- Migrasi 073: jabatan **Groomer** tidak bisa membuat order (`is_my_position_groomer`, tab Buat Order
  disembunyikan). Rahmat & Fikri sekarang berjabatan Groomer.
- Koreksi harga **tetap** hanya pembuat order/Owner (keputusan user: groomer bisa curang).
- Tanggal tutup lapor manual **sengaja belum diisi** (keputusan user).
- Migrasi 074:
  - `promo_products.is_grooming` (centang "✂️ Produk Grooming" di form produk promo; wajib mode %).
    Semua logika grooming (`get_grooming_promo_product`, `grooming_promo_product_for`,
    `submit_promo_sales_report`) pakai tanda ini, bukan nama.
  - `ensure_grooming_promo_product(branch, ts)`: produk Grooming periode itu belum ada & produk periode
    terakhir aktif → disalin otomatis (`created_by NULL`, tampil badge "🔁 Disalin otomatis"). Produk
    periode itu ada tapi nonaktif → dianggap sengaja dimatikan (bonus lewat catatan).
  - Cek dobel: `grooming_order_cat_exists` / `grooming_manual_report_exists` (groomer + tanggal WIB +
    harga sama). `get_promo_sales_reports.possible_duplicate` → badge merah di halaman promo.
  - `get_grooming_bonus_recap(month, year)`: 3 sumber (promo_otomatis, catatan, manual) dalam satu
    daftar → tab "Rekap Bonus" (Owner/HR/Finance semua; karyawan "Bonus Saya" miliknya sendiri).
    Tab "Persetujuan Bonus" sekarang hanya untuk Owner/HR/Finance.

---

## Celah yang sudah diidentifikasi & solusinya

| # | Celah | Solusi |
|---|---|---|
| 1 | Elan tidak punya akun → tidak bisa foto | Paksa lanjut fase oleh pembuat order/Owner (foto + alasan) |
| 2 | Groomer di luar daftar target promo → laporan promo ditolak | Groomer lain masuk ledger terpisah (Fase 5) |
| 3 | Groomer diganti di tengah jalan | Bonus ke groomer terakhir, jejak ganti + ⚠️, tetap perlu approve |
| 4 | Struk dipakai ulang | Nomor nota wajib & unik per cabang |
| 5 | Harga berubah (tambah layanan) | Koreksi oleh pembuat order/Owner sebelum approve, tercatat |
| 6 | Pelanggan perorangan membanjiri Master Toko | Label `toko`/`pelanggan`, daftar driver hanya `toko` |
| 7 | Pelanggan dobel | Nomor HP wajib + unik (dinormalisasi) |
| 8 | Order batal setelah dijemput | Tidak ada bonus apa pun (keputusan user) |
| 9 | Lokasi "sampai toko" untuk order lintas cabang | Pakai cabang pengerja dari pengaturan Fase 2 |
| 10 | Penerima tugas berhalangan sebelum berangkat | Ganti Penerima Tugas (pembuat / rekan satu cabang) sebelum foto 1 |
| 11 | Lapor manual ditutup sebelum fitur siap | Tutup otomatis di tanggal mulai yang diatur Owner |
| 12 | Jam HP dimanipulasi | Semua waktu dari server |
| 13 | Foto dari galeri | Kamera langsung + `maxFileAgeMs` |

---

## Catatan teknis untuk setiap sesi

- Proyek Supabase: `rwzerjfzazhpcnfktgax` (Hris-Hammielion). Terapkan migrasi via MCP
  `apply_migration`, simpan juga file SQL di `database/migrations/NNN_nama.sql`.
- Repo git ada di `hris-app/` (root `D:\HRIS Hammielion` bukan repo). Branch `main`, commit
  langsung ke main lalu push (pola yang sudah dipakai).
- Cek tipe: `npx tsc --noEmit -p .` dan `npx eslint <file>` di `hris-app/`. Lint `sidebar.tsx`
  sudah punya 9 masalah lama — jangan dihitung sebagai regresi.
- PowerShell 5.1 merusak UTF-8 (em-dash, box drawing) bila pakai `Get-Content`/`Set-Content` →
  pakai tool Edit/Write untuk mengubah file.
- Header tabel sticky: beri `bg-*` di setiap `<th>`.
- Perubahan UI yang ada sisi karyawan & sisi persetujuan → terapkan di kedua halaman.
