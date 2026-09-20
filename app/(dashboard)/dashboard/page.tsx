import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { ANNUAL_LEAVE_QUOTA_DAYS, isEligibleForAnnualLeave, tenureDays, getCurrentLeaveYear, toDateStr } from '@/lib/leaveQuota'
import { PREVIEW_EMPLOYEE_ID } from '@/lib/previewMode'

export const metadata: Metadata = {
  title: 'Dashboard — Hammielion HRIS',
  description: 'Dashboard utama sistem HRIS Hammielion Management',
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: userData } = user
    ? await supabase.from('users').select('role, employee_id, employees(full_name, join_date)').eq('id', user.id).single()
    : { data: null }

  // "Preview Tampilan Karyawan" (cookie, lihat lib/previewMode.ts) — mengubah TAMPILAN untuk
  // admin yang sedang cek menu/layout level karyawan, DAN mengganti data yang ditampilkan ke
  // employee sungguhan (Rahmat Saleh, PREVIEW_EMPLOYEE_ID) supaya lebih representatif — bukan
  // employee_id akun admin sendiri yang biasanya kosong/tidak lengkap.
  const cookieStore = await cookies()
  const previewMode = cookieStore.get('previewAsEmployee')?.value === 'true'
    && (userData ? ['owner', 'hr', 'finance'].includes(userData.role) : false)
  const isEmployeeRole = (userData ? ['employee', 'supervisor'].includes(userData.role) : false) || previewMode
  const effectiveEmployeeId = previewMode ? PREVIEW_EMPLOYEE_ID : userData?.employee_id

  if (isEmployeeRole && effectiveEmployeeId) {
    const emp = previewMode
      ? (await supabase.from('employees').select('full_name, join_date').eq('id', effectiveEmployeeId).single()).data
      : (userData as any).employees
    const today = toDateStr(new Date())

    const now = new Date()
    const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1))
    const monthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0))

    const [{ data: todayRoster }, { data: leaveReqs }, { count: pendingKasbonCount }, { count: absentCount }] = await Promise.all([
      supabase.from('employee_roster')
        .select('is_day_off, work_schedules(name, check_in_time, check_out_time)')
        .eq('employee_id', effectiveEmployeeId).eq('date', today).maybeSingle(),
      emp?.join_date
        ? (() => {
            const { start, end } = getCurrentLeaveYear(emp.join_date)
            return supabase.from('leave_requests').select('total_days')
              .eq('employee_id', effectiveEmployeeId).eq('leave_type', 'annual')
              .in('status', ['pending', 'approved'])
              .gte('start_date', toDateStr(start)).lte('start_date', toDateStr(end))
          })()
        : Promise.resolve({ data: [] as { total_days: number }[] }),
      supabase.from('kasbon_requests').select('id', { count: 'exact', head: true })
        .eq('employee_id', effectiveEmployeeId).eq('status', 'pending'),
      // "Tidak absen" = status 'absent' (alpha) bulan berjalan — bukan cuti/sakit/izin, itu
      // beda status dan tidak ikut dihitung di sini.
      supabase.from('attendances').select('id', { count: 'exact', head: true })
        .eq('employee_id', effectiveEmployeeId).eq('status', 'absent')
        .gte('date', monthStart).lte('date', monthEnd),
    ])

    const usedDays = (leaveReqs || []).reduce((s, r) => s + Number(r.total_days), 0)
    const remaining = Math.max(0, ANNUAL_LEAVE_QUOTA_DAYS - usedDays)
    const eligible = emp?.join_date ? isEligibleForAnnualLeave(emp.join_date) : false
    const roster = todayRoster as unknown as { is_day_off: boolean; work_schedules: { name: string; check_in_time: string; check_out_time: string } | null } | null

    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Halo, <strong>{emp?.full_name || user?.email}</strong>.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Jadwal Hari Ini</p>
            {!roster ? (
              <p className="text-sm text-slate-400 italic">Belum dijadwalkan</p>
            ) : roster.is_day_off ? (
              <p className="text-lg font-bold text-slate-700">🛑 Libur</p>
            ) : (
              <p className="text-lg font-bold text-green-700">
                {roster.work_schedules?.name}
                <span className="block text-xs font-normal text-slate-500 mt-0.5">
                  {roster.work_schedules?.check_in_time?.substring(0,5)}–{roster.work_schedules?.check_out_time?.substring(0,5)}
                </span>
              </p>
            )}
            <Link href="/portal/jadwal" className="text-xs text-blue-600 hover:underline mt-2 inline-block">Lihat jadwal 14 hari →</Link>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Sisa Cuti Tahunan</p>
            {!eligible ? (
              <p className="text-sm text-amber-600">Masa kerja belum genap 1 tahun</p>
            ) : (
              <p className="text-2xl font-bold text-blue-600">{remaining} <span className="text-sm font-normal text-slate-400">/ {ANNUAL_LEAVE_QUOTA_DAYS} hari</span></p>
            )}
            <Link href="/cuti/ajukan" className="text-xs text-blue-600 hover:underline mt-2 inline-block">Ajukan cuti/izin →</Link>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Kasbon Menunggu</p>
            <p className="text-2xl font-bold text-slate-700">{pendingKasbonCount ?? 0}</p>
            <Link href="/kasbon" className="text-xs text-blue-600 hover:underline mt-2 inline-block">Lihat kasbon →</Link>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Tidak Absen (Bulan Ini)</p>
            <p className={`text-2xl font-bold ${(absentCount ?? 0) > 0 ? 'text-red-600' : 'text-slate-700'}`}>{absentCount ?? 0} <span className="text-sm font-normal text-slate-400">hari</span></p>
            <Link href="/portal/absensi" className="text-xs text-blue-600 hover:underline mt-2 inline-block">Lihat rekap absensi →</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header Halaman */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">
          Selamat datang di sistem HRIS Hammielion Management.
        </p>
      </div>

      {/* Kartu Selamat Datang */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-blue-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-800">Login Berhasil</p>
            <p className="text-sm text-slate-500">
              Anda masuk sebagai <span className="font-medium text-slate-700">{user?.email}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Placeholder Modul */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Karyawan', desc: 'Manajemen data karyawan', icon: '👥' },
          { label: 'Absensi', desc: 'Rekap kehadiran harian', icon: '📋' },
          { label: 'Penggajian', desc: 'Slip gaji bulanan', icon: '💰' },
          { label: 'Cuti & Izin', desc: 'Pengajuan dan approval', icon: '🗓️' },
          { label: 'KPI', desc: 'Penilaian kinerja', icon: '📊' },
          { label: 'Kasbon', desc: 'Pengajuan dan limit', icon: '🏦' },
        ].map((modul) => (
          <div
            key={modul.label}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm
                       opacity-50 cursor-not-allowed"
          >
            <div className="text-2xl mb-2">{modul.icon}</div>
            <p className="font-medium text-slate-700 text-sm">{modul.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{modul.desc}</p>
            <span className="inline-block mt-3 text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              Segera hadir
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
