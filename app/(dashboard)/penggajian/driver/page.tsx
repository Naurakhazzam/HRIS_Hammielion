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
  driver_id: string | null
  driver: { full_name: string } | null
  helper: { full_name: string } | null
  vehicles: { name: string; plate_number: string | null } | null
  delivery_routes: { name: string } | null
}

type DriverKasbon = {
  id: string
  driver_id: string
  total_amount: number
  remaining_amount: number
  notes: string | null
  status: 'active' | 'lunas'
}

type KasbonDeductionForm = { kasbon_id: string; amount: string }
type DriverFineForm = { tempId: string; amount: string; reason: string }

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
    driverId: string
    weekLabel: string
    weekStart: string
    trips: DeliveryTrip[]
    activeKasbons: DriverKasbon[]
    savedKasbonDeductions: { kasbon_id: string; deduction_amount: number; remaining_after: number }[]
    savedFines: { id: string; amount: number; reason: string }[]
  } | null>(null)

  const [kasbonForms, setKasbonForms] = useState<KasbonDeductionForm[]>([])
  const [fineForms, setFineForms] = useState<DriverFineForm[]>([{ tempId: '0', amount: '', reason: '' }])
  const [savingPotongan, setSavingPotongan] = useState(false)

  const supabase = createClient()

  const [formData, setFormData] = useState({
    driver_id: '',
    helper_id: '',
    vehicle_id: '',
    route_id: '',
    trip_date: new Date().toISOString().split('T')[0]
  })

  useEffect(() => {
    const weeks = []
    const today = new Date()
    const currentDay = today.getDay()
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
    fetchMyUser().then(() => { fetchMasterData() })
  }, [])

  useEffect(() => {
    if (filterWeek) fetchTrips()
  }, [filterWeek, filterStatus])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
      if (data) setMyEmployeeId(data.employee_id)
    }
  }

  async function fetchMasterData() {
    const { data: drvData } = await supabase.from('employees').select('id, full_name').eq('employee_type', 'driver').eq('is_active', true)
    if (drvData) setDrivers(drvData)

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
      const toEmployee = (arr: any[]) => arr.map(p => ({ id: p.id, full_name: p.full_name }))
      setHelpers(gudangWorkers.length > 0 ? toEmployee(gudangWorkers) : toEmployee(allPerm))
    }

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
        driver_id,
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
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setTrips((data as unknown as DeliveryTrip[]) || [])
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

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
    if (!myEmployeeId) { showMessage('error', 'Sesi tidak valid.'); return }
    setSubmitting(true)
    setMessage(null)

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
    } catch {
      showMessage('error', 'Format tanggal tidak valid.')
      setSubmitting(false)
      return
    }

    const weekStart = getWeekStart(formattedDate)
    const { error } = await supabase.from('delivery_trips').insert({
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
    if (e.target.checked) setSelectedIds(trips.filter(t => t.payment_status === 'unpaid').map(t => t.id))
    else setSelectedIds([])
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function markAsPaid() {
    if (selectedIds.length === 0 || !myEmployeeId) return
    if (!confirm(`Lunasi ${selectedIds.length} trip pengiriman?`)) return
    setSubmitting(true)
    const { error } = await supabase.from('delivery_trips').update({ payment_status: 'paid' }).in('id', selectedIds)
    if (error) showMessage('error', 'Gagal memproses pembayaran: ' + error.message)
    else { showMessage('success', `${selectedIds.length} trip pengiriman berhasil dilunasi.`); setSelectedIds([]); fetchTrips() }
    setSubmitting(false)
  }

  async function handleDeleteTrip(tripId: string) {
    if (!confirm('Hapus trip ini? Data tidak dapat dikembalikan.')) return
    setSubmitting(true)
    const { error } = await supabase.from('delivery_trips').delete().eq('id', tripId)
    if (error) showMessage('error', 'Gagal menghapus trip: ' + error.message)
    else { showMessage('success', 'Trip berhasil dihapus.'); fetchTrips() }
    setSubmitting(false)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  async function openDetailDriver(driverName: string, driverId: string) {
    const driverTrips = trips.filter(t => (t.driver?.full_name ?? '(Tanpa Driver)') === driverName)
    const weekLabel = weekOptions.find(w => w.value === filterWeek)?.label ?? filterWeek
    const [weekStart] = filterWeek.split('|')

    const [{ data: kasbons }, { data: savedDed }, { data: savedFines }] = await Promise.all([
      supabase.from('driver_kasbon').select('*').eq('driver_id', driverId).eq('status', 'active').order('created_at'),
      supabase.from('driver_kasbon_deductions').select('*').eq('driver_id', driverId).eq('week_start_date', weekStart),
      supabase.from('driver_fines').select('*').eq('driver_id', driverId).eq('week_start_date', weekStart),
    ])

    setDetailDriver({
      driverName, driverId, weekLabel, weekStart,
      trips: driverTrips,
      activeKasbons: (kasbons || []) as DriverKasbon[],
      savedKasbonDeductions: savedDed || [],
      savedFines: savedFines || [],
    })
    setKasbonForms((kasbons || []).map(k => ({ kasbon_id: k.id, amount: '' })))
    setFineForms([{ tempId: Date.now().toString(), amount: '', reason: '' }])
  }

  async function handleSavePotongan() {
    if (!detailDriver) return
    setSavingPotongan(true)
    const errors: string[] = []

    // Simpan potongan kasbon
    for (const form of kasbonForms) {
      const amt = parseFloat(form.amount)
      if (!amt || amt <= 0) continue
      const kasbon = detailDriver.activeKasbons.find(k => k.id === form.kasbon_id)
      if (!kasbon) continue
      const deductAmt = Math.min(amt, kasbon.remaining_amount)
      const remainingAfter = Math.round((kasbon.remaining_amount - deductAmt) * 100) / 100

      const { error: e1 } = await supabase.from('driver_kasbon_deductions').insert({
        kasbon_id: kasbon.id, driver_id: detailDriver.driverId,
        week_start_date: detailDriver.weekStart,
        deduction_amount: deductAmt, remaining_after: remainingAfter,
      })
      if (e1) { errors.push(e1.message); continue }

      const upd: any = { remaining_amount: remainingAfter, updated_at: new Date().toISOString() }
      if (remainingAfter === 0) upd.status = 'lunas'
      await supabase.from('driver_kasbon').update(upd).eq('id', kasbon.id)
    }

    // Simpan denda
    for (const fine of fineForms) {
      const amt = parseFloat(fine.amount)
      if (!amt || amt <= 0 || !fine.reason.trim()) continue
      const { error: e2 } = await supabase.from('driver_fines').insert({
        driver_id: detailDriver.driverId,
        week_start_date: detailDriver.weekStart,
        amount: amt, reason: fine.reason.trim(),
      })
      if (e2) errors.push(e2.message)
    }

    if (errors.length > 0) showMessage('error', 'Ada error: ' + errors.join(', '))
    else showMessage('success', 'Potongan berhasil disimpan.')

    await openDetailDriver(detailDriver.driverName, detailDriver.driverId)
    setSavingPotongan(false)
  }

  async function handleDeleteFine(fineId: string) {
    if (!detailDriver) return
    if (!confirm('Hapus denda ini?')) return
    await supabase.from('driver_fines').delete().eq('id', fineId)
    await openDetailDriver(detailDriver.driverName, detailDriver.driverId)
  }

  async function handleDeleteKasbonDeduction(dedId: string, kasbonId: string, deductionAmount: number) {
    if (!detailDriver) return
    if (!confirm('Batalkan potongan kasbon minggu ini? Saldo kasbon akan dikembalikan.')) return
    // Ambil data potongan dulu
    const { data: ded } = await supabase.from('driver_kasbon_deductions').select('remaining_after, deduction_amount').eq('id', dedId).single()
    if (ded) {
      // Kembalikan saldo kasbon
      const restored = (ded as any).remaining_after + (ded as any).deduction_amount
      await supabase.from('driver_kasbon').update({ remaining_amount: restored, status: 'active', updated_at: new Date().toISOString() }).eq('id', kasbonId)
    }
    await supabase.from('driver_kasbon_deductions').delete().eq('id', dedId)
    await openDetailDriver(detailDriver.driverName, detailDriver.driverId)
  }

  function handlePrintSlip() {
    if (!detailDriver) return
    const totalUpah = detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0)
    const paidCount = detailDriver.trips.filter(t => t.payment_status === 'paid').length
    const unpaidCount = detailDriver.trips.filter(t => t.payment_status === 'unpaid').length
    const totalKasbon = detailDriver.savedKasbonDeductions.reduce((s, d) => s + Number(d.deduction_amount), 0)
    const totalDenda = detailDriver.savedFines.reduce((s, f) => s + Number(f.amount), 0)
    const gajiB = totalUpah - totalKasbon - totalDenda

    const rowsHtml = detailDriver.trips.map(t => `
      <tr>
        <td>${new Date(t.trip_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}</td>
        <td>${t.delivery_routes?.name ?? '-'}</td>
        <td>${t.vehicles?.name ?? '-'}</td>
        <td>${t.helper?.full_name ?? '-'}</td>
        <td class="center"><span class="badge ${t.payment_status === 'paid' ? 'green' : 'yellow'}">${t.payment_status === 'paid' ? 'Lunas' : 'Belum'}</span></td>
        <td class="right">${formatRupiah(t.driver_earning)}</td>
      </tr>`).join('')

    const kasbonRows = detailDriver.savedKasbonDeductions.map(d => `
      <tr class="dedrow">
        <td colspan="5">Potongan Kasbon <span class="sisa">(sisa: ${formatRupiah(d.remaining_after)})</span></td>
        <td class="right red">-${formatRupiah(d.deduction_amount)}</td>
      </tr>`).join('')

    const dendaRows = detailDriver.savedFines.map(f => `
      <tr class="dedrow">
        <td colspan="5">Denda: ${f.reason}</td>
        <td class="right red">-${formatRupiah(f.amount)}</td>
      </tr>`).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slip - ${detailDriver.driverName}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:sans-serif;padding:2rem;color:#1e293b}
      .center{text-align:center}.right{text-align:right}.red{color:#dc2626}
      h1{font-size:1.25rem;font-weight:800;letter-spacing:.05em}
      .sub{font-size:.875rem;color:#64748b;margin-top:.25rem}
      .border-b{border-bottom:1px solid #e2e8f0;padding-bottom:1rem;margin-bottom:1rem}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1rem;font-size:.875rem}
      .info-row{display:flex;gap:.5rem}.lbl{color:#64748b;width:80px;flex-shrink:0}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;margin-bottom:1rem}
      .stat{background:#f8fafc;border-radius:.5rem;padding:.75rem;text-align:center}
      .stat.blue{background:#eff6ff}.stat.green{background:#f0fdf4}
      .stat-lbl{font-size:.75rem;color:#64748b;margin-bottom:.25rem}
      .stat-val{font-size:1.125rem;font-weight:700}
      .stat-val.blue{color:#1d4ed8;font-size:.875rem}.stat-val.green{color:#15803d;font-size:.875rem}
      .stat-sub{font-size:.75rem;color:#ef4444}
      .tbl-wrap{border:1px solid #e2e8f0;border-radius:.5rem;overflow:hidden;margin-bottom:1rem}
      table{width:100%;border-collapse:collapse;font-size:.875rem}
      thead{background:#f8fafc}
      th{padding:.6rem 1rem;text-align:left;font-size:.75rem;font-weight:600;color:#64748b;text-transform:uppercase;border-bottom:1px solid #e2e8f0}
      td{padding:.6rem 1rem;border-bottom:1px solid #f1f5f9;color:#374151}
      .dedrow td{background:#fef2f2;color:#991b1b;font-size:.8rem;font-style:italic}
      .sisa{font-size:.75rem;color:#64748b}
      .badge{display:inline-flex;padding:.125rem .5rem;border-radius:.25rem;font-size:.75rem;font-weight:500}
      .badge.green{background:#dcfce7;color:#166534}.badge.yellow{background:#fef9c3;color:#854d0e}
      .total-wrap{display:flex;flex-direction:column;gap:.5rem}
      .total-row{display:flex;justify-content:space-between;align-items:center;padding:.75rem 1.25rem;border-radius:.5rem}
      .total-row.upah{background:#1e293b;color:#fff}
      .total-row.pot{background:#fef2f2;color:#991b1b}
      .total-row.bersih{background:#166534;color:#fff}
      .total-amt{font-size:1.1rem;font-weight:700}
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
      <tbody>${rowsHtml}${kasbonRows}${dendaRows}</tbody>
    </table></div>
    <div class="total-wrap">
      <div class="total-row upah"><span>Total Upah</span><span class="total-amt">${formatRupiah(totalUpah)}</span></div>
      ${(totalKasbon + totalDenda) > 0 ? `<div class="total-row pot"><span>Total Potongan</span><span class="total-amt">-${formatRupiah(totalKasbon + totalDenda)}</span></div>` : ''}
      ${(totalKasbon + totalDenda) > 0 ? `<div class="total-row bersih"><span>Gaji Bersih</span><span class="total-amt">${formatRupiah(gajiB)}</span></div>` : ''}
    </div>
    </body></html>`

    const win = window.open('', '_blank', 'width=800,height=700')
    if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => { win.print(); win.close() }, 400) }
  }

  const groupedByDriver = trips.reduce((acc, trip) => {
    const driverName = trip.driver?.full_name ?? '(Tanpa Driver)'
    if (!acc[driverName]) acc[driverName] = { trips: [], driverId: trip.driver_id ?? '' }
    acc[driverName].trips.push(trip)
    return acc
  }, {} as Record<string, { trips: DeliveryTrip[]; driverId: string }>)

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
        <button onClick={() => setActiveTab('overview')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'overview' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          Overview Driver
        </button>
        <button onClick={() => setActiveTab('input')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'input' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
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
              {Object.entries(groupedByDriver).map(([driverName, driverGroup]) => {
                const { trips: driverTrips, driverId } = driverGroup
                const totalEarning = driverTrips.reduce((acc, t) => acc + Number(t.driver_earning), 0)
                const paidCount = driverTrips.filter(t => t.payment_status === 'paid').length
                const unpaidCount = driverTrips.length - paidCount
                const allPaid = unpaidCount === 0
                const unpaidTrips = driverTrips.filter(t => t.payment_status === 'unpaid')

                return (
                  <div key={driverName} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-base font-bold text-slate-800">{driverName}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{driverTrips.length} trip · {weekRangeLabel}</p>
                      </div>
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${allPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                        {allPaid ? '✓ Lunas' : `${unpaidCount} Belum`}
                      </span>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-3 py-2 flex justify-between items-center">
                      <span className="text-xs text-slate-500">Total Upah</span>
                      <span className="text-sm font-bold text-blue-700">{formatRupiah(totalEarning)}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openDetailDriver(driverName, driverId)}
                        className="flex-1 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition">
                        Detail & Cetak Slip
                      </button>
                      {unpaidCount > 0 && (
                        <button
                          onClick={() => setSelectedIds(unpaidTrips.map(t => t.id))}
                          className="flex-1 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition">
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
    {detailDriver && (() => {
      const totalUpah = detailDriver.trips.reduce((acc, t) => acc + t.driver_earning, 0)
      const totalKasbon = detailDriver.savedKasbonDeductions.reduce((s, d) => s + Number(d.deduction_amount), 0)
      const totalDenda = detailDriver.savedFines.reduce((s, f) => s + Number(f.amount), 0)
      const totalPotongan = totalKasbon + totalDenda
      const gajiB = totalUpah - totalPotongan
      const hasSavedDeductions = detailDriver.savedKasbonDeductions.length > 0 || detailDriver.savedFines.length > 0

      return (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 bg-black/50 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-200">
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
              {/* Company Header */}
              <div className="text-center pb-4 border-b border-slate-200">
                <h1 className="text-xl font-bold text-slate-800 tracking-wide">HAMMIELION MANAGEMENT</h1>
                <p className="text-sm text-slate-500 mt-0.5">Slip Upah Driver Ritase</p>
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Nama</span><span className="font-medium text-slate-800">: {detailDriver.driverName}</span></div>
                <div className="flex gap-2"><span className="text-slate-500 w-20 shrink-0">Periode</span><span className="font-medium text-slate-800">: {detailDriver.weekLabel}</span></div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-1">Total Trip</p>
                  <p className="text-lg font-bold text-slate-800">{detailDriver.trips.length}</p>
                </div>
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-1">Total Upah</p>
                  <p className="text-sm font-bold text-blue-700">{formatRupiah(totalUpah)}</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <p className="text-xs text-slate-500 mb-1">Status</p>
                  <p className="text-sm font-bold text-green-700">{detailDriver.trips.filter(t => t.payment_status === 'paid').length} Lunas</p>
                  <p className="text-xs text-red-500">{detailDriver.trips.filter(t => t.payment_status === 'unpaid').length} Belum</p>
                </div>
              </div>

              {/* Trip Table */}
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

              {/* ─── SECTION POTONGAN ─── */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700">✂️ Potongan Minggu Ini</span>
                  {hasSavedDeductions && (
                    <span className="text-xs text-red-600 font-medium">Total: -{formatRupiah(totalPotongan)}</span>
                  )}
                </div>
                <div className="px-4 py-4 space-y-4">

                  {/* ── Potongan yang sudah tersimpan (selalu tampil jika ada) ── */}
                  {hasSavedDeductions && (
                    <div className="space-y-2">
                      {detailDriver.savedKasbonDeductions.map((d: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2.5 bg-orange-50 rounded-lg border border-orange-100 text-sm">
                          <div>
                            <span className="font-medium text-orange-700">Kasbon</span>
                            <span className="text-xs text-slate-500 ml-2">sisa: {formatRupiah(d.remaining_after)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-red-600">-{formatRupiah(d.deduction_amount)}</span>
                            <button onClick={() => handleDeleteKasbonDeduction(d.id, d.kasbon_id, d.deduction_amount)}
                              className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                          </div>
                        </div>
                      ))}
                      {detailDriver.savedFines.map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between p-2.5 bg-red-50 rounded-lg border border-red-100 text-sm">
                          <div>
                            <span className="font-medium text-red-700">Denda</span>
                            <span className="text-xs text-slate-600 ml-2">{f.reason}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-red-600">-{formatRupiah(f.amount)}</span>
                            <button onClick={() => handleDeleteFine(f.id)}
                              className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                          </div>
                        </div>
                      ))}
                      <p className="text-xs text-slate-400 italic">Klik ✕ untuk membatalkan potongan yang sudah tersimpan.</p>
                    </div>
                  )}

                  {/* ── Divider jika ada potongan tersimpan ── */}
                  {hasSavedDeductions && (
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex-1 border-t border-dashed border-slate-300" />
                      <span className="text-xs text-slate-400 font-medium px-1">Tambah Potongan Baru</span>
                      <div className="flex-1 border-t border-dashed border-slate-300" />
                    </div>
                  )}

                  {/* ── Form input potongan baru (selalu tampil) ── */}
                  <div className="space-y-4">
                    {/* Kasbon aktif */}
                    {detailDriver.activeKasbons.length > 0 ? (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Kasbon Aktif</p>
                        {detailDriver.activeKasbons.map((kasbon, i) => (
                          <div key={kasbon.id} className="flex items-center gap-3 p-3 bg-orange-50 rounded-lg border border-orange-100">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-slate-700 truncate">{kasbon.notes || 'Kasbon'}</p>
                              <p className="text-xs text-orange-600">Sisa: {formatRupiah(kasbon.remaining_amount)}</p>
                            </div>
                            <div className="shrink-0">
                              <input
                                type="number" min="0" max={kasbon.remaining_amount}
                                placeholder="Potong Rp"
                                value={kasbonForms[i]?.amount || ''}
                                onChange={e => {
                                  const updated = [...kasbonForms]
                                  updated[i] = { ...updated[i], amount: e.target.value }
                                  setKasbonForms(updated)
                                }}
                                className="w-32 px-2 py-1.5 border border-slate-300 rounded text-sm text-right outline-none focus:ring-1 focus:ring-orange-400"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic bg-slate-50 rounded-lg p-3">
                        Tidak ada kasbon aktif untuk driver ini. Input kasbon di tab Kasbon → Kasbon Driver.
                      </p>
                    )}

                    {/* Denda */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Denda</p>
                        <button
                          onClick={() => setFineForms([...fineForms, { tempId: Date.now().toString(), amount: '', reason: '' }])}
                          className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                          + Tambah Denda
                        </button>
                      </div>
                      {fineForms.map((fine, i) => (
                        <div key={fine.tempId} className="flex gap-2 items-center">
                          <input
                            type="text" placeholder="Alasan denda (mis: uang setoran, barang rusak...)"
                            value={fine.reason}
                            onChange={e => {
                              const updated = [...fineForms]
                              updated[i] = { ...updated[i], reason: e.target.value }
                              setFineForms(updated)
                            }}
                            className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-xs outline-none focus:ring-1 focus:ring-red-400"
                          />
                          <input
                            type="number" min="0" placeholder="Nominal"
                            value={fine.amount}
                            onChange={e => {
                              const updated = [...fineForms]
                              updated[i] = { ...updated[i], amount: e.target.value }
                              setFineForms(updated)
                            }}
                            className="w-28 px-2 py-1.5 border border-slate-300 rounded text-sm text-right outline-none focus:ring-1 focus:ring-red-400"
                          />
                          {fineForms.length > 1 && (
                            <button onClick={() => setFineForms(fineForms.filter((_, idx) => idx !== i))}
                              className="text-red-400 hover:text-red-600 text-sm px-1 shrink-0">✕</button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleSavePotongan}
                      disabled={savingPotongan}
                      className="w-full py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50">
                      {savingPotongan ? 'Menyimpan...' : '💾 Simpan Potongan'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Ringkasan Gaji */}
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-slate-800 text-white rounded-xl px-5 py-4">
                  <span className="font-bold">Total Upah</span>
                  <span className="font-bold text-xl">{formatRupiah(totalUpah)}</span>
                </div>
                {totalPotongan > 0 && (
                  <>
                    <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-xl px-5 py-3">
                      <span className="text-sm font-medium text-red-700">Total Potongan</span>
                      <span className="font-bold text-red-700">-{formatRupiah(totalPotongan)}</span>
                    </div>
                    <div className="flex items-center justify-between bg-green-700 text-white rounded-xl px-5 py-4">
                      <span className="font-bold">Gaji Bersih</span>
                      <span className="font-bold text-xl">{formatRupiah(gajiB)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}
