'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { isPreviewModeClient, setPreviewMode, PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

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

// Dipakai bareng oleh adminNavItems DAN getEmployeeNavItems — supaya isinya selalu identik,
// tidak ada risiko salah satu ketinggalan diupdate kalau ada perubahan di lain waktu.
// "Pendapatan Ritase" disisipkan lewat buildPortalSayaSubmenu (bukan ditulis statis di sini)
// karena cuma relevan untuk Driver/Kenek.
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
  { name: 'KPI Saya', href: '/portal/kpi-saya' },
]

function buildPortalSayaSubmenu(isDriverOrKenek: boolean): NavNode[] {
  if (!isDriverOrKenek) return PORTAL_SAYA_SUBMENU_BASE
  // Disisip persis setelah "Slip Gaji" — sama-sama halaman penghasilan, biar ketemu berdekatan.
  const withEarnings = [...PORTAL_SAYA_SUBMENU_BASE]
  withEarnings.splice(5, 0, { name: 'Pendapatan Ritase', href: '/portal/pendapatan-ritase' })
  return withEarnings
}

// Dipakai bareng oleh adminNavItems DAN getEmployeeNavItems (untuk Kepala Gudang, yang
// role sistemnya tetap 'employee' biasa) — supaya menunya selalu identik, tidak ada risiko
// salah satu ketinggalan diupdate kalau ada perubahan di lain waktu.
const LOGISTIK_SUBMENU: NavNode[] = [
  { name: 'Dashboard Pengiriman', href: '/logistik/dashboard' },
  { name: 'Rencana Pengiriman', href: '/logistik/rencana' },
  { name: 'Jalankan Pengiriman', href: '/logistik/jalan' },
  { name: 'Laporan Pengiriman', href: '/logistik/laporan' },
  { name: 'Master Toko', href: '/logistik/toko' },
  { name: 'Laporan Muat (Toko Pusat)', href: '/logistik/laporan-muat' },
]

// Menu untuk HR, Owner, Finance, Supervisor — dikelompokkan jadi 4 kelompok besar (SDM/HR,
// Operasional, Keuangan, Penggajian) atas permintaan Owner, supaya menu yang tadinya flat
// (13+ item sejajar) lebih gampang ditelusuri. Item lintas-kelompok (Dashboard, Laporan,
// Catatan Meeting, Manajemen User) sengaja TIDAK dipaksa masuk salah satu kelompok.
const adminNavItems: NavNode[] = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { name: 'Panduan Karyawan', href: '/panduan', icon: '📖' },
  // Owner/HR/Finance juga karyawan (punya employee_id sendiri) — bukan cuma pengelola sistem.
  // Grup ini kasih mereka akses ke data pribadi sendiri (profil, slip gaji, absensi, jadwal),
  // sama seperti yang dilihat karyawan biasa di menu "Portal Saya".
  {
    name: 'Portal Saya',
    href: '/portal',
    icon: '👤',
    submenu: PORTAL_SAYA_SUBMENU_BASE
  },
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
          { name: 'Omzet Harian', href: '/keuangan/kas-masuk' },
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
// "Pengiriman Logistik" disisipkan lewat getEmployeeNavItems (bukan di sini) karena cuma
// boleh muncul untuk karyawan yang Driver/Kenek (employees.can_drive/can_help) — bukan
// berdasarkan role, karena Driver/Kenek di tabel users tetap ber-role 'employee' biasa.
const employeeNavItems: NavNode[] = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { name: 'Panduan Karyawan', href: '/panduan', icon: '📖' },
  {
    name: 'Portal Saya',
    href: '/portal',
    icon: '👤',
    submenu: PORTAL_SAYA_SUBMENU_BASE
  },
  { name: 'Catatan Meeting', href: '/catatan-meeting', icon: '📝' },
  { name: 'Tugas & Laporan', href: '/tugas-harian', icon: '📋' },
  { name: 'Target Penjualan Promo', href: '/penjualan-promo', icon: '🎯' },
  { name: 'Cuti & Izin', href: '/cuti', icon: '🗓️' },
  { name: 'Aturan Potongan Gaji', href: '/potongan', icon: '📉' },
  { name: 'Kasbon', href: '/kasbon', icon: '🏦' },
]

