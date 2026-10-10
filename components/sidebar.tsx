'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient, setPreviewMode, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'
import { fetchAlphaAlerts as fetchAlphaAlertsShared } from '@/lib/alphaDetection'
import { fetchOvertimeClaimAlerts as fetchOvertimeClaimAlertsShared } from '@/lib/overtimeClaim'
import { getUpcomingRosterPeriod, DAYOFF_PICK_QUOTA } from '@/lib/rosterPeriod'
import { localDateStr } from '@/lib/date'

// Jatah tanggal yang bisa diajukan di Ajukan Libur per periode roster (badge sidebar) -- HARUS
// sama dengan LEAVE_QUOTA_PER_PERIOD di AlphaKlarifikasiPanel (hak libur Slip Gaji).
const DAYOFF_QUOTA_PER_PERIOD = DAYOFF_PICK_QUOTA

type NavNode = {
  name: string
  href: string
  icon?: string
  submenu?: NavNode[]
}

// Cek aktif lewat leaf href sesungguhnya (rekursif ke dalam submenu), bukan prefix item.href —
// beberapa grup top-level sekarang berbagi prefix URL yang sama (mis. Keuangan & Laporan
// Keuangan sama-sama /keuangan/*), jadi prefix-match di level grup saja bisa salah kena dua grup.
function hasActiveDescendant(item: NavNode, pathname: string): boolean {
  if (item.submenu && item.submenu.length > 0) {
    return item.submenu.some(sub => hasActiveDescendant(sub, pathname))
  }
  // Match persis, sama seperti highlight leaf-link yang sudah ada di render (bukan prefix) —
  // supaya /keuangan/pembelian (Ringkasan, grup Laporan Keuangan) tidak ikut ke-anggap aktif
  // saat di /keuangan/pembelian/input (grup Keuangan), dua rute beda yang kebetulan mirip.
  return pathname === item.href
}

// Portal Saya milik admin (Owner/HR/Finance). Menu karyawan punya susunan sendiri (lihat
// EMPLOYEE_PORTAL_SAYA dan grup-grup di bawahnya).
const PORTAL_SAYA_SUBMENU_BASE: NavNode[] = [
  { name: 'Dashboard Saya', href: '/portal' },
  { name: 'Klarifikasi Alpha', href: '/portal/alpha' },
  { name: 'Klaim Lembur', href: '/portal/lembur' },
  { name: 'Profil Saya', href: '/portal/profil' },
  { name: 'Slip Gaji', href: '/portal/slip-gaji' },
  { name: 'Rekap Absensi', href: '/portal/absensi' },
  { name: 'Jadwal Saya', href: '/portal/jadwal' },
  { name: 'Ajukan Libur', href: '/portal/ajukan-libur' },
  { name: 'Ganti Hari Libur', href: '/portal/ganti-libur' },
  { name: 'Kalender Libur', href: '/absensi/kalender-libur' },
]

// Menu karyawan dikelompokkan per kebutuhan (permintaan Owner, Okt 2026): Portal Saya cuma
// data & absensi pribadi; urusan uang, libur, pekerjaan harian, dan logistik masing-masing
// punya grup sendiri — supaya sidebar tidak lagi berisi belasan item sejajar.
const EMPLOYEE_PORTAL_SAYA: NavNode[] = [
  { name: 'Profil Saya', href: '/portal/profil' },
  { name: 'Jadwal Saya', href: '/portal/jadwal' },
  { name: 'Rekap Absensi', href: '/portal/absensi' },
  { name: 'Klarifikasi Alpha', href: '/portal/alpha' },
  { name: 'Klaim Lembur', href: '/portal/lembur' },
]

// "Pendapatan Ritase" cuma relevan untuk Driver/Kenek (gajinya lewat ritase, bukan cuma Slip Gaji).
function buildGajiKasbonSubmenu(isDriverOrKenek: boolean): NavNode[] {
  return [
    { name: 'Slip Gaji', href: '/portal/slip-gaji' },
    ...(isDriverOrKenek ? [{ name: 'Pendapatan Ritase', href: '/portal/pendapatan-ritase' }] : []),
    { name: 'Kasbon', href: '/kasbon' },
    { name: 'Aturan Potongan Gaji', href: '/potongan' },
  ]
}

// Semua yang berhubungan dengan "tidak masuk kerja" digabung di sini (Kalender Libur sengaja
// top-level sendiri di menu karyawan, supaya gampang dicek tanpa membuka grup).
const CUTI_LIBUR_SUBMENU: NavNode[] = [
  { name: 'Ajukan Cuti / Izin', href: '/cuti/ajukan' },
  { name: 'Riwayat Cuti & Izin', href: '/cuti' },
  { name: 'Ajukan Libur', href: '/portal/ajukan-libur' },
  { name: 'Ganti Hari Libur', href: '/portal/ganti-libur' },
]

const PEKERJAAN_SUBMENU: NavNode[] = [
  { name: 'Tugas & Laporan', href: '/tugas-harian' },
  { name: 'Catatan Meeting', href: '/catatan-meeting' },
  { name: 'Target Penjualan Promo', href: '/penjualan-promo' },
]

