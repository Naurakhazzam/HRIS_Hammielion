# Rencana: Nota Cabang di Laporan Muat + Verifikasi Finance

Dokumen kerja hasil diskusi dengan user (9 Oktober 2026). Dikerjakan **per tahap**. Cara pakai:

> Baca `hris-app/docs/RENCANA-NOTA-CABANG.md`, kerjakan Tahap N.

Setiap tahap selesai: centang checklist di **Status**, catat nomor migrasi & commit, lalu push
(user selalu tes di app yang sudah di-deploy, bukan localhost). Bahasa ke user: **Bahasa Indonesia,
sederhana** — user bukan programmer, dan driver di lapangan gagap teknologi.

**Jangan mulai tahap yang masih punya pertanyaan terbuka di bagian 6 tanpa konfirmasi user.**

---

## Status

- [x] **Tahap 1** — Nota cabang di Laporan Muat (nominal wajib, aturan koreksi, 1 laporan = 1 driver)
  (migrasi `082_central_loading_nota.sql`, commit `f529d2c`). Keputusan: laporan yang sudah Selesai
  tapi belum diambil saat rilis **tidak wajib** diisi nota (boleh diisi lewat tombol "Isi Nota").
  Aturan "1 laporan = 1 driver" hanya berlaku untuk laporan yang punya nota.
- [x] **Tahap 2** — Pembayaran di lapangan (driver isi 1 angka → dibagi otomatis; pengantar antar sendiri isi di Foto 2)
  (migrasi `083_visit_payment_allocation.sql`, commit lihat git log "Nota cabang Tahap 2"). Catatan implementasi:
  - Server membagi lewat `apply_visit_payment`; driver kirim/edit lewat RPC `submit_plan_store_delivery`
    / `update_plan_store_payment` (bukan update langsung lagi). Edit terkunci kalau sudah diverifikasi finance.
  - `payment_amount` = bagian Nota Gudang **+ lebih bayar** (kalau ada Nota Gudang) supaya Laporan
    Pengiriman lama tetap menampilkan "lebih bayar"; angka asli ada di `received_total`, lebihnya di `overpay_amount`.
  - Nota Gudang boleh 0 hanya kalau kunjungan membawa nota cabang (centang "Tidak ada barang gudang").
  - Antar sendiri: tidak minta foto bukti transfer / tanggal jatuh tempo (cukup cara bayar + uang diterima).
  - Klaim paket kini hanya digabung ke kunjungan toko yang masih **pending** (dulu bisa menempel ke
    kunjungan yang sudah terkirim → nota tidak tertagih).
  - Belum: Laporan Pengiriman (finance) belum menampilkan nota cabang — masuk Tahap 3.
- [x] **Perbaikan audit (9 Okt 2026)** — migrasi `084_fast_logistics_participant_visibility.sql`
  (timeout/error 500 di Laporan Muat, Kirim Barang, grooming: policy `employees` dihitung lewat
  `can_see_logistics_participant`, hak lihat terbukti sama untuk 22 akun) dan
  `085_nota_release_and_transfer_photo.sql` (kunci "1 nota = 1 driver" hanya selama trip driver
  pertama masih aktif; nota cabang hanya ditagih sekali; antar sendiri transfer wajib foto bukti —
  wajibnya baru di aplikasi, server belum memaksa supaya versi lama tidak macet). Laporan Pengiriman:
  perbaikan sementara — tampil nota cabang, "diterima" = `received_total`, piutang dari semua nota.
  **Belum di-push** (permintaan user: dikumpulkan, push sekaligus nanti).
