// ============================================================
// HRIS HAMMIELION — Sidebar Navigation Structure
// ============================================================

export interface NavItem {
  label: string;
  icon: string;
  basePath: string;
  subs: { label: string; path: string }[];
}

export const NAV: NavItem[] = [
  {
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    basePath: '/dashboard',
    subs: [],
  },
  {
    label: 'Karyawan',
    icon: 'Users',
    basePath: '/karyawan',
    subs: [
      { label: 'Daftar Karyawan', path: '/karyawan' },
      { label: 'Tambah Karyawan', path: '/karyawan/tambah' },
    ],
  },
  {
    label: 'Absensi',
    icon: 'CalendarCheck',
    basePath: '/absensi',
    subs: [
      { label: 'Input Absensi', path: '/absensi/input' },
      { label: 'Rekap Bulanan', path: '/absensi/rekap' },
      { label: 'Jadwal Shift', path: '/absensi/jadwal' },
    ],
  },
  {
    label: 'Performa',
    icon: 'TrendingUp',
    basePath: '/performa',
    subs: [
      { label: 'Overview Performa', path: '/performa/overview' },
      { label: 'Kelola Indikator KPI', path: '/performa/kpi/kelola' },
      { label: 'Input Nilai KPI', path: '/performa/kpi/input' },
      { label: 'Laporan Kesalahan', path: '/performa/kesalahan' },
      { label: 'Riwayat Evaluasi', path: '/performa/riwayat' },
    ],
  },
  {
    label: 'Driver & Ritase',
    icon: 'Truck',
    basePath: '/driver',
    subs: [
      { label: 'Input Ritase Harian', path: '/driver/ritase' },
      { label: 'Rekap Ritase', path: '/driver/rekap' },
      { label: 'Gaji & Bonus Driver', path: '/driver/gaji' },
      { label: 'Performa Driver', path: '/driver/performa' },
    ],
  },
  {
    label: 'Penggajian',
    icon: 'Wallet',
    basePath: '/penggajian',
    subs: [
      { label: 'Proses Gaji', path: '/penggajian/proses' },
      { label: 'Slip Gaji', path: '/penggajian/slip' },
      { label: 'Rekap Gaji', path: '/penggajian/rekap' },
      { label: 'Minus Kasir', path: '/penggajian/potongan/minus-kasir' },
      { label: 'Kehilangan Barang', path: '/penggajian/potongan/kehilangan' },
    ],
  },
  {
    label: 'Cuti & Izin',
    icon: 'UmbrellaOff',
    basePath: '/cuti',
    subs: [
      { label: 'Pengajuan Cuti', path: '/cuti/pengajuan' },
      { label: 'Riwayat Cuti', path: '/cuti/riwayat' },
    ],
  },
  {
    label: 'Laporan',
    icon: 'FileBarChart',
    basePath: '/laporan',
    subs: [
      { label: 'Laporan Absensi', path: '/laporan/absensi' },
      { label: 'Laporan Gaji', path: '/laporan/gaji' },
      { label: 'Laporan Performa', path: '/laporan/performa' },
      { label: 'Laporan Driver', path: '/laporan/driver' },
    ],
  },
  {
    label: 'Pengaturan',
    icon: 'Settings',
    basePath: '/pengaturan',
    subs: [
      { label: 'Komponen Gaji', path: '/pengaturan/komponen-gaji' },
      { label: 'Jadwal & Shift', path: '/pengaturan/jadwal-shift' },
      { label: 'Aturan Kerja', path: '/pengaturan/aturan-kerja' },
      { label: 'Master Ritase', path: '/pengaturan/master-ritase' },
      { label: 'User & Akses', path: '/pengaturan/user-akses' },
    ],
  },
];
