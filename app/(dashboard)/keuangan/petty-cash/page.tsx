'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'
import RupiahInput from '@/components/RupiahInput'

const OWNER_ROLES = ['owner', 'hr', 'finance']

type PettyCashEntry = {
  id: string
  entry_date: string
  type: 'masuk' | 'keluar'
  amount: number
  description: string | null
  category: string | null
}
type PettyCashRow = PettyCashEntry & { runningBalance: number }
type EligibleUser = { id: string; full_name: string }

type PrintMode = 'bulan' | 'periode'
type PrintData = {
  userName: string
  periodLabel: string
  printedAt: string
  saldoAwal: number
  rows: PettyCashRow[]
  totalMasuk: number
  totalKeluar: number
  saldoAkhir: number
}

export default function PettyCashPage() {
  const supabase = createClient()

  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<string>('')
  const [myName, setMyName] = useState<string>('')
  const isOwner = myRole === 'owner'

  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const isViewingSelf = selectedUserId === myUserId
  const selectedUserName = isViewingSelf ? myName : (eligibleUsers.find(u => u.id === selectedUserId)?.full_name || '')

  const [allRows, setAllRows] = useState<PettyCashEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const today = todayLocalStr()
  const [form, setForm] = useState({
    entry_date: today, type: 'keluar' as 'masuk' | 'keluar', amount: '', description: '', category: '',
  })

  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editRowDate, setEditRowDate] = useState('')
  const [editRowType, setEditRowType] = useState<'masuk' | 'keluar'>('keluar')
  const [editRowAmount, setEditRowAmount] = useState('')
  const [editRowDescription, setEditRowDescription] = useState('')
  const [editRowCategory, setEditRowCategory] = useState('')

  const thisMonth = today.slice(0, 7)
  const [filterMonth, setFilterMonth] = useState(thisMonth)

  const [printModalOpen, setPrintModalOpen] = useState(false)
  const [printMode, setPrintMode] = useState<PrintMode>('bulan')
  const [printMonth, setPrintMonth] = useState(thisMonth)
  const [printFrom, setPrintFrom] = useState(today)
  const [printTo, setPrintTo] = useState(today)
  const [printData, setPrintData] = useState<PrintData | null>(null)

  const fetchRows = useCallback(async (userId: string) => {
    setLoading(true)
    const { data, error } = await supabase
      .from('petty_cash_entries')
      .select('id, entry_date, type, amount, description, category')
      .eq('user_id', userId)
      .order('entry_date', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) console.error('Detail error:', JSON.stringify(error, null, 2))
    else setAllRows((data as unknown as PettyCashEntry[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setMyUserId(user.id)
      setSelectedUserId(user.id)

      const { data: userRow } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      const role = userRow?.role || ''
      setMyRole(role)

      if (userRow?.employee_id) {
        const { data: emp } = await supabase.from('employees').select('full_name').eq('id', userRow.employee_id).single()
        if (emp) setMyName(emp.full_name)
      }

      if (role === 'owner') {
        const { data: usersRes } = await supabase.from('users').select('id, employee_id').in('role', OWNER_ROLES).eq('is_active', true)
        const empIds = (usersRes || []).map(u => u.employee_id).filter((id): id is string => !!id)
        const { data: empsRes } = empIds.length
          ? await supabase.from('employees').select('id, full_name').in('id', empIds)
          : { data: [] }
        const nameByEmpId = new Map((empsRes || []).map(e => [e.id, e.full_name]))
        const list: EligibleUser[] = (usersRes || [])
          .map(u => ({ id: u.id, full_name: (u.employee_id && nameByEmpId.get(u.employee_id)) || '(Tanpa nama)' }))
          .sort((a, b) => a.id === user.id ? -1 : b.id === user.id ? 1 : a.full_name.localeCompare(b.full_name))
        setEligibleUsers(list)
      }

      fetchRows(user.id)
    }
    init()
  }, [supabase, fetchRows])

  function switchTab(userId: string) {
    setSelectedUserId(userId)
    setEditingRowId(null)
    fetchRows(userId)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  const formatRupiah = (angka: number) =>
    new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)

  // Saldo berjalan dihitung urut kronologis (naik), lalu ditampilkan terbaru dulu
  const rowsWithBalance: PettyCashRow[] = useMemo(() => {
    let balance = 0
    return allRows.map(r => {
      balance += r.type === 'masuk' ? Number(r.amount) : -Number(r.amount)
      return { ...r, runningBalance: balance }
    })
  }, [allRows])

  const currentBalance = rowsWithBalance.length > 0 ? rowsWithBalance[rowsWithBalance.length - 1].runningBalance : 0

  const rowsThisMonth = useMemo(
    () => rowsWithBalance.filter(r => r.entry_date.slice(0, 7) === filterMonth).slice().reverse(),
    [rowsWithBalance, filterMonth]
  )
  const totalMasukBulanIni = rowsThisMonth.filter(r => r.type === 'masuk').reduce((s, r) => s + Number(r.amount), 0)
  const totalKeluarBulanIni = rowsThisMonth.filter(r => r.type === 'keluar').reduce((s, r) => s + Number(r.amount), 0)

  const categoryOptions = useMemo(
    () => Array.from(new Set(allRows.map(r => r.category).filter((c): c is string => !!c))).sort(),
    [allRows]
  )

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!myUserId) return
    const amountNum = parseFloat(form.amount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Nominal tidak valid.'); return }

    setSubmitting(true)
    const { error } = await supabase.from('petty_cash_entries').insert({
      user_id: myUserId, entry_date: form.entry_date, type: form.type, amount: amountNum,
      description: form.description || null, category: form.category || null,
    })
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else {
      showMessage('success', 'Catatan berhasil disimpan.')
      setForm(f => ({ ...f, amount: '', description: '', category: '' }))
      fetchRows(myUserId)
    }
    setSubmitting(false)
  }

  function startEditRow(r: PettyCashEntry) {
    setEditingRowId(r.id)
    setEditRowDate(r.entry_date)
    setEditRowType(r.type)
    setEditRowAmount(String(r.amount))
    setEditRowDescription(r.description || '')
    setEditRowCategory(r.category || '')
  }

  async function saveEditRow(id: string) {
    if (!myUserId) return
    const amountNum = parseFloat(editRowAmount)
    if (isNaN(amountNum) || amountNum <= 0) { showMessage('error', 'Nominal tidak valid.'); return }
    const { error } = await supabase.from('petty_cash_entries')
      .update({ entry_date: editRowDate, type: editRowType, amount: amountNum, description: editRowDescription || null, category: editRowCategory || null })
      .eq('id', id)
    if (error) showMessage('error', 'Gagal menyimpan: ' + error.message)
    else { showMessage('success', 'Catatan berhasil diperbarui.'); setEditingRowId(null); fetchRows(myUserId) }
  }

  async function handleDeleteRow(r: PettyCashEntry) {
    if (!myUserId) return
    const ok = window.confirm(`Hapus catatan "${r.description || (r.type === 'masuk' ? 'Masuk' : 'Keluar')}" sebesar ${formatRupiah(r.amount)}?`)
    if (!ok) return
    const { error } = await supabase.from('petty_cash_entries').delete().eq('id', r.id)
    if (error) showMessage('error', 'Gagal menghapus: ' + error.message)
    else { showMessage('success', 'Catatan berhasil dihapus.'); fetchRows(myUserId) }
  }

  function openPrintModal() {
    setPrintMonth(filterMonth)
    const [y, m] = filterMonth.split('-').map(Number)
    setPrintFrom(`${filterMonth}-01`)
    setPrintTo(new Date(y, m, 0).toISOString().slice(0, 10))
    setPrintMode('bulan')
    setPrintModalOpen(true)
  }

  function handleConfirmPrint() {
    let startDate: string, endDate: string, periodLabel: string
    if (printMode === 'bulan') {
      const [y, m] = printMonth.split('-').map(Number)
      startDate = `${printMonth}-01`
      endDate = new Date(y, m, 0).toISOString().slice(0, 10)
      periodLabel = new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
    } else {
      startDate = printFrom
      endDate = printTo
      const fmt = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      periodLabel = `${fmt(startDate)} s/d ${fmt(endDate)}`
    }

    const before = rowsWithBalance.filter(r => r.entry_date < startDate)
    const saldoAwal = before.length ? before[before.length - 1].runningBalance : 0
    const rangeRows = rowsWithBalance.filter(r => r.entry_date >= startDate && r.entry_date <= endDate)
    const totalMasuk = rangeRows.filter(r => r.type === 'masuk').reduce((s, r) => s + Number(r.amount), 0)
    const totalKeluar = rangeRows.filter(r => r.type === 'keluar').reduce((s, r) => s + Number(r.amount), 0)
    const saldoAkhir = rangeRows.length ? rangeRows[rangeRows.length - 1].runningBalance : saldoAwal

    setPrintData({
      userName: selectedUserName,
      periodLabel,
      printedAt: new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }),
      saldoAwal,
      rows: rangeRows,
      totalMasuk,
      totalKeluar,
      saldoAkhir,
    })
    setPrintModalOpen(false)
  }

  useEffect(() => {
    if (!printData) return
    const timer = setTimeout(() => window.print(), 150)
    function handleAfterPrint() { setPrintData(null) }
    window.addEventListener('afterprint', handleAfterPrint)
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', handleAfterPrint) }
  }, [printData])

  if (loading && allRows.length === 0 && !myUserId) return <div className="py-10 text-center text-slate-500">Memuat...</div>

  return (
    <div>
      <div className="print:hidden">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Petty Cash</h1>
          <p className="text-sm text-slate-500">
            {isOwner
              ? 'Catatan kas kecil pribadi tiap staf owner/hr/finance. Tidak masuk ke laporan atau perhitungan tab manapun.'
              : 'Catatan kas kecil pribadi. Hanya kamu yang bisa melihat ini — tidak masuk ke laporan atau perhitungan tab manapun.'}
          </p>
        </div>

        {message && (
          <div className={`p-4 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
            {message.text}
          </div>
        )}

        {isOwner && eligibleUsers.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {eligibleUsers.map(u => (
              <button key={u.id} onClick={() => switchTab(u.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                  selectedUserId === u.id
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}>
                {u.full_name}{u.id === myUserId ? ' (Saya)' : ''}
              </button>
            ))}
          </div>
        )}

        {!isViewingSelf && (
          <div className="mb-6 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            👁️ Anda sedang melihat catatan milik <strong>{selectedUserName}</strong> — mode lihat saja, tidak bisa tambah/ubah/hapus.
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-slate-500">Memuat data...</div>
        ) : (
          <div className={`grid grid-cols-1 gap-6 ${isViewingSelf ? 'lg:grid-cols-3' : ''}`}>
            {isViewingSelf && (
              <div className="lg:col-span-1 bg-white p-5 rounded-xl shadow-sm border border-slate-200 h-fit">
                <h2 className="text-lg font-bold text-slate-800 mb-4 border-b pb-2">Catat Transaksi</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tipe <span className="text-red-500">*</span></label>
                    <div className="flex gap-2">
                      {(['masuk', 'keluar'] as const).map(t => (
                        <button key={t} type="button" onClick={() => setForm({ ...form, type: t })}
                          className={`flex-1 px-3 py-2 rounded text-sm font-medium border transition ${
                            form.type === t
                              ? t === 'masuk' ? 'bg-green-600 text-white border-green-600' : 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                          }`}>
                          {t === 'masuk' ? '↓ Masuk' : '↑ Keluar'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Tanggal <span className="text-red-500">*</span></label>
                    <input type="date" required value={form.entry_date} onChange={e => setForm({ ...form, entry_date: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Nominal (Rp) <span className="text-red-500">*</span></label>
                    <RupiahInput required value={form.amount} onChange={v => setForm({ ...form, amount: v })}
                      placeholder="Contoh: 50.000"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Keterangan</label>
                    <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                      placeholder="Untuk apa"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">Kategori</label>
                    <input type="text" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                      placeholder="Opsional, misal: Talangan"
                      list="petty-cash-categories"
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                    <datalist id="petty-cash-categories">
                      {categoryOptions.map(c => <option key={c} value={c} />)}
                    </datalist>
                  </div>
                  <button type="submit" disabled={submitting}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded shadow-sm transition disabled:opacity-50">
                    {submitting ? 'Menyimpan...' : 'Simpan'}
                  </button>
                </form>
              </div>
            )}

            <div className={`${isViewingSelf ? 'lg:col-span-2' : ''} space-y-4`}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-xs text-slate-500 font-medium uppercase mb-1">Saldo Kas Kecil Saat Ini</p>
                  <p className={`text-2xl font-bold ${currentBalance >= 0 ? 'text-slate-800' : 'text-red-700'}`}>{formatRupiah(currentBalance)}</p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-xs text-slate-500 font-medium uppercase mb-1">Masuk Bulan Ini</p>
                  <p className="text-lg font-bold text-green-700">{formatRupiah(totalMasukBulanIni)}</p>
                </div>
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                  <p className="text-xs text-slate-500 font-medium uppercase mb-1">Keluar Bulan Ini</p>
                  <p className="text-lg font-bold text-red-700">{formatRupiah(totalKeluarBulanIni)}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-end gap-4 justify-between">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Bulan</label>
                    <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
                      className="px-2 py-1.5 border border-slate-300 rounded text-sm outline-none bg-white" />
                  </div>
                  <button onClick={openPrintModal}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded shadow-sm transition">
                    🖨️ Cetak Laporan
                  </button>
                </div>
                <div className="overflow-auto max-h-[65vh]">
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-white border-b border-slate-200">
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white sticky top-0 z-10 border-b border-slate-200">Tanggal</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white sticky top-0 z-10 border-b border-slate-200">Keterangan</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase bg-white sticky top-0 z-10 border-b border-slate-200">Kategori</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white sticky top-0 z-10 border-b border-slate-200">Masuk</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white sticky top-0 z-10 border-b border-slate-200">Keluar</th>
                        <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right bg-white sticky top-0 z-10 border-b border-slate-200">Saldo</th>
                        {isViewingSelf && <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center bg-white sticky top-0 z-10 border-b border-slate-200">Aksi</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rowsThisMonth.length === 0 ? (
                        <tr><td colSpan={isViewingSelf ? 7 : 6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada catatan bulan ini.</td></tr>
                      ) : rowsThisMonth.map(r => (
                        <tr key={r.id} className="hover:bg-slate-50 transition">
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {editingRowId === r.id ? (
                              <input type="date" value={editRowDate} onChange={e => setEditRowDate(e.target.value)}
                                className="px-2 py-1 border border-slate-300 rounded text-sm" />
                            ) : new Date(r.entry_date).toLocaleDateString('id-ID')}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {editingRowId === r.id ? (
                              <input value={editRowDescription} onChange={e => setEditRowDescription(e.target.value)}
                                className="w-full px-2 py-1 border border-slate-300 rounded text-sm" />
                            ) : (r.description || '—')}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {editingRowId === r.id ? (
                              <input value={editRowCategory} onChange={e => setEditRowCategory(e.target.value)}
                                list="petty-cash-categories"
                                className="w-full px-2 py-1 border border-slate-300 rounded text-xs" />
                            ) : (r.category
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-600">{r.category}</span>
                              : '—')}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-green-700">
                            {editingRowId === r.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <button type="button" onClick={() => setEditRowType('masuk')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${editRowType === 'masuk' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-300'}`}>M</button>
                                <button type="button" onClick={() => setEditRowType('keluar')}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${editRowType === 'keluar' ? 'bg-red-600 text-white border-red-600' : 'bg-white text-slate-600 border-slate-300'}`}>K</button>
                                <RupiahInput value={editRowAmount} onChange={setEditRowAmount}
                                  className="w-24 px-2 py-1 border border-slate-300 rounded text-sm text-right" />
                              </div>
                            ) : (r.type === 'masuk' ? formatRupiah(r.amount) : '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium text-red-700">
                            {editingRowId !== r.id && (r.type === 'keluar' ? formatRupiah(r.amount) : '')}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-semibold text-slate-800">{formatRupiah(r.runningBalance)}</td>
                          {isViewingSelf && (
                            <td className="px-4 py-3 text-center">
                              {editingRowId === r.id ? (
                                <div className="flex gap-1 justify-center">
                                  <button onClick={() => saveEditRow(r.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Simpan</button>
                                  <button onClick={() => setEditingRowId(null)} className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs">Batal</button>
                                </div>
                              ) : (
                                <div className="flex gap-2 justify-center">
                                  <button onClick={() => startEditRow(r)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                  <button onClick={() => handleDeleteRow(r)} className="text-xs text-red-600 hover:underline">Hapus</button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {printModalOpen && (
        <div className="print:hidden fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Cetak Laporan Petty Cash</h2>
              <p className="text-xs text-slate-500 mb-4 pb-3 border-b border-slate-100">
                {selectedUserName} — pilih cara memilih periode laporan.
              </p>

              <div className="flex gap-1 bg-slate-100 p-1 rounded-lg mb-4">
                {(['bulan', 'periode'] as PrintMode[]).map(m => (
                  <button key={m} onClick={() => setPrintMode(m)}
                    className={`flex-1 px-3 py-1.5 rounded text-sm font-medium transition ${printMode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    {m === 'bulan' ? 'Per Bulan' : 'Per Periode'}
                  </button>
                ))}
              </div>

              {printMode === 'bulan' ? (
                <div className="mb-4">
                  <label className="block text-xs text-slate-500 mb-1">Bulan</label>
                  <input type="month" value={printMonth} onChange={e => setPrintMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Dari</label>
                    <input type="date" value={printFrom} onChange={e => setPrintFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Sampai</label>
                    <input type="date" value={printTo} onChange={e => setPrintTo(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded text-sm outline-none" />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setPrintModalOpen(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Batal</button>
                <button onClick={handleConfirmPrint} className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-medium rounded-lg shadow-sm">
                  🖨️ Cetak
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {printData && (
        <div className="hidden print:block p-8 text-black">
          <h1 className="text-xl font-bold mb-1">Laporan Petty Cash</h1>
          <p className="text-sm mb-0.5">Nama: {printData.userName}</p>
          <p className="text-sm mb-0.5">Periode: {printData.periodLabel}</p>
          <p className="text-xs text-slate-500 mb-4">Dicetak: {printData.printedAt}</p>
          <table className="w-full text-sm border-collapse mb-3">
            <thead>
              <tr className="border-b-2 border-black">
                <th className="text-left py-1">Tanggal</th>
                <th className="text-left py-1">Keterangan</th>
                <th className="text-left py-1">Kategori</th>
                <th className="text-right py-1">Masuk</th>
                <th className="text-right py-1">Keluar</th>
                <th className="text-right py-1">Saldo</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-300">
                <td colSpan={5} className="py-1 italic">Saldo Awal</td>
                <td className="py-1 text-right font-semibold">{formatRupiah(printData.saldoAwal)}</td>
              </tr>
              {printData.rows.length === 0 ? (
                <tr><td colSpan={6} className="py-3 text-center italic">Tidak ada transaksi pada periode ini.</td></tr>
              ) : printData.rows.map(r => (
                <tr key={r.id} className="border-b border-slate-200">
                  <td className="py-1">{new Date(r.entry_date).toLocaleDateString('id-ID')}</td>
                  <td className="py-1">{r.description || '—'}</td>
                  <td className="py-1">{r.category || '—'}</td>
                  <td className="py-1 text-right">{r.type === 'masuk' ? formatRupiah(r.amount) : ''}</td>
                  <td className="py-1 text-right">{r.type === 'keluar' ? formatRupiah(r.amount) : ''}</td>
                  <td className="py-1 text-right">{formatRupiah(r.runningBalance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-semibold">
                <td colSpan={3} className="py-1">Total</td>
                <td className="py-1 text-right">{formatRupiah(printData.totalMasuk)}</td>
                <td className="py-1 text-right">{formatRupiah(printData.totalKeluar)}</td>
                <td className="py-1 text-right">{formatRupiah(printData.saldoAkhir)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="text-sm font-semibold">Saldo Akhir: {formatRupiah(printData.saldoAkhir)}</p>
        </div>
      )}
    </div>
  )
}