- [x] **Tahap 3** — Tab verifikasi finance (Cocok / Tidak Cocok + pemberitahuan kurang bayar)
  (migrasi `086_finance_verify_delivery_money.sql`, **belum di-push**). Tab "Uang Pengiriman" di
  `keuangan/approval` → komponen `components/VerifikasiUangPengiriman.tsx`. RPC `verify_visit_payment`
  / `unverify_visit_payment` (kunjungan driver, semua nota sekaligus) dan `verify_nota_payment` /
  `unverify_nota_payment` (antar sendiri). Rekening: cash/deposit default Kas Tunai, transfer wajib
  dipilih. `apply_visit_payment` memakai angka finance bila sudah diverifikasi; nota cabang ikut
  menyimpan `nota_verified_*` + `nota_account_id`. Tombol lama `verify_cash_payment` (Laporan
  Pengiriman) diarahkan ke logika yang sama. Driver tidak bisa edit setelah diverifikasi.
  Foto 2 antar sendiri: tempo wajib tanggal jatuh tempo (di aplikasi), angka asli disimpan di
  `nota_reported_amount`. Pengiriman lama (tanpa `received_total`) tetap diverifikasi di Laporan Pengiriman.
- [x] **Buku Piutang** — migrasi `087_receivables_ledger.sql`, halaman `keuangan/piutang` (menu
  Keuangan → Buku Piutang), **belum di-push**. Nota tidak disalin: view `fin_receivable_notas` /
  `fin_receivables` menghitung langsung dari kunjungan driver (Nota Gudang, cabang Gudang) & Laporan
  Muat (nota cabang) sejak 10 Okt 2026; resmi = sudah diverifikasi atau tempo. Pelunasan disimpan di
  `fin_receivable_payments` + `fin_receivable_allocations` lewat RPC `record_receivable_payment`
  (paling lama dulu, tanggal sama → gudang dulu; kind `setoran` masuk rekening / `saldo` pakai saldo
  konsumen) & `cancel_receivable_payment`. Saldo konsumen = view `fin_customer_credit_entries`
  (lebih bayar terverifikasi + sisa setoran − saldo dipakai). Trigger `guard_receivable_locked`
  mengunci nota yang sudah punya pelunasan dari edit driver / verifikasi ulang / ubah nota.
  Akses: `can_access_receivables()` = owner/hr/finance (Nisa ber-role hr).
- [x] **Tahap 4** — Gagal / Kirim Besok + tab Tertunda (berlaku nota gudang & nota cabang)
  (migrasi `088_postpone_or_fail_delivery.sql`, **belum di-push**). Status tetap `failed` + kolom
  `fail_kind` (`kirim_besok`/`gagal`); trigger mengisi `kirim_besok` kalau kosong (aplikasi lama).
  Trigger `handle_plan_store_outcome`: Kirim Besok → paket cabang kembali `pending` (muncul lagi di
  Jemput Barang), laporan dicatat `postponed_at`/`postpone_count`/`last_postpone_reason`; Gagal →
  laporan muat `dibatalkan` + `fail_reason`. Terkirim → kunjungan Kirim Besok lain ke toko yang sama
  tertutup otomatis & tanda tunda laporan dihapus. Driver: RPC `fail_plan_store` (wajib alasan +
  foto); "Selesai lebih awal" = Kirim Besok. Halaman `logistik/tertunda` (Owner/Kepala Gudang
  kelola; HR/Finance lihat) + RPC `close_postponed_visit` / `cancel_postponed_loading`. Badge merah
  Owner `get_postponed_overdue_count` (> 3 hari). Jalur antar sendiri tidak diubah (tombol "Lepas"
  yang sudah ada = mengembalikan kiriman ke daftar menunggu).
  Paket lama 1 Okt (toko "Denz Ps", kunjungan gagal lama karena nama toko kembar): user konfirmasi
  **sudah terkirim** — dibiarkan apa adanya (tampil "Sudah Diambil", tidak muncul di Tertunda).
- [x] **Tambahan 9 Okt** (belum di-push): (a) Kirim Barang (antar sendiri): tombol **Gagal** per
  tujuan barang — alasan + foto, tujuan dilepas, Laporan Muat dibatalkan (`fail_tp_stop`, migrasi
  `089_tp_stop_fail.sql`, kolom `fail_photo_url`); "Lepas" tetap = dikirim lain waktu. (b) Laporan
  Pengiriman: toko per trip **diurutkan otomatis menurut jam terkirim/dikunjungi** (nomor 1 = pertama
  diturunkan), yang belum diproses menyusul sesuai rencana; label "(rencana #n)" bila beda urutan.
