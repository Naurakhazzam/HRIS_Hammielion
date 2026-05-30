'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { useState } from 'react'

const navItems = [
  { name: 'Dashboard', href: '/dashboard', icon: '🏠' },
  { name: 'Karyawan', href: '/karyawan', icon: '👥' },
  { name: 'Cabang', href: '/cabang', icon: '🏢' },
  { name: 'Jabatan', href: '/jabatan', icon: '👔' },
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
      { name: 'Bulanan', href: '/penggajian/bulanan' },
      { name: 'Driver (Rekap Trip)', href: '/penggajian/driver' },
      { name: 'Setup Tarif & Mobil', href: '/penggajian/driver/setup' },
      { name: 'Borongan (Rekap)', href: '/penggajian/borongan' },
      { name: 'Pekerja Borongan', href: '/penggajian/borongan/pekerja' },
      { name: 'Tarif Borongan', href: '/penggajian/borongan/tarif' },
      { name: 'Komponen Gaji', href: '/penggajian/komponen' },
      { name: 'Bonus Kinerja', href: '/penggajian/bonus' },
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
  { name: 'Kasbon', href: '/kasbon', icon: '🏦' },
  { name: 'Laporan', href: '/laporan', icon: '📄' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    'Absensi': pathname.startsWith('/absensi'),
    'Penggajian': pathname.startsWith('/penggajian'),
    'KPI': pathname.startsWith('/kpi'),
  })

  const toggleMenu = (name: string) => {
    setOpenMenus(prev => ({ ...prev, [name]: !prev[name] }))
  }

  return (
    <aside className="w-64 bg-white border-r border-slate-200 hidden md:block flex-shrink-0 min-h-[calc(100vh-4rem)]">
      <div className="py-4">
        <ul className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = (item.href === '/absensi' || item.href === '/penggajian' || item.href === '/kpi')
              ? pathname.startsWith(item.href) 
              : pathname.startsWith(item.href) && !item.submenu

            return (
              <li key={item.name}>
                {item.submenu ? (
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
