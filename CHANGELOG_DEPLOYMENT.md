# CHANGELOG: Deployment Production & Stabilisasi Sistem
*Dokumen ini dibuat untuk Tim IT agar dapat melacak semua perubahan kode dan konfigurasi yang dilakukan selama proses persiapan deployment ke Vercel.*

---

## 1. Instalasi & Setup Repositori
- **Inisialisasi Git:** Repositori lokal `hris-hammielion` telah diinisialisasi dengan Git.
- **Remote Push:** Seluruh source code awal telah di-push ke GitHub repository `HRIS_Hammielion`.
- **Dependency Instalasi:** Menjalankan `npm install` untuk mengunduh seluruh package yang terdaftar di `package.json`.

## 2. Pembaruan Keamanan (Security Patch)
- **Celah Keamanan Next.js:** Ditemukan peringatan kritis dari Vercel mengenai celah keamanan pada *Next.js App Router* (CVE-2025-66478).
- **Tindakan:** Mengupgrade versi `next` dan `eslint-config-next` dari v`15.3.1` menjadi versi yang sudah di-patch, yaitu v`15.5.15`.
- **Dampak:** Aplikasi sudah aman dari kerentanan *Remote Code Execution*.
- **File Terdampak:** `package.json`, `package-lock.json`.

## 3. Penyelesaian Error Build (TypeScript & Linting)
Vercel memiliki aturan ESLint dan TypeScript yang sangat ketat yang menyebabkan *Failed to Compile*. Perbaikan yang dilakukan:

### A. Type Safety pada Konfigurasi Jabatan & Divisi
- **Masalah:** Terjadi *type mismatch* antara string statis dan definisi literal type pada `DIVISI_MAP` yang memicu error di halaman form Karyawan (Tambah/Edit).
- **Solusi:** Memberikan tipe data eksplisit pada objek pemetaan.
  - *Perubahan:* `export const DIVISI_MAP: Record<string, string> = {...}` ➜ `export const DIVISI_MAP: Record<string, Divisi> = {...}`.
- **File Terdampak:** `src/lib/constants/roles.ts`.

### B. Pembersihan Variabel Tidak Terpakai (Unused Variables)
- **Masalah:** Error eslint `@typescript-eslint/no-unused-vars` menyebabkan build gagal.
- **Solusi:** 
  - Pada halaman Detail Karyawan, menghapus import ikon `Mail` dan `CreditCard` dari `lucide-react` yang tidak digunakan.
  - Pada `useAuthStore.ts`, mengubah definisi struktur data yang mengandung *explicit any* (`(u as any).username`) agar lebih *type-safe*, serta menangani *unused variable* untuk property destructor `password` dengan _prefix underscore_ `_password` atau instruksi `eslint-disable`.
- **File Terdampak:** `src/app/(dashboard)/karyawan/[id]/page.tsx`, `src/stores/useAuthStore.ts`.

### C. Optimasi Komponen Gambar (Avatar Component)
- **Masalah:** Eslint Next.js *strict mode* menolak penggunaan elemen HTMl standar `<img>` tanpa komponen `<Image />` bawaan Next.js, memicu peringatan yang menggagalkan build di Vercel: `@next/next/no-img-element`.
- **Solusi:** Karena Avatar tidak memerlukan optimasi gambar server-side yang berat, ditambahkan opsi *bypass* sementara dengan menyematkan `{/* eslint-disable-next-line @next/next/no-img-element */}` pada file komponen terkait. 
- **File Terdampak:** `src/components/atoms/Avatar/Avatar.tsx`.
- **Tambahan Perbaikan:** Memperbaiki kesalahan *JSX syntax* yang sempat terjadi saat peletakan kode komen *disable eslint*. Komen dipindahkan dengan tepat agar *return statement* valid.

## 4. Penyesuaian UX Login
- **Masalah:** Format awal yang mewajibkan penulisan *email penuh* dianggap kurang efisien untuk *testing* dan *demo*.
- **Solusi:** 
  - Interface tipe otentikasi ditambah *property* opsional `username?: string`.
  - Store otentikasi (`useAuthStore`) dimodifikasi agar menerima "identifier" fleksibel yang bisa berupa `email` atau `username`.
  - Tampilan halaman Login diubah dari berlabel "Email" (type `email`) menjadi "Username" (type `text`), dengan *placeholder* `admin`.
- **File Terdampak:** `src/types/auth.types.ts`, `src/stores/useAuthStore.ts`, `src/app/(auth)/login/page.tsx`.

---
*Status saat ini: Aplikasi stabil, aman, dan telah sukses dideploy ke infrastruktur produksi Vercel tanpa hambatan kompilasi.*