- [x] **Surat Jalan gudang** (keputusan 9 Okt, **belum di-push**) — migrasi `090_delivery_notes.sql`
  + `090b`..`090d` (DB: 090a_delivery_notes_tables, 090b_delivery_notes_rpcs,
  090c_delivery_notes_outcome_allocation, 090c2_visit_invoice_from_notes,
  090d_delivery_notes_receivables_badges). Tabel `logistics_delivery_notes` (+ riwayat nominal
  `logistics_delivery_note_changes`). Dibuat oleh Back Office (semua karyawan cabang Back Office) /
  Kepala Gudang / Owner (`can_manage_delivery_notes`). Persiapan tarik data kasir: `note_number`
  (opsional, unik bila diisi), `source`, `kasir_amount`, `match_status`, `logistics_stores.kasir_code`.
  Rencana Pengiriman: toko masuk lewat **centang surat jalan** (`add_notes_to_plan` /
  `remove_note_from_plan`), hanya sebelum berangkat; banyak surat jalan satu toko = satu kunjungan,
  tiap surat jalan satu nota. Nota Gudang kunjungan = jumlah surat jalan (driver tidak mengetik; angka
  dari aplikasi lama diabaikan). Ubah nominal setelah berangkat hanya Owner. Kirim Besok → surat jalan
  kembali `menunggu` (tertunda, paling atas saat menyusun rencana); Gagal → `perlu_keputusan`, kantor
  pilih jadwal ulang / batal (`decide_failed_note`). Barang cabang Gagal juga `perlu_keputusan`
  (bukan langsung batal), diputuskan kantor atau cabang asal (`decide_failed_loading`). Rencana
  dibatalkan / toko dihapus → surat jalan kembali menunggu. Pembagian uang & Buku Piutang per surat
  jalan (`source_type = 'surat_jalan'`). Halaman `logistik/surat-jalan` (5 tab), tombol "+ Tambahkan
  Surat Jalan" di Rencana Pengiriman, badge "perlu keputusan" (`get_failed_decision_count`).
- [ ] **Tahap 5** — Nota terverifikasi otomatis masuk Kas Masuk (**DITUNDA**, dibahas terakhir — lihat bagian 7).
  **Sudah diputuskan** lewat diskusi Laporan Kasir → dikerjakan sebagai Tahap 4 di `RENCANA-LAPORAN-KASIR.md`.
- [x] **Potong nota — jalur driver** (migrasi 092–092d, belum di-push) — lihat bagian 8.
- [x] Potong nota — jalur antar sendiri (migrasi 095, belum di-push) — lihat bagian 8.

---

## 1. Masalah yang mau diselesaikan

Di lapangan, satu kunjungan driver ke sebuah toko bisa membawa **2 nota atau lebih**:

- **Nota Gudang** — barang dari gudang (sudah tercatat di Laporan Pengiriman, diisi driver).
- **Nota cabang** — barang dari Laporan Muat cabang (Toko Pusat / Toko Depan / Markas / Raja) yang
  diambil driver di Jemput Barang Cabang, atau diantar sendiri oleh karyawan cabang.
  **Nominal nota ini sekarang tidak tercatat di mana pun** → uangnya tidak bisa dilacak/diverifikasi.

Catatan istilah: user menyebutnya "nota Toko Pusat", tapi Laporan Muat dipakai 4 cabang toko, jadi
di sistem namanya **nota cabang** dan selalu ditampilkan dengan nama cabang asalnya. Satu kunjungan
bisa punya Nota Gudang + beberapa nota cabang sekaligus.

---

## 2. Kondisi sekarang (dicek langsung ke database, 9 Okt 2026)

- `logistics_plan_stores` (1 baris = 1 kunjungan driver ke 1 toko) punya **satu set** kolom bayar:
  `invoice_amount`, `payment_method` (`cash|transfer|deposit|tempo`), `payment_amount`,
  `payment_photo_url`, `payment_due_date`, `office_verified_amount/_by/_at`. Diisi driver di
  `logistik/jalan/page.tsx` (`submitKirim`). Ini = **Nota Gudang**.
