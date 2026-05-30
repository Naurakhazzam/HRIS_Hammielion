'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type LeaveRequest = {
  id: string
  leave_type: string
  start_date: string
  end_date: string
  total_days: number
  status: string
  document_url: string | null
  reason: string | null
  employee: { full_name: string; branches: { name: string } }
  approver?: { full_name: string } | null
}

export default function CutiIzinPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMonth, setFilterMonth] = useState('') // YYYY-MM
  
  const [myRole, setMyRole] = useState<string>('employee')
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)
  
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const supabase = createClient()

  useEffect(() => {
    fetchMyUser()
  }, [])

  useEffect(() => {
    if (myRole) {
      fetchRequests()
    }
  }, [filterStatus, filterMonth, myRole, myEmployeeId])

  async function fetchMyUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (data) {
        setMyRole(data.role)
        setMyEmployeeId(data.employee_id)
      }
    }
  }

  async function fetchRequests() {
    setLoading(true)
    let query = supabase
      .from('leave_requests')
      .select(`
        id, leave_type, start_date, end_date, total_days, status, document_url, reason,
        employee:employees!leave_requests_employee_id_fkey(full_name, branch_id, branches(name)),
        approver:employees!leave_requests_approved_by_fkey(full_name)
      `)
      .order('created_at', { ascending: false })

    // Jika bukan HR atau Owner, filter hanya miliknya sendiri
    if (myRole !== 'hr' && myRole !== 'owner') {
      if (myEmployeeId) {
        query = query.eq('employee_id', myEmployeeId)
      }
    }

    if (filterStatus) query = query.eq('status', filterStatus)
    
    if (filterMonth) {
      const startOfMonth = `${filterMonth}-01`
      const [year, month] = filterMonth.split('-')
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate()
      const endOfMonth = `${filterMonth}-${lastDay}`
      
      query = query.gte('start_date', startOfMonth).lte('start_date', endOfMonth)
    }

    const { data, error } = await query

    if (error) {
      showMessage('error', 'Gagal memuat data cuti: ' + error.message)
    } else {
      setRequests((data as unknown as LeaveRequest[]) || [])
    }
    setLoading(false)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  async function updateStatus(id: string, newStatus: string) {
    if (!myEmployeeId) return

    const { error } = await supabase
      .from('leave_requests')
      .update({
        status: newStatus,
        approved_by: myEmployeeId,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)

    if (error) {
      showMessage('error', `Gagal mengubah status: ${error.message}`)
    } else {
      showMessage('success', `Pengajuan berhasil di-${newStatus}.`)
      fetchRequests()
    }
  }

  // Translasi enum ke teks Indonesia
  const translateLeaveType = (type: string) => {
    const map: Record<string, string> = {
      annual: 'Cuti Tahunan',
      sick: 'Sakit (Tanpa Surat)',
      sick_doc: 'Sakit (Surat Dokter)',
      permission: 'Izin Periksa',
      bereaved: 'Izin Duka'
    }
    return map[type] || type
  }

  const isHrOrOwner = myRole === 'hr' || myRole === 'owner'

  return (
    <div>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Cuti & Izin</h1>
          <p className="text-sm text-slate-500">Daftar pengajuan cuti, izin, dan sakit karyawan.</p>
        </div>
        <Link
          href="/cuti/ajukan"
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 shadow-sm"
        >
          + Ajukan Cuti/Izin
        </Link>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {/* Filter & Tabel Data */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Filters */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center">
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Status:</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 block w-full p-2 outline-none">
              <option value="">Semua Status</option>
              <option value="pending">Menunggu (Pending)</option>
              <option value="approved">Disetujui (Approved)</option>
              <option value="rejected">Ditolak (Rejected)</option>
            </select>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <label className="text-xs font-medium text-slate-500">Bulan:</label>
            <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)} 
              className="bg-white border border-slate-300 text-sm rounded-lg focus:ring-blue-500 outline-none block w-full p-2" />
          </div>
        </div>

        {/* Tabel */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jenis</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Tanggal</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Durasi</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat pengajuan...</td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">Belum ada pengajuan cuti/izin.</td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800">{req.employee?.full_name}</div>
                      <div className="text-xs text-slate-500">{req.employee?.branches?.name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-blue-700">{translateLeaveType(req.leave_type)}</div>
                      {req.document_url && (
                        <a href={req.document_url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline inline-flex items-center gap-1 mt-1">
                          📎 Lihat Surat
                        </a>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(req.start_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })} 
                      {req.start_date !== req.end_date && ` - ${new Date(req.end_date).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })}`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-semibold">{req.total_days} Hari</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                        req.status === 'approved' ? 'bg-green-100 text-green-800' : 
                        req.status === 'rejected' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {req.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {req.status === 'pending' && isHrOrOwner ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => updateStatus(req.id, 'approved')}
                            className="text-xs bg-green-50 text-green-600 hover:bg-green-100 border border-green-200 px-2 py-1 rounded font-medium transition"
                          >
                            Setujui
                          </button>
                          <button
                            onClick={() => updateStatus(req.id, 'rejected')}
                            className="text-xs bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 px-2 py-1 rounded font-medium transition"
                          >
                            Tolak
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          {req.status === 'pending' ? 'Menunggu Review' : 'Terkunci'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