// Dipakai bareng oleh adminNavItems DAN getEmployeeNavItems (untuk Kepala Gudang, yang
// role sistemnya tetap 'employee' biasa) — supaya menunya selalu identik, tidak ada risiko
// salah satu ketinggalan diupdate kalau ada perubahan di lain waktu.
const LOGISTIK_SUBMENU: NavNode[] = [
  { name: 'Dashboard Pengiriman', href: '/logistik/dashboard' },
  { name: 'Surat Jalan', href: '/logistik/surat-jalan' },
  { name: 'Rencana Pengiriman', href: '/logistik/rencana' },
  { name: 'Jalankan Pengiriman', href: '/logistik/jalan' },
  { name: 'Laporan Pengiriman', href: '/logistik/laporan' },
  { name: 'Master Toko', href: '/logistik/toko' },
  { name: 'Laporan Muat (Cabang)', href: '/logistik/laporan-muat' },
  { name: 'Kirim Barang (Cabang)', href: '/logistik/kirim-barang' },
  { name: 'Order Grooming', href: '/logistik/grooming' },
  { name: 'Penerimaan Retur', href: '/logistik/penerimaan-retur' },
  { name: 'Kiriman Tertunda', href: '/logistik/tertunda' },
]

// Menu untuk HR, Owner, Finance, Supervisor — dikelompokkan jadi 4 kelompok besar (SDM/HR,
// Operasional, Keuangan, Penggajian) atas permintaan Owner, supaya menu yang tadinya flat
// (13+ item sejajar) lebih gampang ditelusuri. Item lintas-kelompok (Dashboard, Laporan,
// Catatan Meeting, Manajemen User) sengaja TIDAK dipaksa masuk salah satu kelompok.
const adminNavItems: NavNode[] = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  // Laporan Kasir = pekerjaan toko (diisi kasir), sengaja menu sendiri -- bukan bagian Operasional
  // kantor. Verifikasinya tetap di Operasional → Verifikasi Keuangan → Laporan Kasir.
  { name: 'Laporan Kasir', href: '/laporan-kasir', icon: '🧾' },
  // Owner/HR/Finance juga karyawan (punya employee_id sendiri) — bukan cuma pengelola sistem.
  // Grup ini kasih mereka akses ke data pribadi sendiri (profil, slip gaji, absensi, jadwal),
  // sama seperti yang dilihat karyawan biasa di menu "Portal Saya".
  {
    name: 'Portal Saya',
    href: '/portal',
    icon: '👤',
    submenu: PORTAL_SAYA_SUBMENU_BASE
  },
  { name: 'Kinerja Saya', href: '/portal/kpi-saya', icon: '📊' },
  { name: 'Panduan Karyawan', href: '/panduan', icon: '📖' },
  {
    name: 'SDM / HR',
    href: '/karyawan',
    icon: '👥',
    submenu: [
      { name: 'Karyawan', href: '/karyawan' },
      { name: 'Undang Karyawan Baru', href: '/karyawan/undang' },
      { name: 'Promosi Training', href: '/karyawan/promosi-training' },
      {
        name: 'Rekrutmen',
        href: '/rekrutmen',
        submenu: [
          { name: 'Pengaturan & QR', href: '/rekrutmen' },
          { name: 'Daftar Pelamar', href: '/rekrutmen/pelamar' },
        ]
      },
      {
        name: 'Absensi',
        href: '/absensi',
        submenu: [
          { name: 'Jadwal Kerja', href: '/absensi/jadwal' },
          { name: 'Penugasan Shift', href: '/absensi/shift' },
          { name: 'Jadwal Shift Cabang', href: '/absensi/shift-cabang' },
          { name: 'Rekap Absensi', href: '/absensi/rekap' },
          { name: 'Import Absensi', href: '/absensi/import' },
          { name: 'QR Absen', href: '/absensi/qr' },
          { name: 'Persetujuan Libur', href: '/absensi/persetujuan-libur' },
        ]
      },
      { name: 'Cuti & Izin', href: '/cuti' },
      { name: 'Tugas & Laporan', href: '/tugas-harian' },
      { name: 'Target Penjualan Promo', href: '/penjualan-promo' },
      { name: 'Aturan Potongan Gaji', href: '/potongan' },
      {
        name: 'KPI',
        href: '/kpi',
        submenu: [
          { name: 'Dashboard KPI', href: '/kpi' },
          { name: 'Setup Kriteria', href: '/kpi/setup' },
        ]
      },
      { name: 'Ranking Disiplin', href: '/ranking' },
      {
        name: 'Setup Cabang & Jabatan',
        href: '/cabang',
        submenu: [
          { name: 'Cabang', href: '/cabang' },
          { name: 'Jabatan', href: '/jabatan' },
        ]
      },
    ]
  },
  {
    name: 'Operasional',
    href: '/keuangan/kas-masuk',
    icon: '💵',
    submenu: [
      {
        name: 'Kas Masuk',
        href: '/keuangan/kas-masuk',
        submenu: [
          { name: 'Input Kasir Darurat', href: '/keuangan/kas-masuk' },
          { name: 'HPP & Omset (Sistem)', href: '/keuangan/hpp' },
        ]
      },
      {
        name: 'Kas Keluar',
        href: '/keuangan/kas-keluar',
        submenu: [
          { name: 'Input Kas Keluar', href: '/keuangan/kas-keluar' },
          { name: 'Kategori Kas Keluar', href: '/keuangan/kategori' },
          { name: 'Biaya Tetap Berkala', href: '/keuangan/biaya-tetap' },
        ]
      },
      { name: 'Pembelian & Utang Supplier', href: '/keuangan/pembelian/input' },
      { name: 'Petty Cash', href: '/keuangan/petty-cash' },
      {
        name: 'Modal & Aset',
        href: '/keuangan/modal',
        submenu: [
          { name: 'Modal Cabang', href: '/keuangan/modal' },
          { name: 'Aset & Kontrak Sewa', href: '/keuangan/aset' },
        ]
      },
      { name: 'Verifikasi Keuangan', href: '/keuangan/approval' },
      { name: 'Logistik', href: '/keuangan/logistik' },
      {
        name: 'Setup Kas & Supplier',
        href: '/keuangan/rekening',
        submenu: [
          { name: 'Setup Kas & Rekening', href: '/keuangan/rekening' },
          { name: 'Master Supplier', href: '/keuangan/pembelian/supplier' },
        ]
      },
    ]
  },
  {
    name: 'Keuangan',
    href: '/keuangan/dashboard',
    icon: '📈',
    submenu: [
      { name: 'Dashboard Keuangan', href: '/keuangan/dashboard' },
      { name: 'Detail Laporan per Cabang', href: '/keuangan/laporan/detail' },
      { name: 'Cash Flow per Rekening', href: '/keuangan/cashflow' },
      { name: 'Laporan Resmi', href: '/keuangan/laporan' },
      { name: 'Buku Piutang', href: '/keuangan/piutang' },
      { name: 'Ringkasan Supplier', href: '/keuangan/pembelian' },
      { name: 'Riwayat Kas Keluar', href: '/keuangan/riwayat' },
      { name: 'Kasbon', href: '/kasbon' },
    ]
  },
  {
    name: 'Pengiriman Logistik',
    href: '/logistik/toko',
    icon: '🚚',
    submenu: LOGISTIK_SUBMENU
  },
  {
    name: 'Penggajian',
    href: '/penggajian/bulanan',
    icon: '💰',
    submenu: [
      { name: 'Gaji Staff', href: '/penggajian/bulanan' },
      { name: 'Ringkasan Owner', href: '/penggajian/ringkasan' },
      { name: 'Gaji Driver', href: '/penggajian/driver' },
      { name: 'Gajian Bongkar Muat', href: '/penggajian/borongan' },
      { name: 'Tabungan Loyalitas', href: '/penggajian/loyalitas' },
      { name: 'Bonus Kinerja', href: '/penggajian/bonus' },
      {
        name: 'Kehilangan & Kasir',
        href: '/penggajian/kehilangan/barang',
        submenu: [
          { name: 'Kehilangan Barang', href: '/penggajian/kehilangan/barang' },
          { name: 'Kerugian Kasir', href: '/penggajian/kehilangan/kasir' },
        ]
      },
      {
        name: 'Setup Gaji & Tarif',
        href: '/penggajian/komponen',
        submenu: [
          { name: 'Komponen Gaji', href: '/penggajian/komponen' },
          { name: 'Bonus Kondisional', href: '/penggajian/bonus-kondisional' },
          { name: 'Tarif & Mobil Driver', href: '/penggajian/driver/setup' },
          { name: 'Pekerja Lepas', href: '/penggajian/borongan/pekerja' },
          { name: 'Tarif Bongkar Muat', href: '/penggajian/borongan/tarif' },
        ]
      },
    ]
  },
  { name: 'Catatan Meeting', href: '/catatan-meeting', icon: '📝' },
  { name: 'Manajemen User', href: '/users', icon: '🔑' },
]