- `verify_cash_payment(p_plan_store_id, p_verified_amount)` — hanya Owner/HR/Finance, hanya untuk
  `cash`/`deposit`, cuma mengisi `office_verified_*`. **Tidak menulis ke `fin_cash_in`.**
  Trigger `trg_guard_logistics_office_verification` menjaga kolom verifikasi.
- **Tidak ada trigger** dari logistik ke `fin_cash_in`. Satu-satunya penulis `fin_cash_in` di kode
  adalah halaman input manual `keuangan/kas-masuk`. → Saat ini **tidak ada** uang pengiriman yang
  otomatis masuk Keuangan (baik nota gudang maupun cabang).
- **Tidak ada tabel piutang / saldo konsumen.** "Sisa piutang" & "lebih bayar jadi saldo konsumen"
  di layar driver (`BalanceNote`) cuma tampilan hitungan `invoice − payment`, tidak disimpan.
  (User menyebut "fitur utang piutang dalam penjualan" — kemungkinan di sistem kasir di luar HRIS.
  Perlu dikonfirmasi sebelum Tahap 3/5.)
- `fin_cash_in` tidak punya kolom sumber (`source_table/source_id`) — beda dengan `fin_cash_out`.
- Semua cabang (termasuk **Gudang**, rata-rata ±Rp 57 jt/hari) menginput omzet harian manual ke
  `fin_cash_in`. Relevan untuk risiko dobel di Tahap 5.
- `logistics_central_loadings`: 1 laporan = 1 tujuan (`store_id`), punya `ongkir` + jejak
  `logistics_ongkir_changes`. Belum ada kolom nota.
- Paket diambil driver per paket lewat `claim_central_loading_package` → paket dapat
  `plan_store_id` (kunjungan driver ke toko tujuan). **Ini penghubung nota cabang ↔ kunjungan
  driver.** Saat ini paket dari 1 laporan boleh diambil driver berbeda-beda.
- Catatan repo: migrasi `075_logistics_invoice_amount` sudah jalan di DB tapi **file-nya tidak ada**
  di `database/migrations/`. Jangan pakai nomor 075 untuk migrasi baru.

---

## 3. Aturan yang SUDAH DISEPAKATI

### Nota cabang (Laporan Muat)
1. **Wajib diisi staf cabang asal**, nominal **> 0**. Tidak ada konsep "titipan tanpa nota" di
   sistem — semua Laporan Muat pasti punya nominal.
2. Diisi saat **Tandai Selesai** (bersama pilihan jalur). Hanya **nominal nota**; metode bayar &
   uang diterima diisi di lapangan.
3. **Koreksi nominal** (pola sama dengan ongkir): staf cabang asal boleh ubah selama barang belum
   diambil; setelah diambil hanya Owner. Semua perubahan tercatat (siapa, kapan, dari → ke).
4. **1 laporan = 1 driver (opsi 2A):** paket pertama diambil driver/rencana X → paket lain dari
   laporan yang sama hanya bisa diambil oleh rencana X. Nota pindah tanggung jawab ke driver itu
   saat paket pertama diambil.
5. Data Laporan Muat lama (sebelum fitur ini) **dibiarkan** tanpa nota — tidak di-backfill.
   Aturan wajib hanya untuk laporan baru.
6. Semua barang cabang yang dibawa driver **wajib lewat Laporan Muat** (driver harus tekan ambil di
   Jemput Barang Cabang).

### Pembayaran di lapangan — jalur driver
7. Di layar kunjungan, driver melihat **semua nota** kunjungan itu:
   - Nota Gudang → driver ketik nominal nota (seperti sekarang).
   - Nota cabang → nominal **sudah terisi otomatis** dari Laporan Muat, driver tidak mengetik ulang.
8. **Satu metode bayar per kunjungan.** Kalau di lapangan kasusnya campur, pakai **deposit**.
9. Driver mengetik **satu angka: total uang diterima** (cash / transfer / deposit). **Wajib
   diketik, tidak boleh terisi otomatis.** Tempo: tidak ada uang diterima (0).
10. **Kurang bayar tidak menghambat driver** — tetap bisa diproses. Selisihnya muncul sebagai
    **pemberitahuan di halaman finance**.
