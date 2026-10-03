'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { localDateStr } from '@/lib/date'

type Trip = {
  id: string
  trip_date: string
  driver_id: string | null
  helper_id: string | null
  driver_earning: number
  helper_earning: number
  payment_status: string
  helper_payment_status: string
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
}

type Row = {
  id: string
  date: string
  role: 'Driver' | 'Kenek'
  route: string
  vehicle: string
  partnerName: string
  status: string
  earning: number
}

const fmtRp = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)
const fmtDate = (s: string) => new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

function firstDayOfMonth() {
  const d = new Date()
  return localDateStr(new Date(d.getFullYear(), d.getMonth(), 1))
}
function todayStr() {
  return localDateStr(new Date())
}

export default function PendapatanRitasePage() {
  const supabase = createClient()
  const [loading, setLoading] = useState(true)
  const [myEmployeeId, setMyEmployeeId] = useState('')
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth())
  const [dateTo, setDateTo] = useState(todayStr())
  const [rows, setRows] = useState<Row[]>([])

  const fetchTrips = useCallback(async (empId: string, from: string, to: string) => {
    setLoading(true)
    const { data } = await supabase
      .from('delivery_trips')
      .select(`
        id, trip_date, driver_id, helper_id, driver_earning, helper_earning, payment_status, helper_payment_status,
        vehicles(name, plate_number),
        delivery_routes(name),
        driver:employees!delivery_trips_driver_id_fkey(full_name),
        helper:employees!delivery_trips_helper_id_fkey(full_name)
      `)
      .or(`driver_id.eq.${empId},helper_id.eq.${empId}`)
      .gte('trip_date', from)
      .lte('trip_date', to)
      .order('trip_date', { ascending: false })

    const trips = (data as unknown as Trip[]) || []
    const mapped: Row[] = trips.map(t => {
      const isDriver = t.driver_id === empId
      return {
        id: t.id,
        date: t.trip_date,
        role: isDriver ? 'Driver' : 'Kenek',
        route: t.delivery_routes?.name ?? '-',
        vehicle: t.vehicles ? `${t.vehicles.name}${t.vehicles.plate_number ? ` (${t.vehicles.plate_number})` : ''}` : '-',
        partnerName: isDriver ? (t.helper?.full_name ?? '—') : (t.driver?.full_name ?? '-'),
        status: isDriver ? t.payment_status : t.helper_payment_status,
        earning: Number(isDriver ? t.driver_earning : t.helper_earning),
      }
    })
    setRows(mapped)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      const empId = userData?.employee_id || ''
      setMyEmployeeId(empId)
      if (empId) await fetchTrips(empId, dateFrom, dateTo)
      else setLoading(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilter() {
    if (myEmployeeId) fetchTrips(myEmployeeId, dateFrom, dateTo)
  }

  function applyPreset(from: string, to: string) {
    setDateFrom(from)
    setDateTo(to)
    if (myEmployeeId) fetchTrips(myEmployeeId, from, to)
  }

  function presetBulanIni() { applyPreset(firstDayOfMonth(), todayStr()) }
  function presetMingguIni() {
    const d = new Date()
    const day = d.getDay()
    const diff = -((day - 5 + 7) % 7)
    const friday = new Date(d)
    friday.setDate(d.getDate() + diff)
    applyPreset(localDateStr(friday), todayStr())
  }

  const totalPendapatan = rows.reduce((acc, r) => acc + r.earning, 0)
  const totalLunas = rows.filter(r => r.status === 'paid').reduce((acc, r) => acc + r.earning, 0)
  const totalBelum = rows.filter(r => r.status === 'unpaid').reduce((acc, r) => acc + r.earning, 0)
  const rangeLabel = `${fmtDate(dateFrom)} – ${fmtDate(dateTo)}`

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Pendapatan Ritase</h1>
      <p className="text-sm text-slate-500 mb-6">Riwayat trip &amp; upah Anda sebagai Driver/Kenek.</p>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4">
        <div className="flex flex-col sm:flex-row gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <button onClick={applyFilter}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition">
            Terapkan
          </button>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={presetMingguIni} className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Minggu Ini</button>
          <button onClick={presetBulanIni} className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">Bulan Ini</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Trip</p>
          <p className="text-xl font-bold text-slate-800">{rows.length}</p>
          <p className="text-xs text-slate-400 mt-1">{rangeLabel}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Pendapatan</p>
          <p className="text-xl font-bold text-blue-600">{fmtRp(totalPendapatan)}</p>
          <p className="text-xs text-slate-400 mt-1">{rangeLabel}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 col-span-2 sm:col-span-1">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Sudah / Belum Lunas</p>
          <p className="text-sm font-bold text-green-600">{fmtRp(totalLunas)} Lunas</p>
          <p className="text-sm font-bold text-red-500">{fmtRp(totalBelum)} Belum</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Peran</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rute</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Mobil</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Rekan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Pendapatan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">Memuat data...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ada riwayat trip pada rentang tanggal ini.</td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">{fmtDate(r.date)}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${r.role === 'Driver' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{r.role}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-800">{r.route}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.vehicle}</td>
                  <td className="px-4 py-3 text-sm text-slate-600">{r.partnerName}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${r.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.status === 'paid' ? 'Lunas' : 'Belum'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-800 font-medium text-right whitespace-nowrap">{fmtRp(r.earning)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