// Menu untuk Karyawan (employee/supervisor) — sengaja TIDAK menyertakan Keuangan: RLS di
// database sudah menolak akses role employee ke semua tabel fin_*/supplier_purchases, jadi
// menampilkan menunya di sini cuma bikin karyawan buka halaman kosong tanpa penjelasan.
// Grup "Logistik" disusun per karyawan (jabatan/cabang, bukan role — Driver/Kenek & staf toko
// di tabel users tetap ber-role 'employee' biasa) dan cuma muncul kalau ada isinya.
function getEmployeeNavItems(isDriverOrKenek: boolean, isKepalaGudang: boolean, isReturRecipient: boolean, isStoreBranchStaff: boolean, canManageSuratJalan = false, canCashierReport = false): NavNode[] {
  const items: NavNode[] = [
    { name: 'Dashboard Saya', href: '/portal', icon: '🏠' },
    // Laporan Kasir: karyawan cabang toko selain Driver/Kepala Gudang/Helper (migrasi 096).
    ...(canCashierReport ? [{ name: 'Laporan Kasir', href: '/laporan-kasir', icon: '🧾' }] : []),
    { name: 'Portal Saya', href: '/portal/profil', icon: '👤', submenu: EMPLOYEE_PORTAL_SAYA },
    { name: 'Kinerja Saya', href: '/portal/kpi-saya', icon: '📊' },
    { name: 'Kalender Libur', href: '/absensi/kalender-libur', icon: '📅' },
    { name: 'Panduan Karyawan', href: '/panduan', icon: '📖' },
    { name: 'Gaji & Kasbon', href: '/portal/slip-gaji', icon: '💰', submenu: buildGajiKasbonSubmenu(isDriverOrKenek) },
    { name: 'Cuti & Libur', href: '/cuti', icon: '🗓️', submenu: CUTI_LIBUR_SUBMENU },
    { name: 'Pekerjaan', href: '/tugas-harian', icon: '📋', submenu: PEKERJAAN_SUBMENU },
  ]

  // Kepala Gudang dapat submenu LENGKAP (sama seperti admin) karena dia yang bikin Rencana
  // Pengiriman & kelola Master Toko. Selain dia, isi grup disusun dari peran masing-masing —
  // tidak saling eksklusif (jarang, tapi Driver/Kenek bisa juga staf toko), jadi dicek
  // independen lalu dibuang yang dobel.
  let logistik: NavNode[]
  if (isKepalaGudang) {
    logistik = LOGISTIK_SUBMENU
  } else {
    logistik = []
    if (isDriverOrKenek) {
      // Cuma aplikasi lapangan — RLS di halaman itu sendiri sudah membatasi datanya ke
      // rencana milik driver/kenek yang bersangkutan.
      logistik.push({ name: 'Jalankan Pengiriman', href: '/logistik/jalan' })
      logistik.push({ name: 'Jemput Barang Cabang', href: '/logistik/jemput-toko-pusat' })
    }
    // Laporan Muat, Kirim Barang & Order Grooming: staf cabang toko (migrasi 068/070).
    if (isStoreBranchStaff) {
      logistik.push({ name: 'Laporan Muat', href: '/logistik/laporan-muat' })
      logistik.push({ name: 'Kirim Barang', href: '/logistik/kirim-barang' })
      logistik.push({ name: 'Order Grooming', href: '/logistik/grooming' })
    }
    // Surat Jalan: karyawan Back Office (migrasi 090).
    if (canManageSuratJalan) {
      logistik.push({ name: 'Surat Jalan', href: '/logistik/surat-jalan' })
    }
    // Penerimaan Retur: cuma karyawan yang cabangnya jadi tujuan retur (migrasi 081).
    if (isReturRecipient) {
      logistik.push({ name: 'Penerimaan Retur', href: '/logistik/penerimaan-retur' })
    }
    logistik = logistik.filter((n, i) => logistik.findIndex(m => m.href === n.href) === i)
  }
  if (logistik.length > 0) {
    items.push({ name: 'Logistik', href: logistik[0].href, icon: '🚚', submenu: logistik })
  }
  return items
}

