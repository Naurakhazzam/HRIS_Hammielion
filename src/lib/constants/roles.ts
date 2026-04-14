// ============================================================
// HRIS HAMMIELION — Role & Access Control
// ============================================================

export type UserRole = 'owner' | 'admin_hr' | 'manager' | 'karyawan';

export const ROLES: Record<UserRole, { label: string; color: string }> = {
  owner:    { label: 'Owner',    color: '#7C3AED' },
  admin_hr: { label: 'Admin HR', color: '#0D9488' },
  manager:  { label: 'Manager',  color: '#2563EB' },
  karyawan: { label: 'Karyawan', color: '#64748B' },
};

// Halaman yang bisa diakses per role
export const ROLE_ACCESS: Record<UserRole, string[]> = {
  owner: ['*'], // semua akses
  admin_hr: [
    '/dashboard', '/karyawan', '/absensi', '/performa',
    '/driver', '/penggajian', '/cuti', '/laporan', '/pengaturan',
  ],
  manager: [
    '/dashboard', '/karyawan', '/absensi/rekap',
    '/performa/overview', '/laporan',
  ],
  karyawan: [
    '/dashboard', '/absensi/input', '/performa/overview',
    '/penggajian/slip', '/cuti/pengajuan', '/cuti/riwayat',
  ],
};

export const JABATAN_LIST = [
  'Kasir',
  'Helper',
  'Groomer',
  'Driver',
  'Kenek',
  'Back Office',
  'Supervisor',
  'Manager Toko',
] as const;

export type Jabatan = (typeof JABATAN_LIST)[number];

export const DIVISI_LIST = [
  'Back Office',
  'Staff Toko',
  'Operasional',
] as const;

export type Divisi = (typeof DIVISI_LIST)[number];

export const STATUS_KARYAWAN = [
  'Aktif',
  'Probasi',
  'Kontrak',
  'Nonaktif',
  'Resign',
  'PHK',
] as const;

export type StatusKaryawan = (typeof STATUS_KARYAWAN)[number];

/** Mapping jabatan → divisi (otomatis saat input form) */
export const DIVISI_MAP: Record<string, string> = {
  Kasir:        'Staff Toko',
  Helper:       'Staff Toko',
  Groomer:      'Staff Toko',
  Driver:       'Operasional',
  Kenek:        'Operasional',
  'Back Office':'Back Office',
  Supervisor:   'Back Office',
  'Manager Toko':'Back Office',
};

export const CABANG_LIST = [
  'Cabang 1',
  'Cabang 2',
  'Cabang 3',
  'Cabang 4',
  'Cabang 5',
] as const;

export type Cabang = (typeof CABANG_LIST)[number];