11. **Pembagian otomatis ke tiap nota:** nota **nominal terbesar dilunasi dulu**, sisanya ke nota
    berikutnya, dst. Kalau nominal sama → **Nota Gudang didahulukan**.
12. **Lebih bayar** (uang > total nota) → dicatat sebagai **saldo konsumen**; finance yang
    menentukan (bisa jadi pelunasan nota sebelumnya).

### Pembayaran di lapangan — jalur antar sendiri
13. Nominal nota sudah ada dari Laporan Muat. Pengantar cukup **pilih metode bayar** dan **ketik
    uang diterima** (aturan sama dengan driver: wajib diketik, tempo = 0, kurang tetap lolos).
    Dilakukan di langkah **Foto 2 (sampai di toko)**.

### Verifikasi finance
14. Ada **tab khusus verifikasi**. Per kunjungan finance cukup pilih:
    - **Cocok** → langsung tervalidasi.
    - **Tidak Cocok** → finance ketik angka yang benar → sistem **membagi ulang** dengan aturan 11.
15. **Rekening tujuan** (untuk transfer) dipilih oleh **finance**, bukan driver.
16. **Tempo adalah bagian dari omzet** (bukan uang masuk) — sisa nota tempo/kurang bayar = piutang.

### Gagal / Kirim Besok (Tahap 4)
17. Dua status berbeda, berlaku untuk Nota Gudang **dan** nota cabang:

| Status | Arti | Barang | Nota |
|---|---|---|---|
| **Kirim Besok** (tutup / tidak ada orang) | Ditunda | Muncul lagi sebagai pengingat sampai terkirim | Tetap aktif, belum ditagih |
| **Gagal** (ditolak / batal pesan) | Tidak jadi | Kembali ke cabang asal | Dibatalkan, tidak masuk laporan |

18. Ada **tab "Tertunda"** berisi semua yang Kirim Besok sampai benar-benar terkirim.

---

## 4. Contoh pembagian otomatis (aturan 11)

Nota 1 = Rp 1.200.000 (terbesar), Nota 2 = Rp 800.000. Total Rp 2.000.000.

| Uang diterima | Nota 1 | Nota 2 | Kurang | Lebih |
|---|---|---|---|---|
| 2.000.000 | 1.200.000 lunas | 800.000 lunas | 0 | 0 |
| 1.900.000 | 1.200.000 lunas | 700.000 | 100.000 (nota 2) | 0 |
| 1.000.000 | 1.000.000 | 0 | 200.000 + 800.000 | 0 |
| 2.100.000 | 1.200.000 lunas | 800.000 lunas | 0 | 100.000 → saldo konsumen |
| 0 (tempo) | 0 | 0 | semua → piutang | 0 |

Nominal sama (mis. 1.000.000 gudang & 1.000.000 cabang): Nota Gudang diisi dulu.

---

## 5. Rancangan per tahap (usulan teknis — boleh disesuaikan saat dikerjakan)

### Tahap 1 — Nota cabang di Laporan Muat
- `logistics_central_loadings`: kolom baru `nota_amount numeric` (+ `nota_set_by`, `nota_set_at`).
  Constraint: laporan **baru** yang `status = 'selesai'` wajib `nota_amount > 0` (laporan lama
  dikecualikan, mis. lewat tanggal cutoff atau constraint `NOT VALID`).
- Tabel jejak `logistics_nota_changes` (pola `logistics_ongkir_changes`).
- RPC: `finish_central_loading` terima `p_nota_amount`; RPC baru `set_central_loading_nota`
  (aturan koreksi sama dengan `set_central_loading_ongkir`).
- `claim_central_loading_package`: kalau paket lain dari laporan yang sama sudah diambil rencana
  lain → tolak (aturan 4).
- UI `laporan-muat/page.tsx`: input nominal nota di form Tandai Selesai (kedua jalur), tampil di
  kartu & detail, tombol Ubah Nota. Jemput Barang: tampilkan nominal nota per paket/laporan.