type SidebarProps = {
  // null = ikuti perilaku bawaan (tampil >=768px, sembunyi di bawahnya).
  // true = paksa tampil (overlay di layar kecil, in-flow di layar besar).
  // false = paksa sembunyi total, di semua ukuran layar.
  forceOpen?: boolean | null
  onNavigate?: () => void
}

export default function Sidebar({ forceOpen = null, onNavigate }: SidebarProps) {
  const pathname = usePathname()
  const supabase = createClient()
  const [userRole, setUserRole] = useState<string>('hr')
  const [loadingRole, setLoadingRole] = useState(true)
  const [previewMode, setPreviewModeState] = useState(false)
  const [isDriverOrKenek, setIsDriverOrKenek] = useState(false)
  const [isKepalaGudang, setIsKepalaGudang] = useState(false)
  const [isReturRecipient, setIsReturRecipient] = useState(false)
  const [isStoreBranchStaff, setIsStoreBranchStaff] = useState(false)
  const [canManageSuratJalan, setCanManageSuratJalan] = useState(false)
  const [canCashierReport, setCanCashierReport] = useState(false)
  const [meetingBadge, setMeetingBadge] = useState(0)
  const [dailyTaskBadge, setDailyTaskBadge] = useState(0)
  // Angka merah di submenu Klarifikasi Alpha / Klaim Lembur / Ajukan Libur -- berapa banyak
  // yang BELUM diajukan (atau ditolak & perlu diajukan ulang), bukan jumlah total.
  const [alphaBadge, setAlphaBadge] = useState(0)
  const [lemburBadge, setLemburBadge] = useState(0)
  const [liburBadge, setLiburBadge] = useState(0)
  // Kirim Barang: kiriman yang ditugaskan ke saya & belum diambil + tugas antar saya yang belum
  // foto kembali (+ trip macet >6 jam utk Owner). Jemput Barang Cabang (driver): paket menunggu.
  const [kirimBarangBadge, setKirimBarangBadge] = useState(0)
  const [jemputBadge, setJemputBadge] = useState(0)
  // Order Grooming: kucing yang saya groom & belum selesai + kucing groomer tanpa akun di order
  // buatan saya (perlu Paksa Lanjut) + order buatan saya yang siap diserahkan (migrasi 070).
  const [groomingBadge, setGroomingBadge] = useState(0)
  // Kiriman Tertunda: Kirim Besok yang lewat 3 hari -- hanya untuk Owner (migrasi 088).
  const [tertundaBadge, setTertundaBadge] = useState(0)
  // Kiriman Gagal yang menunggu keputusan kantor / cabang asal (migrasi 090).
  const [keputusanBadge, setKeputusanBadge] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [kirim, jemput, groom, tunda, keputusan] = await Promise.all([
        supabase.rpc('get_tp_delivery_badge_count'),
        supabase.rpc('get_central_pickup_badge_count'),
        supabase.rpc('get_grooming_badge_count'),
        supabase.rpc('get_postponed_overdue_count'),
        supabase.rpc('get_failed_decision_count'),
      ])
      if (cancelled) return
      setKirimBarangBadge(Number(kirim.data) || 0)
      setJemputBadge(Number(jemput.data) || 0)
      setGroomingBadge(Number(groom.data) || 0)
      setTertundaBadge(Number(tunda.data) || 0)
      setKeputusanBadge(Number(keputusan.data) || 0)
    }
    load()
    const timer = setInterval(load, 60000)
    window.addEventListener('kirim-barang-badge-refresh', load)
    window.addEventListener('grooming-badge-refresh', load)
    return () => {
      cancelled = true; clearInterval(timer)
      window.removeEventListener('kirim-barang-badge-refresh', load)
      window.removeEventListener('grooming-badge-refresh', load)
    }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Angka merah di menu Catatan Meeting: catatan belum dibaca + tugas yang belum dilaporkan
  // (karyawan), atau laporan yang menunggu review (Owner/HR). Dihitung di server.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase.rpc('get_meeting_badge_count')
      if (!cancelled && data) setMeetingBadge(Number((data as { total: number }).total) || 0)
    }
    load()
    const timer = setInterval(load, 60000)
    window.addEventListener('meeting-badge-refresh', load)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('meeting-badge-refresh', load) }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Angka merah di menu Tugas & Laporan: tugas harian yang belum dilapor hari ini + tugas
  // sekali yang belum pernah dilapor. Berlaku untuk siapa saja yang punya employee_id
  // (termasuk Owner/HR kalau mereka sendiri ditugaskan).
  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase.rpc('get_daily_task_badge_count')
      if (!cancelled && data != null) setDailyTaskBadge(Number(data) || 0)
    }
    load()
    const timer = setInterval(load, 60000)
    window.addEventListener('daily-task-badge-refresh', load)
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('daily-task-badge-refresh', load) }
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const previewOn = isPreviewModeClient()
    setPreviewModeState(previewOn)
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('users').select('role, employee_id').eq('id', user.id).single().then(({ data }) => {
        if (data) {
          setUserRole(data.role)
          // Preview Tampilan Karyawan menampilkan data Portal Saya (Slip Gaji, dst.) memakai
          // PREVIEW_EMPLOYEE_ID (lihat lib/previewMode.ts), BUKAN employee_id akun admin yang
          // sedang login — sebelumnya menu sidebar ini tidak ikut aturan itu, jadi struktur
          // menunya (mis. tab Laporan Muat/Jemput Toko Pusat) tidak nyambung dgn isi halaman
          // Portal yang sedang di-preview. Disamakan di sini supaya preview representatif.
          const realIsAdminNow = !['employee', 'supervisor'].includes(data.role)
          const effectiveEmployeeId = (realIsAdminNow && previewOn) ? PREVIEW_EMPLOYEE_ID : data.employee_id
          if (effectiveEmployeeId) {
            // Tiga angka badge submenu Portal Saya / Cuti & Izin -- dihitung terpisah dari
            // query driver/kenek di bawah supaya satu query gagal/lambat tidak ikut menahan
            // yang lain (independen, bukan chained).
            Promise.all([
              fetchAlphaAlertsShared(supabase, effectiveEmployeeId),
              fetchOvertimeClaimAlertsShared(supabase, effectiveEmployeeId),
              supabase.rpc('get_dayoff_quota_status', { p_period_start: localDateStr(getUpcomingRosterPeriod().start) }),
            ]).then(([alphaAlerts, overtimeAlerts, quotaRes]) => {
              setAlphaBadge(alphaAlerts.filter(a => a.actionable).length)
              setLemburBadge(overtimeAlerts.filter(a => a.actionable).length)
              const rows = (quotaRes.data || []) as { employee_id: string; approved_count: number; pending_count: number }[]
              const mine = rows.find(r => r.employee_id === effectiveEmployeeId)
              // Sama seperti app/(dashboard)/dashboard/page.tsx: kalau RPC tidak mengembalikan
              // baris untuk karyawan ini (mis. belum punya roster periode ini), anggap sudah
              // lengkap (bukan dianggap belum ajukan sama sekali) -- supaya tidak salah
              // menakuti karyawan yang jatah liburnya belum relevan sama sekali.
              const submitted = mine ? mine.approved_count + mine.pending_count : DAYOFF_QUOTA_PER_PERIOD
              setLiburBadge(Math.max(0, DAYOFF_QUOTA_PER_PERIOD - submitted))
            })
            supabase.from('employees').select('employee_type, can_drive, can_help, branch_id, departments(name), positions(name)').eq('id', effectiveEmployeeId).single().then(({ data: emp }) => {
              if (emp) {
                // Driver "asli" (employee_type='driver') belum tentu punya can_drive=true —
                // kolom itu dibuat belakangan khusus untuk menandai karyawan LAIN yang bisa
                // merangkap jadi driver, bukan buat driver aslinya sendiri. Samakan syaratnya
                // dengan dropdown pemilihan driver di logistik/rencana (.or('employee_type.eq.
                // driver,can_drive.eq.true')) supaya driver asli tidak kelewat di sidebar.
                // Kenek/helper permanen di Team Gudang JUGA otomatis dianggap kenek di halaman
                // lain (dropdown Kenek di Rencana Pengiriman, Kasbon Kenek) tanpa perlu
                // can_help=true — sebelumnya sidebar ini TIDAK ikut mengecek departemen sama
                // sekali, jadi Helper Gudang biasa (can_help masih false) tidak lolos di sini
                // walau sudah lolos di halaman lain (kasus nyata: Riki Yusdinar Pahas).
                const dept = Array.isArray((emp as any).departments) ? (emp as any).departments[0] : (emp as any).departments
                setIsDriverOrKenek(emp.employee_type === 'driver' || !!emp.can_drive || !!emp.can_help || dept?.name === 'Team Gudang')
                setIsKepalaGudang((emp as any).positions?.name === 'Kepala Gudang')
                // Surat Jalan: semua karyawan Back Office (+ Kepala Gudang/Owner), migrasi 090.
                supabase.rpc('can_manage_delivery_notes').then(({ data: ok }) => setCanManageSuratJalan(!!ok))
                supabase.rpc('get_my_cashier_report_branches').then(({ data: br }) => setCanCashierReport(Array.isArray(br) && br.length > 0))
                if (emp.branch_id) {
                  supabase.from('logistics_store_branches').select('branch_id').eq('branch_id', emp.branch_id).maybeSingle()
                    .then(({ data: sb }) => setIsStoreBranchStaff(!!sb))
                  // Penerimaan Retur cuma untuk cabang yang pernah/sedang jadi tujuan retur --
                  // syarat yang sama dipakai halaman /logistik/penerimaan-retur.
                  supabase.from('logistics_store_returns').select('id', { count: 'exact', head: true })
                    .eq('recipient_branch_id', emp.branch_id)
                    .then(({ count }) => setIsReturRecipient((count ?? 0) > 0))
                }
              }
            })
          }
        }
        setLoadingRole(false)
      })
    })
  }, [])

  // realIsAdmin = role sungguhan (bukan lagi preview) — dipakai untuk tampilkan/sembunyikan
  // tombol toggle preview itu sendiri, supaya karyawan asli tidak bisa iseng balik ke menu admin.
  const realIsAdmin = !['employee', 'supervisor'].includes(userRole)
  const isEmployee = ['employee', 'supervisor'].includes(userRole) || (realIsAdmin && previewMode)
  const navItems = isEmployee ? getEmployeeNavItems(isDriverOrKenek, isKepalaGudang, isReturRecipient, isStoreBranchStaff, canManageSuratJalan, canCashierReport) : adminNavItems

  // Angka merah di submenu (beda dari meetingBadge/dailyTaskBadge yang nempel di item
  // top-level) -- dicocokkan lewat href, bukan nama, supaya tetap ketemu walau labelnya
  // beda posisi (Klarifikasi Alpha, Klaim Lembur, Ajukan Libur, dst.).
  // Catatan Meeting & Tugas & Laporan ikut di sini karena di menu karyawan keduanya ada di
  // dalam grup Pekerjaan (di menu admin tetap top-level, badge-nya lewat render di bawah).
  const subBadgeByHref: Record<string, number> = {
    '/portal/alpha': alphaBadge,
    '/portal/lembur': lemburBadge,
    '/portal/ajukan-libur': liburBadge,
    '/logistik/kirim-barang': kirimBarangBadge,
    '/logistik/grooming': groomingBadge,
    '/logistik/jemput-toko-pusat': jemputBadge,
    '/logistik/tertunda': tertundaBadge,
    // Kantor melihatnya di Surat Jalan; staf cabang di Laporan Muat (hanya cabangnya).
    '/logistik/surat-jalan': keputusanBadge,
    '/logistik/laporan-muat': isStoreBranchStaff ? keputusanBadge : 0,
    '/catatan-meeting': meetingBadge,
    '/tugas-harian': dailyTaskBadge,
  }
  // Grup yang sedang tertutup menampilkan total angka merah isinya, supaya tugas yang
  // menunggu tetap kelihatan walau menunya dilipat.
  const groupBadge = (item: NavNode) =>
    (item.submenu || []).reduce((sum, sub) => sum + (sub.submenu ? 0 : subBadgeByHref[sub.href] || 0), 0)

  function togglePreview() {
    const next = !previewMode
    setPreviewMode(next)
    window.location.href = '/dashboard'
  }

  // Rute Operasional (Level-1 baru) & Keuangan (Level-1 baru, laporan/analisis) sama-sama di
  // bawah URL /keuangan/*, dan /keuangan/pembelian dipakai DUA rute berbeda (bare = ringkasan
  // supplier di grup Keuangan, /input & /supplier = catat di grup Operasional) — jadi keduanya
  // harus saling mengecualikan rute satu sama lain, supaya cuma satu yang auto-expand.
  const inKeuanganGroup = pathname.startsWith('/keuangan/dashboard') || pathname.startsWith('/keuangan/laporan')
    || pathname.startsWith('/keuangan/cashflow') || pathname.startsWith('/keuangan/riwayat') || pathname.startsWith('/keuangan/piutang')
    || pathname === '/keuangan/pembelian' || pathname.startsWith('/kasbon')

  // Kalender Libur secara URL ada di bawah /absensi/*, tapi menunya sengaja dipindah ke
  // grup Portal Saya / Cuti & Libur (bisa dilihat semua orang) — jadi dikecualikan dari trigger auto-expand
  // grup SDM/HR & Absensi supaya tidak salah expand grup yang tidak punya item aktif.
  const inKalenderLibur = pathname.startsWith('/absensi/kalender-libur')

  const defaultOpen: Record<string, boolean> = {
    'SDM / HR':   pathname.startsWith('/karyawan') || pathname.startsWith('/rekrutmen') || (pathname.startsWith('/absensi') && !inKalenderLibur)
      || pathname.startsWith('/cuti') || pathname.startsWith('/kpi') || pathname.startsWith('/ranking')
      || pathname.startsWith('/cabang') || pathname.startsWith('/jabatan'),
    'Rekrutmen':  pathname.startsWith('/rekrutmen'),
    'Absensi':    pathname.startsWith('/absensi') && !inKalenderLibur,
    'KPI':        pathname.startsWith('/kpi'),
    'Setup Cabang & Jabatan': pathname.startsWith('/cabang') || pathname.startsWith('/jabatan'),

    'Operasional': pathname.startsWith('/keuangan') && !inKeuanganGroup,
    'Kas Masuk':  pathname.startsWith('/keuangan/kas-masuk') || pathname.startsWith('/keuangan/hpp'),
    'Kas Keluar': pathname.startsWith('/keuangan/kas-keluar') || pathname.startsWith('/keuangan/kategori') || pathname.startsWith('/keuangan/biaya-tetap'),
    'Modal & Aset': pathname.startsWith('/keuangan/modal') || pathname.startsWith('/keuangan/aset'),
    'Setup Kas & Supplier': pathname.startsWith('/keuangan/rekening') || pathname.startsWith('/keuangan/pembelian/supplier'),

    'Keuangan':   inKeuanganGroup,

    'Penggajian': pathname.startsWith('/penggajian'),
    'Kehilangan & Kasir': pathname.startsWith('/penggajian/kehilangan'),
    'Setup Gaji & Tarif': pathname.startsWith('/penggajian/komponen') || pathname.startsWith('/penggajian/driver/setup')
      || pathname.startsWith('/penggajian/borongan/pekerja') || pathname.startsWith('/penggajian/borongan/tarif')
      || pathname.startsWith('/penggajian/kehilangan/setup') || pathname.startsWith('/penggajian/bonus-kondisional'),

    'Portal Saya': pathname.startsWith('/portal') || inKalenderLibur,
    // Grup di bawah ini hanya ada di menu karyawan (lihat getEmployeeNavItems).
    'Gaji & Kasbon': pathname.startsWith('/portal/slip-gaji') || pathname.startsWith('/portal/pendapatan-ritase')
      || pathname.startsWith('/kasbon') || pathname.startsWith('/potongan'),
    'Cuti & Libur': pathname.startsWith('/cuti') || pathname.startsWith('/portal/ajukan-libur')
      || pathname.startsWith('/portal/ganti-libur'),
    'Pekerjaan': pathname.startsWith('/tugas-harian') || pathname.startsWith('/catatan-meeting') || pathname.startsWith('/penjualan-promo'),
    'Logistik': pathname.startsWith('/logistik'),
  }

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(defaultOpen)

  const toggleMenu = (name: string) => {
    setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // Sticky di layar besar: nempel di bawah navbar (top-16 = tinggi navbar 4rem) dan
  // punya scroll sendiri (overflow-y-auto + tinggi dibatasi), supaya menu tetap kelihatan
  // saat konten halaman di kanan di-scroll turun — sebelumnya cuma min-h jadi sidebar
  // ikut ter-scroll keluar bareng isi halaman.
  const asideClass = forceOpen === false
    ? 'hidden'
    : forceOpen === true
      ? 'block fixed left-0 top-16 bottom-0 z-40 w-64 bg-white border-r border-slate-200 overflow-y-auto flex-shrink-0 md:sticky md:left-auto md:bottom-auto md:z-0 md:h-[calc(100vh-4rem)]'
      : 'hidden md:block md:sticky md:top-16 w-64 bg-white border-r border-slate-200 flex-shrink-0 md:h-[calc(100vh-4rem)] md:overflow-y-auto'

  return (
    <aside className={asideClass}>
      {forceOpen === true && (
        <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Menu</span>
          <button onClick={onNavigate} aria-label="Tutup menu" className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div className="py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            // Grup dicek lewat leaf href-nya sendiri (rekursif), bukan prefix item.href —
            // beberapa grup (Keuangan vs Laporan Keuangan) sekarang berbagi prefix /keuangan/*
            // yang sama, jadi prefix-match saja bikin dua grup ke-highlight sekaligus.
            // "/portal" dipakai sebagai exact-match khusus di sini karena item leaf "Dashboard
            // Saya" berbagi persis href yang sama dengan root grup Portal Saya (lihat
            // employeeNavItems) — kalau pakai prefix-match biasa, item ini akan ikut ter-highlight
            // di SEMUA halaman /portal/* (Profil, Slip Gaji, dst.), bukan cuma saat benar-benar
            // di /portal.
            const isActive = ('submenu' in item && item.submenu)
              ? hasActiveDescendant(item, pathname)
              : item.href === '/portal' ? pathname === '/portal' : pathname.startsWith(item.href)

            return (
              <li key={item.name}>
                {'submenu' in item && item.submenu ? (
                  <div>
                    <button
                      onClick={() => toggleMenu(item.name)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{item.icon}</span>
                        {item.name}
                      </div>
                      {!openMenus[item.name] && groupBadge(item) > 0 && (
                        <span className="ml-auto mr-2 inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-xs font-bold">
                          {groupBadge(item) > 99 ? '99+' : groupBadge(item)}
                        </span>
                      )}
                      <svg
                        className={`w-4 h-4 shrink-0 transition-transform ${openMenus[item.name] ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {openMenus[item.name] && (
                      <ul className="mt-1 ml-9 space-y-1">
                        {item.submenu.map(sub => {
                          const subIsGroup = !!sub.submenu && sub.submenu.length > 0
                          const subIsActive = subIsGroup
                            ? sub.submenu!.some(leaf => pathname === leaf.href || pathname.startsWith(leaf.href + '/'))
                            : pathname === sub.href

                          if (!subIsGroup) {
                            const subBadge = subBadgeByHref[sub.href] || 0
                            return (
                              <li key={sub.name}>
                                <Link
                                  href={sub.href}
                                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                    subIsActive
                                      ? 'text-blue-700 font-medium bg-blue-50/50'
                                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                                  }`}
                                >
                                  {sub.name}
                                  {subBadge > 0 && (
                                    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold">
                                      {subBadge > 99 ? '99+' : subBadge}
                                    </span>
                                  )}
                                </Link>
                              </li>
                            )
                          }

                          return (
                            <li key={sub.name}>
                              <button
                                onClick={() => toggleMenu(sub.name)}
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                  subIsActive
                                    ? 'text-blue-700 font-medium bg-blue-50/50'
                                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                                }`}
                              >
                                {sub.name}
                                <svg
                                  className={`w-3.5 h-3.5 transition-transform ${openMenus[sub.name] ? 'rotate-180' : ''}`}
                                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                              </button>
                              {openMenus[sub.name] && (
                                <ul className="mt-1 ml-4 space-y-1">
                                  {sub.submenu!.map(leaf => (
                                    <li key={leaf.name}>
                                      <Link
                                        href={leaf.href}
                                        className={`block px-3 py-1.5 rounded-lg text-xs transition-colors ${
                                          pathname === leaf.href
                                            ? 'text-blue-700 font-medium bg-blue-50/50'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                                        }`}
                                      >
                                        {leaf.name}
                                      </Link>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ) : (
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    <span className="text-lg">{item.icon}</span>
                    {item.name}
                    {item.href === '/catatan-meeting' && meetingBadge > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-xs font-bold">
                        {meetingBadge > 99 ? '99+' : meetingBadge}
                      </span>
                    )}
                    {item.href === '/tugas-harian' && dailyTaskBadge > 0 && (
                      <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-600 text-white text-xs font-bold">
                        {dailyTaskBadge > 99 ? '99+' : dailyTaskBadge}
                      </span>
                    )}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Toggle Preview Tampilan Karyawan — cuma untuk admin sungguhan (bukan karyawan asli),
          supaya bisa cek menu/layout level karyawan tanpa perlu login-logout. Data di dalam
          halamannya tetap data akun sendiri (RLS tidak bisa dipalsukan dari client), cuma
          strukur menu & layout-nya yang berubah. */}
      {realIsAdmin && !loadingRole && (
        <div className="px-3 pb-4">
          {previewMode ? (
            <button onClick={togglePreview}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition">
              🔙 Keluar dari Preview Karyawan
            </button>
          ) : (
            <button onClick={togglePreview}
              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-xs font-medium text-slate-500 border border-dashed border-slate-300 hover:bg-slate-50 hover:text-slate-700 transition">
              👁️ Preview Tampilan Karyawan
            </button>
          )}
        </div>
      )}
    </aside>
  )
}
