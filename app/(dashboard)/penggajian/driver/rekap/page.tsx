'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type DeliveryTrip = {
  id: string
  trip_date: string
  has_helper: boolean
  driver_earning: number
  helper_earning: number
  payment_status: string
  driver: { full_name: string } | null
  helper: { full_name: string } | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
}

export default function RekapPerjalananPage() {
  const [trips, setTrips] = useState<DeliveryTrip[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const supabase = createClient()

  // Filter mode
  const [filterMode, setFilterMode] = useState<'mingguan' | 'bulanan' | 'kustom'>('mingguan')

  // Mingguan
  const [weekOptions, setWeekOptions] = useState<{value: string, label: string}[]>([])
  const [filterWeek, setFilterWeek] = useState('')

  // Bulanan
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Kustom
  const [filterStart, setFilterStart] = useState('')
  const [filterEnd, setFilterEnd] = useState('')

  // Detail modal
  const [detailDriver, setDetailDriver] = useState<{
    driverName: string; periodLabel: string; trips: DeliveryTrip[]
  } | null>(null)

  useEffect(() => {
    // Generate 12 minggu terakhir
    const weeks = []
    const today = new Date()
    const currentDay = today.getDay()
    const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay
    let currentMonday = new Date(today)
    currentMonday.setDate(today.getDate() + diffToMonday)
    for (let i = 0; i < 12; i++) {
      const monday = new Date(currentMonday)
      monday.setDate(currentMonday.getDate() - (i * 7))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      const startStr = monday.toISOString().split('T')[0]
      const endStr = sunday.toISOString().split('T')[0]
      const startUI = monday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      const endUI = sunday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      weeks.push({ value: `${startStr}|${endStr}`, label: i === 0 ? `Minggu Ini (${startUI} - ${endUI})` : `${startUI} - ${endUI}` })
    }
    setWeekOptions(weeks)
    setFilterWeek(weeks[0].value)
  }, [])

  useEffect(() => {
    fetchTrips()
  }, [filterMode, filterWeek, filterMonth, filterStart, filterEnd])

  async function fetchTrips() {
    setLoading(true)
    let query = supabase
      .from('delivery_trips')
      .select(`id, trip_date, has_helper, driver_earning, helper_earning, payment_status,
        driver:employees!delivery_trips_driver_id_fkey(full_name),
        helper:employees!delivery_trips_helper_id_fkey(full_name),
        vehicles(name, plate_number),
        delivery_routes(name)`)
      .order('trip_date', { ascending: false })

    if (filterMode === 'mingguan' && filterWeek) {
      const [s, e] = filterWeek.split('|')
      query = query.gte('trip_date', s).lte('trip_date', e)
    } else if (filterMode === 'bulanan' && filterMonth) {
      const [year, month] = filterMonth.split('-')
      const startDate = `${year}-${month}-01`
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      const endDate = `${year}-${month}-${lastDay}`
      query = query.gte('trip_date', startDate).lte('trip_date', endDate)
    } else if (filterMode === 'kustom' && filterStart && filterEnd) {
      query = query.gte('trip_date', filterStart).lte('trip_date', filterEnd)
    }

    const { data, error } = await query
    if (error) console.error(error)
    else setTrips((data as unknown as DeliveryTrip[]) || [])
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm('Hapus trip ini? Data tidak dapat dikembalikan.')) return
    setSubmitting(true)
    const { error } = await supabase.from('delivery_trips').delete().eq('id', tripId)
    if (error) showMessage('error', 'Gagal menghapus trip: ' + error.message)
    else { showMessage('success', 'Trip berhasil dihapus.'); fetchTrips() }
    setSubmitting(false)
  }

  function openDetailDriver(driverName: string, periodLabel: string) {
    const driverTrips = trips.filter(t => (t.driver?.full_name ?? '(Tanpa Driver)') === driverName)
    setDetailDriver({ driverName, periodLabel, trips: driverTrips })
  }

  const formatRupiah = (n: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n)

  function handlePrintSlip() {
    if (!detailDriver) return
    const totalUpah = detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0)
    const paidCount = detailDriver.trips.filter(t => t.payment_status === 'paid').length
    const unpaidCount = detailDriver.trips.filter(t => t.payment_status === 'unpaid').length
    const rowsHtml = detailDriver.trips.map(t => `
      <tr>
        <td>${new Date(t.trip_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
        <td>${t.delivery_routes?.name ?? '-'}</td>
        <td>${t.vehicles?.name ?? '-'}</td>
        <td>${t.helper?.full_name ?? '-'}</td>
        <td class="center"><span class="badge ${t.payment_status === 'paid' ? 'green' : 'yellow'}">${t.payment_status === 'paid' ? 'Lunas' : 'Belum'}</span></td>
        <td class="right">${formatRupiah(t.driver_earning)}</td>
      </tr>
    `).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slip - ${detailDriver.driverName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:sans-serif;padding:2rem;color:#1e293b}
      .center{text-align:center}.right{text-align:right}
      h1{font-size:1.25rem;font-weight:800;letter-spacing:.05em}
      .sub{font-size:.875rem;color:#64748b;margin-top:.25rem}
      .border-b{border-bottom:1px solid #e2e8f0;padding-bottom:1rem;margin-bottom:1rem}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem;font-size:.875rem}
      .info-row{display:flex;gap:.5rem}
      .lbl{color:#64748b;width:80px;flex-shrink:0}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1rem}
      .stat{background:#f8fafc;border-radius:.5rem;padding:.75rem;text-align:center}
      .stat.blue{background:#eff6ff}.stat.green{background:#f0fdf4}
      .stat-lbl{font-size:.75rem;color:#64748b;margin-bottom:.25rem}
      .stat-val{font-size:1.125rem;font-weight:700}
      .stat-val.blue{color:#1d4ed8;font-size:.875rem}
      .stat-val.green{color:#15803d;font-size:.875rem}
      .stat-sub{font-size:.75rem;color:#ef4444}
      .tbl-wrap{border:1px solid #e2e8f0;border-radius:.5rem;overflow:hidden;margin-bottom:1rem}
      table{width:100%;border-collapse:collapse;font-size:.875rem}
      thead{background:#f8fafc}
      th{padding:.6rem 1rem;text-align:left;font-size:.75rem;font-weight:600;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0}
      td{padding:.6rem 1rem;border-bottom:1px solid #f1f5f9;color:#374151}
      .badge{display:inline-flex;padding:.125rem .5rem;border-radius:.25rem;font-size:.75rem;font-weight:500}
      .badge.green{background:#dcfce7;color:#166534}
      .badge.yellow{background:#fef9c3;color:#854d0e}
      .total{display:flex;justify-content:space-between;align-items:center;background:#1e293b;color:#fff;border-radius:.5rem;padding:1rem 1.25rem;font-weight:700}
      .total-amt{font-size:1.25rem;font-weight:700}
    </style></head><body>
    <div class="center border-b"><h1>HAMMIELION MANAGEMENT</h1><div class="sub">Slip Upah Driver Ritase</div></div>
    <div class="info">
      <div class="info-row"><span class="lbl">Nama</span><span>: ${detailDriver.driverName}</span></div>
      <div class="info-row"><span class="lbl">Periode</span><span>: ${detailDriver.periodLabel}</span></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="stat-lbl">Total Trip</div><div class="stat-val">${detailDriver.trips.length}</div></div>
      <div class="stat blue"><div class="stat-lbl">Total Upah</div><div class="stat-val blue">${formatRupiah(totalUpah)}</div></div>
      <div class="stat green"><div class="stat-lbl">Status</div><div class="stat-val green">${paidCount} Lunas</div><div class="stat-sub">${unpaidCount} Belum</div></div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Tgl</th><th>Rute</th><th>Mobil</th><th>Kenek</th><th class="center">Status</th><th class="right">Upah</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table></div>
    <div class="total"><span>Total Upah</span><span class="total-amt">${formatRupiah(totalUpah)}</span></div>
    </body></html>`

    const win = window.open('', '_blank', 'width=800,height=700')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => { win.print(); win.close() }, 400)
    }
  }

  const getPeriodLabel = () => {
    if (filterMode === 'mingguan') return weekOptions.find(w => w.value === filterWeek)?.label ?? ''
    if (filterMode === 'bulanan') {
      const [y, m] = filterMonth.split('-')
      return new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    }
    if (filterMode === 'kustom' && filterStart && filterEnd) {
      const s = new Date(filterStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      const e = new Date(filterEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
      return `${s} – ${e}`
    }
    return ''
  }

  const groupedByDriver = trips.reduce((acc, trip) => {
    const name = trip.driver?.full_name ?? '(Tanpa Driver)'
    if (!acc[name]) acc[name] = []
    acc[name].push(trip)
    return acc
  }, {} as Record<string, DeliveryTrip[]>)

  // Generate opsi bulan (12 bulan terakhir)
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    return { value: val, label }
  })

  return (
    <>
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Rekap Perjalanan Driver</h1>
          <p className="text-sm text-slate-500">Riwayat lengkap trip per driver dengan filter periode.</p>
        </div>
        <Link href="/penggajian/driver" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
          ← Kembali
        </Link>
      </div>

      {message && (
        <div className={`p-4 mb-4 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Filter Panel */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        {/* Toggle Mode */}
        <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
          {(['mingguan', 'bulanan', 'kustom'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFilterMode(mode)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition capitalize ${filterMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>

        {/* Input sesuai mode */}
        {filterMode === 'mingguan' && (
          <select value={filterWeek} onChange={e => setFilterWeek(e.target.value)} className="w-full sm:w-72 px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
            {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        )}
        {filterMode === 'bulanan' && (
          <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} className="w-full sm:w-64 px-3 py-2 border border-slate-300 rounded text-sm outline-none bg-white">
            {monthOptions.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        )}
        {filterMode === 'kustom' && (
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Dari Tanggal</label>
              <input type="date" value={filterStart} onChange={e => setFilterStart(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Sampai Tanggal</label>
              <input type="date" value={filterEnd} onChange={e => setFilterEnd(e.target.value)} className="px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
            </div>
          </div>
        )}
      </div>

      {/* Konten */}
      {loading ? (
        <div className="flex justify-center items-center h-32 text-slate-400 text-sm">Memuat data...</div>
      ) : trips.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">Tidak ada data trip untuk periode ini.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedByDriver).map(([driverName, driverTrips]) => {
            const totalEarning = driverTrips.reduce((acc, t) => acc + Number(t.driver_earning), 0)
            const allPaid = driverTrips.every(t => t.payment_status === 'paid')
            const periodLabel = getPeriodLabel()

            return (
              <div key={driverName} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Header Driver */}
                <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-slate-800">{driverName}</span>
                    <span className="text-xs text-slate-500">{driverTrips.length} trip</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${allPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {allPaid ? 'Semua Lunas' : `${driverTrips.filter(t => t.payment_status === 'unpaid').length} Belum Lunas`}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-blue-700">{formatRupiah(totalEarning)}</span>
                    <button
                      onClick={() => openDetailDriver(driverName, periodLabel)}
                      className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                    >
                      Detail & Cetak
                    </button>
                  </div>
                </div>

                {/* Sub-baris Trip */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-left">Tanggal</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-left">Rute</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-left">Mobil</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-left">Kenek</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-right">Upah Driver</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-right">Upah Kenek</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-center">Status</th>
                        <th className="px-4 py-2 text-xs font-semibold text-slate-400 uppercase text-center">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {driverTrips.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-2.5 text-slate-600">{new Date(t.trip_date).toLocaleDateString('id-ID', {day:'2-digit', month:'short', year:'numeric'})}</td>
                          <td className="px-4 py-2.5 text-slate-700 font-medium">{t.delivery_routes?.name ?? '-'}</td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{t.vehicles?.name ?? '-'} <span className="text-slate-400">({t.vehicles?.plate_number ?? '-'})</span></td>
                          <td className="px-4 py-2.5 text-slate-600 text-xs">{t.helper?.full_name ?? '-'}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-700">{formatRupiah(t.driver_earning)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{t.has_helper ? formatRupiah(t.helper_earning) : '-'}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${t.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                              {t.payment_status === 'paid' ? 'Lunas' : 'Belum Lunas'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => handleDeleteTrip(t.id)}
                              disabled={submitting}
                              className="px-2.5 py-1 text-xs font-medium bg-white border border-red-200 text-red-600 hover:bg-red-50 rounded transition disabled:opacity-50"
                            >
                              Hapus
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>

    {/* Modal Detail Driver */}
    {detailDriver && (
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" id="rekap-detail-print-area">
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200 modal-hide-on-print">
            <h2 className="text-base font-bold text-slate-700">Detail Upah Driver</h2>
            <div className="flex gap-2">
              <button onClick={handlePrintSlip} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-xs font-medium rounded-lg transition">
                🖨️ Cetak Slip
              </button>
              <button onClick={() => setDetailDriver(null)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition">
                ✕ Tutup
              </button>
            </div>
          </div>
          <div className="px-6 py-5 space-y-4">
            <div className="text-center pb-4 border-b border-slate-200">
              <h1 className="text-xl font-bold text-slate-800 tracking-wide">HAMMIELION MANAGEMENT</h1>
              <p className="text-sm text-slate-500 mt-0.5">Slip Upah Driver Ritase</p>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Nama</span><span className="font-medium text-slate-800">: {detailDriver.driverName}</span></div>
              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Periode</span><span className="font-medium text-slate-800">: {detailDriver.periodLabel}</span></div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-slate-50 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">Total Trip</p>
                <p className="text-lg font-bold text-slate-800">{detailDriver.trips.length}</p>
              </div>
              <div className="bg-blue-50 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">Total Upah</p>
                <p className="text-sm font-bold text-blue-700">{formatRupiah(detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0))}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 mb-1">Status</p>
                <p className="text-sm font-bold text-green-700">{detailDriver.trips.filter(t => t.payment_status === 'paid').length} Lunas</p>
                <p className="text-xs text-red-500">{detailDriver.trips.filter(t => t.payment_status === 'unpaid').length} Belum</p>
              </div>
            </div>
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Tgl</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Rute</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Mobil</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Kenek</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-500 uppercase">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase">Upah</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailDriver.trips.map((t) => (
                    <tr key={t.id}>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{new Date(t.trip_date).toLocaleDateString('id-ID', {day:'2-digit', month:'short'})}</td>
                      <td className="px-4 py-2.5 text-slate-700">{t.delivery_routes?.name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{t.vehicles?.name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-slate-600 text-xs">{t.helper?.full_name ?? '-'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${t.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {t.payment_status === 'paid' ? 'Lunas' : 'Belum'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium text-slate-800">{formatRupiah(t.driver_earning)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between bg-slate-800 text-white rounded-xl px-5 py-4">
              <span className="font-bold">Total Upah</span>
              <span className="font-bold text-xl">{formatRupiah(detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0))}</span>
            </div>
          </div>
        </div>
      </div>
    )}

    </>
  )
}