### Tahap 2 — Pembayaran di lapangan
- Simpan pembagian per nota:
  - Nota Gudang: tetap di `logistics_plan_stores` (`invoice_amount`, `payment_amount` = **hasil
    pembagian untuk nota gudang**, supaya Laporan Pengiriman lama tetap benar).
  - Kolom baru di `logistics_plan_stores`: `received_total` (angka asli yang diketik driver untuk
    semua nota), `overpay_amount` (lebih bayar).
  - Nota cabang: kolom baru di `logistics_central_loadings`: `nota_paid_amount` (hasil pembagian),
    `nota_payment_method`, `nota_payment_photo_url`, `nota_due_date`, `nota_paid_at`.
- Pembagian dihitung **di server** (RPC baru, mis. `submit_plan_store_delivery`) — bukan di klien —
  supaya aturan 11 satu sumber dan bisa dipakai ulang oleh verifikasi finance (aturan 14).
  `submitKirim` di `jalan/page.tsx` pindah memanggil RPC ini.
- Layar driver: daftar nota (Gudang + tiap nota cabang dengan nama cabang asal), 1 metode bayar,
  1 kolom "Uang diterima" (kosong, wajib diketik), ringkasan Kurang/Lebih (informasi saja).
- Antar sendiri: `arrive_tp_stop` (Foto 2) ditambah metode + uang diterima untuk stop `barang`
  → isi kolom `nota_*` di laporan itu (satu nota, tanpa pembagian).
- Edit pembayaran setelah terkirim (fitur yang sudah ada) ikut memakai RPC yang sama.

### Tahap 3 — Tab verifikasi finance
- Halaman/tab baru (Owner/HR/Finance). Satu baris = satu kunjungan driver (semua notanya) atau
  satu kiriman antar sendiri.
- Tombol **Cocok** / **Tidak Cocok** (ketik angka benar → pembagian ulang via fungsi yang sama).
- Penanda: kurang bayar, lebih bayar (saldo konsumen), tempo (piutang).
- Finance memilih **rekening** untuk transfer.
- Menggantikan/memperluas `verify_cash_payment` (yang sekarang cuma cash/deposit & cuma nota gudang).

### Tahap 4 — Gagal / Kirim Besok
- Status baru di kunjungan (`logistics_plan_stores`) & kiriman antar sendiri: `kirim_besok` vs
  `failed`. Kirim Besok → kiriman kembali muncul untuk dijadwalkan ulang; Gagal → nota cabang
  dibatalkan, barang kembali ke cabang asal.
- Tab **Tertunda** (pengingat). Detail dibahas lagi sebelum dikerjakan (lihat bagian 6).

---

## 5b. Keputusan user 9 Okt 2026 (jawaban atas daftar keputusan)

**Tahap 3 — verifikasi finance**
1. Tab baru **"Uang Pengiriman"** di menu Keuangan → Verifikasi Keuangan (`keuangan/approval`).
2. Finance = **Nisa Hoerunisa** (akunnya saat ini ber-role `hr` dengan jabatan Finance — role tidak
   diubah tanpa izin user; owner/hr/finance semuanya boleh verifikasi).
3. Tempo di jalur antar sendiri **wajib tanggal jatuh tempo** (dibutuhkan buku piutang).
   Transfer (semua jalur) wajib foto bukti; belum ada bukti = tempo. Finance juga memverifikasi transfer.

**Buku piutang** (tahap tersendiri setelah Tahap 3)
4. Mulai dihitung dari nota **10 Okt 2026** ("mulai besok"), tanpa saldo awal piutang lama.
5. Piutang resmi **setelah finance verifikasi**; sebelumnya tampil "menunggu verifikasi".
6. Pelunasan dicatat **finance saja** (bukan driver).
7. Pelunasan dipakai ke **nota paling lama dulu**.
8. Saldo konsumen (lebih bayar) dipakai finance untuk menutup piutang.
9. Yang boleh melihat: **Owner & finance saja** (cabang tidak).

**Tahap 4 — Gagal / Kirim Besok**
10. Driver memilih Gagal / Kirim Besok di lapangan (alasan + foto).
11. Barang Kirim Besok kembali ke gudang/cabang asal, lalu muncul lagi di daftar jemput.
12. Batas Kirim Besok **3 hari**, lewat itu peringatan merah ke Owner.