function getEmployeeNavItems(isDriverOrKenek: boolean, isKepalaGudang: boolean, isTokoPusat: boolean): NavNode[] {
  // "Pendapatan Ritase" (submenu Portal Saya) cuma relevan buat Driver/Kenek -- item dasarnya
  // (index 0,1) tetap dipakai apa adanya, cuma Portal Saya (index 2) yang dibangun ulang di sini.
  const baseItems = [
    employeeNavItems[0], employeeNavItems[1],
    { ...employeeNavItems[2], submenu: buildPortalSayaSubmenu(isDriverOrKenek) },
    ...employeeNavItems.slice(3),
  ]

  // Kepala Gudang dapat submenu LENGKAP (sama seperti admin) karena dia yang bikin Rencana
  // Pengiriman & kelola Master Toko — bukan cuma jalankan trip seperti driver/kenek. Dicek
  // duluan sebelum isDriverOrKenek supaya kalau kebetulan Kepala Gudang juga ditandai
  // can_drive/can_help, dia tetap dapat menu lengkap, bukan cuma link tunggal.
  if (isKepalaGudang) {
    return [
      ...baseItems.slice(0, 3),
      { name: 'Pengiriman Logistik', href: '/logistik/toko', icon: '🚚', submenu: LOGISTIK_SUBMENU },
      ...baseItems.slice(3),
    ]
  }
  // Driver/Kenek & Team Toko Pusat bukan posisi yang saling eksklusif (jarang, tapi bisa
  // keduanya) — jadi link masing-masing disisipkan independen, bukan if/else berantai.
  const extraLinks: NavNode[] = []
  if (isDriverOrKenek) {
    // Disisip setelah Portal Saya, cuma link ke aplikasi lapangan (bukan submenu admin
    // lengkap seperti Dashboard/Rencana/Laporan/Master Toko) — RLS di halaman itu sendiri
    // sudah membatasi datanya ke rencana milik driver/kenek yang bersangkutan.
    extraLinks.push({ name: 'Pengiriman Logistik', href: '/logistik/jalan', icon: '🚚' })
    extraLinks.push({ name: 'Jemput Toko Pusat', href: '/logistik/jemput-toko-pusat', icon: '📦' })
  }
  if (isTokoPusat) {
    extraLinks.push({ name: 'Laporan Muat', href: '/logistik/laporan-muat', icon: '📦' })
  }
  if (extraLinks.length === 0) return baseItems
  return [
    ...baseItems.slice(0, 3),
    ...extraLinks,
    ...baseItems.slice(3),
  ]
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
  const [isTokoPusat, setIsTokoPusat] = useState(false)
  const [meetingBadge, setMeetingBadge] = useState(0)
  const [dailyTaskBadge, setDailyTaskBadge] = useState(0)

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
            supabase.from('employees').select('employee_type, can_drive, can_help, departments(name), positions(name), branches(name)').eq('id', effectiveEmployeeId).single().then(({ data: emp }) => {
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
                const branch = Array.isArray((emp as any).branches) ? (emp as any).branches[0] : (emp as any).branches
                setIsDriverOrKenek(emp.employee_type === 'driver' || !!emp.can_drive || !!emp.can_help || dept?.name === 'Team Gudang')
                setIsKepalaGudang((emp as any).positions?.name === 'Kepala Gudang')
                setIsTokoPusat(branch?.name === 'Toko Pusat')
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
  const navItems = isEmployee ? getEmployeeNavItems(isDriverOrKenek, isKepalaGudang, isTokoPusat) : adminNavItems

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
    || pathname.startsWith('/keuangan/cashflow') || pathname.startsWith('/keuangan/riwayat')
    || pathname === '/keuangan/pembelian' || pathname.startsWith('/kasbon')

  // Kalender Libur secara URL ada di bawah /absensi/*, tapi menunya sengaja dipindah ke
  // grup Portal Saya (bisa dilihat semua orang) — jadi dikecualikan dari trigger auto-expand
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
            const isActive = ('submenu' in item && item.submenu)
              ? hasActiveDescendant(item, pathname)
              : pathname.startsWith(item.href)

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
                      <svg
                        className={`w-4 h-4 transition-transform ${openMenus[item.name] ? 'rotate-180' : ''}`}
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
                            return (
                              <li key={sub.name}>
                                <Link
                                  href={sub.href}
                                  className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                                    subIsActive
                                      ? 'text-blue-700 font-medium bg-blue-50/50'
                                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                                  }`}
                                >
                                  {sub.name}
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
