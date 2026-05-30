# Cara Pakai Google Apps Script — HRIS Hammielion

## Langkah-langkah

### Step 1 — Buka Google Apps Script
1. Buka [script.google.com](https://script.google.com)
2. Klik **New Project**
3. Ganti nama project: `HRIS Hammielion - Form Karyawan`

### Step 2 — Buat Form (jalankan sekali)
1. Di editor, hapus kode yang ada
2. Copy-paste isi file `1_buatForm.gs`
3. Klik **Run** → pilih fungsi `buatFormKaryawan`
4. Izinkan akses Google yang diminta
5. **Catat link form** yang muncul di Logger → ini yang dibagikan ke karyawan

### Step 3 — Setup script submit
1. Klik ikon **+** di sidebar kiri untuk tambah file baru
2. Beri nama `submitKeSupabase`
3. Copy-paste isi file `2_submitKeSupabase.gs`
4. Kode Supabase sudah terisi otomatis, tidak perlu diubah

### Step 4 — Buat Trigger otomatis
1. Klik ikon **jam** (Triggers) di sidebar kiri
2. Klik **+ Add Trigger** (pojok kanan bawah)
3. Setting:
   - **Function**: `onFormSubmit`
   - **Event source**: `From form`
   - **Event type**: `On form submit`
   - **Form**: pilih form yang baru dibuat
4. Klik **Save**

### Step 5 — Test
1. Buka `2_submitKeSupabase.gs`
2. Klik Run → `testCariKaryawan`
3. Cek Logger apakah karyawan ditemukan

### Step 6 — Bagikan form ke karyawan
- Bagikan **link form** (dari Step 2) ke semua karyawan
- Setiap submit otomatis masuk ke Supabase

---

## Cara Kerja
```
Karyawan isi form
       ↓
Google Form submit
       ↓
Apps Script cari nama di Supabase
       ↓
Ditemukan? → Update data karyawan
Tidak? → Email notifikasi ke HR
       ↓
HR cek data di sistem HRIS
```

## ⚠️ Penting
- Nama di form harus **sama persis** dengan nama di sistem HRIS
- Pastikan karyawan sudah terdaftar di HRIS sebelum isi form
- HR akan dapat email notifikasi setiap ada yang submit
