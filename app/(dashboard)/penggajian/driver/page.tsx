'use client'

import { useState, useEffect, Fragment } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Employee = { id: string; full_name: string }
type Vehicle = { id: string; name: string; plate_number: string | null }
type Route = { id: string; name: string }

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

export default function PenggajianDriverPage() {
  const [trips, setTrips] = useState<DeliveryTrip[]>([])
  
  const [drivers, setDrivers] = useState<Employee[]>([])
  const [helpers, setHelpers] = useState<Employee[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [routes, setRoutes] = useState<Route[]>([])
  
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  const [weekOptions, setWeekOptions] = useState<{value: string, label: string}[]>([])
  const [filterWeek, setFilterWeek] = useState('') 
  const [filterStatus, setFilterStatus] = useState('')
  
  const [activeTab, setActiveTab] = useState<'overview' | 'input'>('overview')
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  
  const [detailDriver, setDetailDriver] = useState<{
    driverName: string
    weekLabel: string
    trips: DeliveryTrip[]
  } | null>(null)

  const supabase = createClient()

  const [formData, setFormData] = useState({
    driver_id: '',
    helper_id: '',
    vehicle_id: '',
    route_id: '',
    trip_date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    // Generate Weeks
    const weeks = []
    const today = new Date()
    const currentDay = today.getDay()
    // Periode: Jumat s/d Kamis. Cari Jumat terdekat ke belakang.
    const diffToFriday = -((currentDay - 5 + 7) % 7)

    let currentFriday = new Date(today)
    currentFriday.setDate(today.getDate() + diffToFriday)

    for (let i = 0; i < 9; i++) {
      const friday = new Date(currentFriday)
      friday.setDate(currentFriday.getDate() - (i * 7))

      const thursday = new Date(friday)
      thursday.setDate(friday.getDate() + 6)

      const startStr = friday.toISOString().split('T')[0]
      const endStr = thursday.toISOString().split('T')[0]

      const startUI = friday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
      const endUI = thursday.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

      weeks.push({
        value: `${startStr}|${endStr}`,
        label: i === 0 ? `Periode Ini (${startUI} - ${endUI})` : `${startUI} - ${endUI}`
      })
    }
    setWeekOptions(weeks)
    setFilterWeek(weeks[0].value)

    fetchMyUser().then(() => {
      fetchMasterData()
    })
  }, [])

  useEffect(() => {
    if (filterWeek) {
      fetchTrips()
    }
  }, [filterWeek, filterStatus])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (data) setMyEmployeeId(data.employee_id)
    }
  }

  async function fetchMasterData() {
    // Fetch Drivers
    const { data: drvData } = await supabase.from('employees').select('id, full_name').eq('employee_type', 'driver').eq('is_active', true)
    if (drvData) setDrivers(drvData)

    // Fetch Helpers (karyawan permanent dari Team Gudang, dengan fallback ke semua permanent)
    const { data: allPerm } = await supabase
      .from('employees')
      .select('id, full_name, departments(name)')
      .eq('employee_type', 'permanent')
      .eq('is_active', true)
      
    if (allPerm) {
      const gudangWorkers = allPerm.filter((p: any) => {
        const dept = Array.isArray(p.departments) ? p.departments[0] : p.departments
        return dept?.name === 'Team Gudang'
      })
      // Cast ke Employee[] hanya ambil id & full_name
      const toEmployee = (arr: any[]) => arr.map(p => ({ id: p.id, full_name: p.full_name }))
      setHelpers(gudangWorkers.length > 0 ? toEmployee(gudangWorkers) : toEmployee(allPerm))
    }

    // Fetch Vehicles & Routes
    const { data: vData } = await supabase.from('vehicles').select('*').eq('is_active', true).order('name')
    if (vData) setVehicles(vData)

    const { data: rData } = await supabase.from('delivery_routes').select('*').eq('is_active', true).order('name')
    if (rData) setRoutes(rData)
  }

  async function fetchTrips() {
    setLoading(true)
    let query = supabase
      .from('delivery_trips')
      .select(`
        id, trip_date, has_helper, driver_earning, helper_earning, payment_status,
        driver:employees!delivery_trips_driver_id_fkey(full_name),
        helper:employees!delivery_trips_helper_id_fkey(full_name),
        vehicles(name, plate_number),
        delivery_routes(name)
      `)
      .order('trip_date', { ascending: false })

    if (filterStatus) query = query.eq('payment_status', filterStatus)

    if (filterWeek) {
      const [startOfWeek, endOfWeek] = filterWeek.split('|')
      query = query.gte('trip_date', startOfWeek).lte('trip_date', endOfWeek)
    }

    const { data, error } = await query
    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
    } else {
      setTrips((data as unknown as DeliveryTrip[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  // Helper to calculate week start (Jumat)
  function getWeekStart(dateStr: string) {
    const d = new Date(dateStr)
    const day = d.getDay()
    const diff = -((day - 5 + 7) % 7)
    const friday = new Date(d)
    friday.setDate(d.getDate() + diff)
    return friday.toISOString().split('T')[0]
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myEmployeeId) {
      showMessage('error', 'Sesi tidak valid.')
      return
    }

    setSubmitting(true)
    setMessage(null)

    // Calculate earnings based on config
    const hasHelper = formData.helper_id !== ''
    
    const { data: config, error: cfgError } = await supabase
      .from('driver_rate_configs')
      .select('*')
      .eq('vehicle_id', formData.vehicle_id)
      .eq('route_id', formData.route_id)
      .single()

    if (cfgError || !config) {
      showMessage('error', 'Tarif untuk kombinasi Mobil dan Rute ini belum disetup. Silakan cek menu Setup Tarif.')
      setSubmitting(false)
      return
    }

    const dEarning = hasHelper ? config.driver_rate_with_helper : config.driver_rate_without_helper
    const hEarning = hasHelper ? config.helper_rate : 0

    let formattedDate = ''
    try {
      formattedDate = new Date(formData.trip_date).toISOString().split('T')[0]
    } catch (err) {
      showMessage('error', 'Format tanggal tidak valid.')
      setSubmitting(false)
      return
    }

    const weekStart = getWeekStart(formattedDate)

    const { error } = await supabase
      .from('delivery_trips')
      .insert({
        driver_id: formData.driver_id,
        helper_id: hasHelper ? formData.helper_id : null,
        vehicle_id: formData.vehicle_id,
        route_id: formData.route_id,
        trip_date: formattedDate,
        has_helper: hasHelper,
        driver_earning: dEarning,
        helper_earning: hEarning,
        week_start_date: weekStart,
        payment_status: 'unpaid',
        created_by: myEmployeeId
      })

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal mencatat trip: ' + error.message)
    } else {
      showMessage('success', 'Catatan pengiriman berhasil disimpan.')
      fetchTrips()
    }
    setSubmitting(false)
  }

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const unpaidIds = trips.filter(ent => ent.payment_status === 'unpaid').map(ent => ent.id)
      setSelectedIds(unpaidIds)
    } else {
      setSelectedIds([])
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function markAsPaid() {
    if (selectedIds.length === 0 || !myEmployeeId) return
    if (!confirm(`Lunasi ${selectedIds.length} trip pengiriman?`)) return
    
    setSubmitting(true)
    const { error } = await supabase
      .from('delivery_trips')
      .update({ payment_status: 'paid' })
      .in('id', selectedIds)

    if (error) {
      console.error('Detail error:', JSON.stringify(error, null, 2))
      showMessage('error', 'Gagal memproses pembayaran: ' + error.message)
    } else {
      showMessage('success', `${selectedIds.length} trip pengiriman berhasil dilunasi.`)
      setSelectedIds([])
      fetchTrips()
    }
    setSubmitting(false)
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm('Hapus trip ini? Data tidak dapat dikembalikan.')) return
    setSubmitting(true)
    const { error } = await supabase
      .from('delivery_trips')
      .delete()
      .eq('id', tripId)
    if (error) {
      showMessage('error', 'Gagal menghapus trip: ' + error.message)
    } else {
      showMessage('success', 'Trip berhasil dihapus.')
      fetchTrips()
    }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  function handlePrintSlip() {
    if (!detailDriver) return
    const totalUpah = detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0)
    const paidCount = detailDriver.trips.filter(t => t.payment_status === 'paid').length
    const unpaidCount = detailDriver.trips.filter(t => t.payment_status === 'unpaid').length
    const rowsHtml = detailDriver.trips.map(t => `
      <tr>
        <td>${new Date(t.trip_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</td>
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
      <div class="info-row"><span class="lbl">Periode</span><span>: ${detailDriver.weekLabel}</span></div>
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

  function openDetailDriver(driverName: string) {
    const driverTrips = trips.filter(t => (t.driver?.full_name ?? '(Tanpa Driver)') === driverName)
    const weekLabel = weekOptions.find(w => w.value === filterWeek)?.label ?? filterWeek
    setDetailDriver({ driverName, weekLabel, trips: driverTrips })
  }

  const summaryTotalDriver = trips.reduce((acc, t) => acc + Number(t.driver_earning), 0)
  const summaryTotalHelper = trips.reduce((acc, t) => acc + Number(t.helper_earning), 0)
  const summaryPaid = trips.filter(t => t.payment_status === 'paid').length
  const summaryUnpaid = trips.length - summaryPaid

  const groupedByDriver = trips.reduce((acc, trip) => {
    const driverName = trip.driver?.full_name ?? '(Tanpa Driver)'
    if (!acc[driverName]) acc[driverName] = []
    acc[driverName].push(trip)
    return acc
  }, {} as Record<string, DeliveryTrip[]>)

  const weekRangeLabel = (() => {
    if (!filterWeek) return ''
    const [start, end] = filterWeek.split('|')
    const s = new Date(start).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })
    const e = new Date(end).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
    return `${s} – ${e}`
  })()

  return (
    <>
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Penggajian Driver</h1>
          <p className="text-sm text-slate-500">Rekap trip & upah driver ritase mingguan.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/penggajian/driver/rekap" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            📋 Rekap Perjalanan
          </Link>
          <Link href="/penggajian/driver/setup" className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition shadow-sm">
            ⚙️ Setup Tarif
          </Link>
        </div>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Filter Minggu */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-4 flex flex-col sm:flex-row gap-4 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Pilih Minggu</label>
          <select value={filterWeek} onChange={(e) => setFilterWeek(e.target.value)} className="w-full sm:w-64 px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white font-medium">
            {weekOptions.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </div>
        {selectedIds.length > 0 && (
          <button onClick={markAsPaid} disabled={submitting} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition whitespace-nowrap">
            Lunasi ({selectedIds.length}) Trip
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Total Trip</p>
          <p className="text-xl font-bold text-slate-800">{trips.length} Ritase</p>
          <p className="text-xs text-slate-400 mt-1">{weekRangeLabel}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Upah Driver</p>
          <p className="text-xl font-bold text-blue-600">{formatRupiah(trips.reduce((acc, t) => acc + Number(t.driver_earning), 0))}</p>
          <p className="text-xs text-slate-400 mt-1">{weekRangeLabel}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Upah Kenek</p>
          <p className="text-xl font-bold text-purple-600">{formatRupiah(trips.reduce((acc, t) => acc + Number(t.helper_earning), 0))}</p>
          <p className="text-xs text-slate-400 mt-1">{weekRangeLabel}</p>
        </div>
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <p className="text-xs text-slate-500 font-medium uppercase mb-1">Status Lunas</p>
          <p className="text-sm font-bold text-green-600">{trips.filter(t => t.payment_status === 'paid').length} Lunas</p>
          <p className="text-sm font-bold text-red-500">{trips.filter(t => t.payment_status === 'unpaid').length} Belum</p>
          <p className="text-xs text-slate-400 mt-1">{weekRangeLabel}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'overview' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Overview Driver
        </button>
        <button
          onClick={() => setActiveTab('input')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'input' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          + Input Trip
        </button>
      </div>

      {/* Tab Overview */}
      {activeTab === 'overview' && (
        <div>
          {loading ? (
            <div className="flex justify-center items-center h-32 text-slate-400 text-sm">Memuat data...</div>
          ) : Object.keys(groupedByDriver).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-sm">
              Belum ada trip di minggu ini.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(groupedByDriver).map(([driverName, driverTrips]) => {
                const totalEarning = driverTrips.reduce((acc, t) => acc + Number(t.driver_earning), 0)
                const paidCount = driverTrips.filter(t => t.payment_status === 'paid').length
                const unpaidCount = driverTrips.length - paidCount
                const allPaid = unpaidCount === 0
                const unpaidTrips = driverTrips.filter(t => t.payment_status === 'unpaid')

                return (
                  <div key={driverName} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3">
                    {/* Nama Driver */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-base font-bold text-slate-800">{driverName}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{driverTrips.length} trip · {weekRangeLabel}</p>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${allPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {allPaid ? '✓ Lunas' : `${unpaidCount} Belum`}
                      </span>
                    </div>

                    {/* Total Upah */}
                    <div className="bg-slate-50 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-xs text-slate-500">Total Upah</span>
                      <span className="text-sm font-bold text-blue-700">{formatRupiah(totalEarning)}</span>
                    </div>

                    {/* Aksi */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => openDetailDriver(driverName)}
                        className="flex-1 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                      >
                        Detail & Cetak Slip
                      </button>
                      {unpaidCount > 0 && (
                        <button
                          onClick={() => {
                            setSelectedIds(unpaidTrips.map(t => t.id))
                          }}
                          className="flex-1 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition"
                        >
                          Tandai Lunas
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab Input Trip */}
      {activeTab === 'input' && (
        <div className="max-w-md">
          <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Catat Trip Harian</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Driver <span className="text-red-500">*</span></label>
                <select required value={formData.driver_id} onChange={(e) => setFormData({...formData, driver_id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Driver --</option>
                  {drivers.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kenek (Opsional)</label>
                <select value={formData.helper_id} onChange={(e) => setFormData({...formData, helper_id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Tanpa Kenek --</option>
                  {helpers.map(h => <option key={h.id} value={h.id}>{h.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Mobil <span className="text-red-500">*</span></label>
                <select required value={formData.vehicle_id} onChange={(e) => setFormData({...formData, vehicle_id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Mobil --</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Rute <span className="text-red-500">*</span></label>
                <select required value={formData.route_id} onChange={(e) => setFormData({...formData, route_id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
                  <option value="">-- Pilih Rute --</option>
                  {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal Trip <span className="text-red-500">*</span></label>
                <input type="date" required value={formData.trip_date} onChange={(e) => setFormData({...formData, trip_date: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div className="pt-2">
                <button type="submit" disabled={submitting || !myEmployeeId} className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                  {submitting ? 'Memproses...' : 'Simpan Trip'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>

    {/* Modal Detail Driver */}
    {detailDriver && (
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4" id="detail-driver-print-area">
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
              <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Periode</span><span className="font-medium text-slate-800">: {detailDriver.weekLabel}</span></div>
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
