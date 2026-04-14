# HRIS HAMMIELION — Master Project Context
# Berikan file ini ke AI (sesi baru) di awal sesi agar AI paham konteks lengkap
# Terakhir diupdate: April 2026 — Fase Setup Awal

---

## IDENTITAS PROYEK

| Field | Detail |
|---|---|
| Nama Aplikasi | HRIS Hammielion |
| Tipe | Web Application (Next.js) |
| Pemilik | HR Manager, Hammielion Petshop |
| Tujuan | Menggantikan pengelolaan HR manual (Excel) dengan sistem digital |
| Status | **FASE 1 — Foundation & UI Setup** |
| Tech Stack | Next.js 15, TypeScript, CSS Modules, Zustand, Framer Motion |
| Database (nanti) | Supabase (PostgreSQL) |
| Hosting (nanti) | Vercel |

---

## KONTEKS BISNIS PENTING

- **Jumlah karyawan**: ~20 orang, 5 cabang
- **Divisi**: Back Office, Staff Toko (Kasir, Helper, Groomer), Operasional (Driver, Kenek)
- **Status karyawan**: Tetap dan Kontrak
- **Sistem cut-off gaji**: Tanggal 26 bulan ini s/d tanggal 25 bulan berikutnya
- **Sistem libur**: Maksimal 4 hari libur per periode (BUKAN 1 hari per minggu)
- **Shift**: 2 shift — Pagi (08:00–16:00) dan Siang (12:00–20:00)
- **Lembur**: Dibayar hanya jika ada perintah resmi

---

## ATURAN GAJI (SUDAH DIKONFIRMASI OWNER)

### Potongan Otomatis
| Aturan | Nilai |
|---|---|
| Potongan keterlambatan | Rp 1.500 per menit |
| Potongan tidak absen (alpha) | Rp 75.000 per kejadian |
| Batas menit untuk bonus disiplin | 30 menit akumulasi per bulan |
| Bonus kedisiplinan | Rp 150.000 (cair jika total terlambat < 30 menit) |

### Potongan Manual (Input Admin)
- **Minus Kasir**: Hanya kasir yang bertugas pada shift tersebut yang menanggung
- **Kehilangan Barang**: Admin atur persentase tanggungan per karyawan terdampak

### Komponen Pendapatan
- Gaji Pokok
- Tunjangan (dikonfigurasi per karyawan)
- Bonus Kedisiplinan (otomatis)
- Bonus KPI: `(skor KPI / 100) × nominal bonus per jabatan`
- Bonus Ritase: khusus Driver & Kenek (per trip × tarif)

---

## SISTEM KPI

- KPI berbentuk **checklist** per indikator
- Setiap jabatan punya indikator berbeda (dikonfigurasi Admin HR)
- KPI di-reset setiap bulan, riwayat tetap tersimpan
- Skor KPI = persentase (0–100%)
- Bonus KPI = `(skor / 100) × nominal bonus` yang diset Admin HR per jabatan

---

## SISTEM DRIVER & RITASE

- 3 jenis mobil (Mobil A, B, C)
- 4 jenis rute (Rute 1, 2, 3, 4)
- 12 kombinasi harga (dikonfigurasi di Pengaturan > Master Ritase)
- Driver: dibayar per trip sesuai kombinasi mobil × rute
- Kenek: karyawan tetap, bayaran ritase adalah BONUS di atas gaji pokok
- Kenek bisa ikut trip berbeda setiap harinya

---

## DESIGN SYSTEM

| Elemen | Nilai |
|---|---|
| Theme | Clean Authority (Light Mode) |
| Primary color | #0D9488 (Teal) |
| Background | #F1F5F9 |
| Surface (card) | #FFFFFF |
| Border | #E2E8F0 |
| Text utama | #0F172A |
| Text sub | #64748B |
| Font | Inter (system font) |

---

## STRUKTUR FOLDER

```
src/
├── app/
│   ├── (auth)/login/          # Halaman login
│   └── (dashboard)/           # Semua halaman utama + layout
├── components/
│   ├── atoms/                 # Button, Badge, Avatar, dll
│   ├── molecules/             # FormField, SearchBar, StatCard, dll
│   └── organisms/             # Sidebar, TopBar, DataTable, Modal
├── stores/                    # Zustand stores (1 per modul)
├── types/                     # TypeScript interfaces
├── data/                      # Dummy data (sementara, diganti Supabase nanti)
└── lib/
    ├── constants/             # navigation.ts, theme.ts, roles.ts
    ├── utils/                 # formatters.ts, payroll.ts
    └── hooks/                 # useDebounce, useGeolocation
```

---

## ATURAN CODING (WAJIB DIIKUTI)

1. **Satu komponen = satu file**, maks 150–200 baris
2. Setiap folder komponen: `NamaKomponen.tsx` + `NamaKomponen.module.css` + `index.ts`
3. **JANGAN** gunakan Tailwind — pakai CSS Modules + CSS Variables
4. **JANGAN** simpan state di komponen kecuali state lokal UI (open/close, toggle)
5. Semua logika hitung gaji ada di `src/lib/utils/payroll.ts`
6. Semua format tampilan (Rupiah, tanggal, dll) ada di `src/lib/utils/formatters.ts`
7. Dummy data ada di `src/data/` — nanti diganti API call ke Supabase
8. Import alias: gunakan `@/` bukan path relatif panjang

---

## AKUN DEMO (FASE DUMMY)

| Email | Password | Role |
|---|---|---|
| admin@hammielion.com | admin123 | Admin HR |
| owner@hammielion.com | owner123 | Owner |
| budi@hammielion.com | karyawan123 | Karyawan |

---

## STATUS PENGEMBANGAN

| Modul | Status |
|---|---|
| Login & Auth | ✅ Selesai (dummy) |
| Layout (Sidebar + TopBar) | ✅ Selesai |
| Dashboard | ✅ Selesai (data dummy) |
| Karyawan | 🔧 Shell siap, perlu dikembangkan |
| Absensi | 🔧 Shell siap, perlu dikembangkan |
| Performa & KPI | 🔧 Shell siap, perlu dikembangkan |
| Driver & Ritase | 🔧 Shell siap, perlu dikembangkan |
| Penggajian | 🔧 Shell siap, perlu dikembangkan |
| Cuti & Izin | 🔧 Shell siap, perlu dikembangkan |
| Laporan | 🔧 Shell siap, perlu dikembangkan |
| Pengaturan | 🔧 Shell siap, perlu dikembangkan |
| Database (Supabase) | ⏳ Fase berikutnya |

---

## CARA MENJALANKAN PROJECT

```bash
# Masuk ke folder project
cd hris-hammielion

# Install dependensi (lakukan sekali)
npm install

# Jalankan development server
npm run dev

# Buka di browser
# → localhost:3001 (jika 3000 sudah dipakai STITCHLYX)
```