**Push:** jangan push apa pun sampai user bilang (commit lokal saja). Migrasi DB langsung aktif,
jadi harus tetap cocok dengan aplikasi versi yang sedang ter-deploy.

## 6. Pertanyaan yang MASIH TERBUKA

Tanyakan ke user sebelum mengerjakan tahap terkait:

- **(Tahap 3)** Metode **transfer** ikut diverifikasi finance? Usulan: **ya**, semua kecuali tempo
  (karena finance yang memilih rekening transfer). Sekarang yang diverifikasi hanya cash & deposit.
- **(Tahap 3)** "Saldo konsumen" & "piutang" disimpan di mana? HRIS belum punya tabelnya. Apakah
  cukup ditandai di tab verifikasi, atau perlu buku piutang/saldo per toko di HRIS?
- **(Tahap 4)** Berapa lama kiriman boleh "Kirim Besok"? Siapa yang memutuskan status "Gagal"
  (driver langsung, atau perlu persetujuan)? Barang "Kirim Besok" dibawa pulang driver atau
  dikembalikan ke cabang/gudang?

---

## 7. DITUNDA — Tahap 5: masuk Kas Masuk otomatis

Tujuan akhir (goal) user: nota yang sudah diverifikasi finance **otomatis masuk Kas Masuk**.
Dibahas **terakhir**, setelah data Tahap 1–4 rapi.

Catatan dari diskusi supaya konteks tidak hilang:
- Risiko **dobel**: cabang (termasuk Gudang) sudah input omzet harian manual. Kalau omzet itu sudah
  termasuk penjualan yang dikirim, lalu verifikasi ikut menambah Kas Masuk → tercatat dua kali.
- User mengusulkan "omzet 10 jt − 3 jt yang dikirim = omzet asli". Pendapat Claude: **omzet tetap
  10 jt** (yang dikirim tetap penjualan cabang itu, termasuk tempo). Yang berkurang adalah **uang
  fisik di laci** (7 jt); yang 3 jt datang belakangan lewat pengiriman → dicatat sebagai **uang
  masuk dari pengiriman** (bukan omzet baru), tempo = piutang sampai dibayar. Belum diputuskan.
- `fin_cash_in` perlu kolom sumber (`source_table`/`source_id`) agar entri otomatis bisa dibedakan
  dari input manual & tidak dobel.
- Rekening: cash → "Kas Tunai"; transfer → dipilih finance (aturan 15).

## 8. Potong nota (jalur driver SELESAI — migrasi 092, 092b/c/d)

Keputusan user 9 Okt 2026:
- Driver, di Langkah 3 (Kejadian), menjawab **"Apakah ini POTONG NOTA?"**. Kalau ya: daftar barang
  (nama produk, nominal potongan, alasan: salah muat / rusak-kedaluwarsa / kurang jumlah / harga beda /
  lainnya) + pilihan **"Dibawa kembali driver"** atau **"Memang tidak ada barangnya"** (mis. pesan 10
  terkirim 9). Satu foto wajib. Driver tidak memilih nota.
- Potongan dibagi ke **nota terbesar dulu** (sama besar → gudang dulu), sama seperti uang
  (`apply_visit_payment`; kolom `gudang_cut_amount`, `logistics_delivery_notes.cut_amount`,
  `logistics_central_loadings.nota_cut_amount`). Potongan dihitung dulu, sisa nota baru dibayar uang.
- Perlu **persetujuan Finance/Owner** (Verifikasi Keuangan → Uang Pengiriman → sub-tab ✂️ Potong Nota,
  RPC `decide_visit_cut`). Sebelum disetujui / bila ditolak (alasan wajib), potongan tetap dihitung
  **kurang bayar (piutang)**. Keputusan bisa diubah selama nota belum punya pelunasan.
- Barang "dibawa kembali" otomatis jadi catatan retur (`logistics_store_returns` status `selesai`,
  penerima Gudang, catatan "Potong nota") → tinggal dikonfirmasi di **Penerimaan Retur**.
