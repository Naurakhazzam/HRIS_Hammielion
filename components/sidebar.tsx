'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// Menu untuk HR, Owner, Finance, Supervisor
const adminNavItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { name: 'Karyawan', href: '/karyawan', icon: '👥' },
  {
    name: 'Absensi',
    href: '/absensi',
    icon: '📋',
    submenu: [
      { name: 'Jadwal Kerja', href: '/absensi/jadwal' },
      { name: 'Penugasan Shift', href: '/absensi/shift' },
      { name: 'Rekap Absensi', href: '/absensi/rekap' },
    ]
  },
  { name: 'Cuti & Izin', href: '/cuti', icon: '🗓️' },
  {
    name: 'Penggajian',
    href: '/penggajian',
    icon: '💰',
    submenu: [
      { name: 'Gaji Staff', href: '/penggajian/bulanan' },
      { name: 'Gaji Driver', href: '/penggajian/driver' },
      { name: 'Borongan (Rekap)', href: '/penggajian/borongan' },
      { name: 'Tabungan Loyalitas', href: '/penggajian/loyalitas' },
      { name: 'Bonus Kinerja', href: '/penggajian/bonus' },
      { name: 'Kehilangan & Kasir', href: '/penggajian/kehilangan' },
    ]
  },
  {
    name: 'KPI',
    href: '/kpi',
    icon: '📊',
    submenu: [
      { name: 'Dashboard KPI', href: '/kpi' },
      { name: 'Setup Kriteria', href: '/kpi/setup' },
    ]
  },
  { name: 'Ranking Disiplin', href: '/ranking', icon: '🏆' },
  { name: 'Kasbon', href: '/kasbon', icon: '🏦' },
  { name: 'Laporan', href: '/laporan', icon: '📄' },
  {
    name: 'Setup',
    href: '/setup',
    icon: '⚙️',
    submenu: [
      { name: 'Cabang', href: '/cabang' },
      { name: 'Jabatan', href: '/jabatan' },
      { name: 'Komponen Gaji', href: '/penggajian/komponen' },
      { name: 'Bonus Kondisional', href: '/penggajian/bonus-kondisional' },
      { name: 'Setup Kehilangan', href: '/penggajian/kehilangan/setup' },
      { name: 'Tarif & Mobil Driver', href: '/penggajian/driver/setup' },
      { name: 'Pekerja Borongan', href: '/penggajian/borongan/pekerja' },
      { name: 'Tarif Borongan', href: '/penggajian/borongan/tarif' },
    ]
  },
  { name: 'Manajemen User', href: '/users', icon: '🔑' },
]

// Menu untuk Karyawan (employee/supervisor)
const employeeNavItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  {
    name: 'Portal Saya',
    href: '/portal',
    icon: '👤',
    submenu: [
      { name: 'Slip Gaji', href: '/portal/slip-gaji' },
      { name: 'Rekap Absensi', href: '/portal/absensi' },
    ]
  },
  { name: 'Cuti & Izin', href: '/cuti', icon: '🗓️' },
  { name: 'Kasbon', href: '/kasbon', icon: '🏦' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const supabase = createClient()
  const [userRole, setUserRole] = useState<string>('hr')
  const [loadingRole, setLoadingRole] = useState(true)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('users').select('role').eq('id', user.id).single().then(({ data }) => {
        if (data) setUserRole(data.role)
        setLoadingRole(false)
      })
    })
  }, [])

  const isEmployee = ['employee', 'supervisor'].includes(userRole)
  const navItems = isEmployee ? employeeNavItems : adminNavItems

  const defaultOpen: Record<string, boolean> = {
    'Absensi':    pathname.startsWith('/absensi'),
    'Penggajian': pathname.startsWith('/penggajian'),
    'KPI':        pathname.startsWith('/kpi'),
    'Setup':      pathname.startsWith('/cabang') || pathname.startsWith('/jabatan') || pathname.startsWith('/penggajian/komponen') || pathname.startsWith('/penggajian/driver/setup') || pathname.startsWith('/penggajian/borongan/pekerja') || pathname.startsWith('/penggajian/borongan/tarif') || pathname.startsWith('/penggajian/kehilangan/setup') || pathname.startsWith('/penggajian/bonus-kondisional'),
    'Portal Saya': pathname.startsWith('/portal'),
  }

  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>(defaultOpen)

  const toggleMenu = (name: string) => {
    setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <aside className="w-64 bg-white border-r border-slate-200 hidden md:block flex-shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = ('submenu' in item && item.submenu)
              ? pathname.startsWith(item.href) && item.href !== '/portal'
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
                        {item.submenu.map(sub => (
                          <li key={sub.name}>
                            <Link
                              href={sub.href}
                              className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
                                pathname === sub.href
                                  ? 'text-blue-700 font-medium bg-blue-50/50'
                                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              {sub.name}
                            </Link>
                          </li>
                        ))}
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
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}