- Data: tabel `logistics_visit_cuts`; kolom `logistics_plan_stores.cut_total/cut_status/cut_photo_url/
  cut_decided_*/cut_return_id`. RPC `set_visit_cuts(plan_store, items jsonb, foto)` dipanggil aplikasi
  tepat setelah submit/edit pembayaran (signature RPC lama tidak berubah → aplikasi lama tetap jalan).
  Driver bisa ubah selama belum diputuskan & trip belum selesai; kalau barang sudah diterima gudang,
  potongan terkunci. Buku Piutang: kolom `cut_amount` di `fin_receivables`, sisa = nota − potongan −
  bayar − pelunasan. Badge: `get_pending_cut_count`.
- **Pemilik barang (migrasi 093, keputusan user 9 Okt 2026):** tiap barang wajib dipilih
  **"punya siapa"** (Gudang / cabang asal nota di kunjungan itu; otomatis kalau cuma satu pemilik).
  Potongan mengurangi **nota pemilik barang** (pemilik punya >1 nota → nota terbesarnya dulu); batas
  potongan per pemilik = nota pemilik itu. Barang "dibawa kembali" → retur `diambil` per pemilik
  (`logistics_store_returns.cut_plan_store_id`) = kartu **"📦 Antar Barang Potong Nota"** di layar
  driver: wajib foto saat menyerahkan ke pemilik (`finish_store_return`), trip tidak bisa selesai
  sebelum semua diantar, lalu cabang pemilik konfirmasi di Penerimaan Retur. Retur potong nota tidak
  ikut aturan "satu retur aktif per toko" dan tidak bisa dilepas dari trip.
- **B & C SELESAI (migrasi 094):** kolom `logistics_store_returns.return_source`
  (`kantor` / `potong_nota` / `kejadian` / `pecahan`); aturan "satu retur aktif per toko", lepas &
  batal trip hanya untuk `kantor`. Semua selain `kantor` = kartu **"📦 Antar Barang ke Pemiliknya"**
  (wajib foto saat diserahkan; trip tertahan sampai selesai).
  - **B** Tugas Retur kantor: tiap barang ada pilihan pemilik (`add_store_return_item` +
    `p_owner_branch_id`, bawaan = cabang pilihan kantor). Saat lapor selesai, barang milik cabang lain
    dipindah ke retur `pecahan` → diantar driver ke pemiliknya.
  - **C** Kejadian Salah Muat / Retur / Barang Lebih: daftar barang (`logistics_visit_incident_items`,
    RPC `set_visit_incident_items`) — nama barang terkirim, "seharusnya barang apa" (opsional), pemilik
    (semua cabang), dan nasib: **↩️ Dibawa pulang** (retur `kejadian` → antar + foto) atau
    **🛒 Dibeli toko** (salah varian tetap dibeli: tidak ada barang kembali, dicatat untuk koreksi stok
    pemilik; harga lebih murah → isi potong nota alasan "Harga beda"; lebih mahal → nominal nota sesuai
    barang yang dibeli). Wajib untuk Salah Muat & Barang Lebih kecuali sudah dicatat lewat potong nota.
    Tampil di Riwayat Toko driver & Laporan Pengiriman.
- **Antar sendiri SELESAI (migrasi 095):** di Foto 2 (Kirim Barang) PJ menjawab "Apakah ini POTONG
  NOTA?" (barang, nominal, alasan, dibawa kembali / memang tidak ada, foto). Pemilik = cabang asal kiriman
  (tidak dipilih). Data di `logistics_visit_cuts.loading_id` + kolom `logistics_central_loadings.nota_cut_*`;
  RPC `set_loading_cuts` (dipanggil setelah `arrive_tp_stop`; gagal → tombol "Simpan Ulang Potong
  Nota"), `decide_loading_cut`; `apply_loading_payment` menghitung ulang bayar/lebih bayar (dipakai juga
  verify/unverify_nota_payment). Barang dibawa kembali → retur `potong_nota` (`cut_loading_id`) yang
  otomatis selesai dengan Foto 3 "kembali di cabang" (`finish_tp_trip`) atau tutup paksa Owner, lalu
  cabang konfirmasi di Penerimaan Retur. Finance memutuskan di sub-tab ✂️ Potong Nota yang sama.
