'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { todayLocalStr } from '@/lib/date'

type Branch = { id: string; name: string }
type Position = { id: string; name: string; department_id: string }
type InviteRow = {
  id: string; token: string; status: 'pending' | 'used' | 'revoked'; created_at: string; expires_at: string
  branches: { name: string } | null
  positions: { name: string } | null
  employees: { full_name: string; employee_code: string } | null
}

const EMPLOYEE_TYPE_OPTIONS = [
  { value: 'training', label: 'Training' },
  { value: 'permanent', label: 'Karyawan Tetap' },
  { value: 'driver', label: 'Driver' },
  { value: 'freelance', label: 'Freelance' },
  { value: 'contract', label: 'Kontrak' },
]

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu Diisi', color: 'bg-yellow-100 text-yellow-800' },
  used: { label: 'Sudah Dipakai', color: 'bg-green-100 text-green-800' },
  revoked: { label: 'Dibatalkan', color: 'bg-slate-100 text-slate-500' },
}

export default function UndangKaryawanPage() {
  const supabase = createClient()
  const [branches, setBranches] = useState<Branch[]>([])
  const [positions, setPositions] = useState<Position[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)

  const [branchId, setBranchId] = useState('')
  const [positionId, setPositionId] = useState('')
  const [employeeType, setEmployeeType] = useState('training')
  const [joinDate, setJoinDate] = useState(todayLocalStr())
  const [creating, setCreating] = useState(false)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { fetchData() }, [])

  function showMsg(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  async function fetchData() {
    setLoading(true)
    const [{ data: br }, { data: pos }, { data: inv }] = await Promise.all([
      supabase.from('branches').select('id, name').order('name'),
      supabase.from('positions').select('id, name, department_id').order('name'),
      supabase.from('employee_invites')
        .select('id, token, status, created_at, expires_at, branches(name), positions(name), employees(full_name, employee_code)')
        .order('created_at', { ascending: false }),
    ])
    setBranches((br as Branch[]) || [])
    setPositions((pos as Position[]) || [])
    setInvites((inv as unknown as InviteRow[]) || [])
    setLoading(false)
  }

  function linkFor(token: string) {
    return `${window.location.origin}/daftar-baru/${token}`
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showMsg('error', 'Gagal menyalin link — salin manual dari kotak teksnya.')
    }
  }

  async function createInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!branchId || !positionId) { showMsg('error', 'Pilih cabang dan posisi dulu.'); return }
    setCreating(true)
    setNewLink(null)
    const { data, error } = await supabase.from('employee_invites').insert({
      branch_id: branchId, position_id: positionId, employee_type: employeeType, join_date: joinDate,
    }).select('token').single()
    if (error) showMsg('error', 'Gagal membuat undangan: ' + error.message)
    else {
      setNewLink(linkFor(data.token))
      showMsg('success', 'Link undangan berhasil dibuat.')
      setBranchId(''); setPositionId('')
    }
    setCreating(false)
    await fetchData()
  }

  async function revokeInvite(id: string) {
    if (!confirm('Batalkan link undangan ini? Link tidak akan bisa dipakai lagi.')) return
    const { error } = await supabase.from('employee_invites').update({ status: 'revoked' }).eq('id', id)
    if (error) showMsg('error', 'Gagal membatalkan: ' + error.message)
    else showMsg('success', 'Undangan dibatalkan.')
    await fetchData()
  }

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Undang Karyawan Baru</h1>
        <p className="text-sm text-slate-500">Buat link sekali pakai untuk karyawan baru — mereka isi data pribadi & password sendiri, Anda cukup tentukan penempatannya.</p>
      </div>

      {message && (
        <div className={`p-3 mb-4 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <form onSubmit={createInvite} className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Buat Link Undangan Baru</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Cabang *</label>
            <select required value={branchId} onChange={e => setBranchId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">— Pilih —</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Posisi *</label>
            <select required value={positionId} onChange={e => setPositionId(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              <option value="">— Pilih —</option>
              {positions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Tipe Karyawan</label>
            <select value={employeeType} onChange={e => setEmployeeType(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
              {EMPLOYEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 block mb-1">Tanggal Bergabung</label>
            <input type="date" value={joinDate} onChange={e => setJoinDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>
        <button type="submit" disabled={creating}
          className="mt-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm transition disabled:opacity-50">
          {creating ? 'Membuat...' : 'Buat Link'}
        </button>

        {newLink && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-xs text-blue-700 mb-1.5">Kirim link ini ke karyawan baru (berlaku 14 hari, sekali pakai):</p>
            <div className="flex gap-2">
              <input readOnly value={newLink} onClick={e => (e.target as HTMLInputElement).select()}
                className="flex-1 px-3 py-2 border border-blue-300 rounded-lg text-xs bg-white" />
              <button type="button" onClick={() => copyLink(newLink.split('/').pop()!)}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shrink-0">
                {copied ? 'Tersalin!' : 'Salin'}
              </button>
            </div>
          </div>
        )}
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-700">Riwayat Undangan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Penempatan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Dibuat</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Memuat...</td></tr>
              ) : invites.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Belum ada undangan dibuat.</td></tr>
              ) : (
                invites.map(inv => {
                  const cfg = STATUS_CONFIG[inv.status]
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{inv.positions?.name} · {inv.branches?.name}</div>
                        {inv.employees && (
                          <div className="text-xs text-slate-400">Jadi: {inv.employees.full_name} ({inv.employees.employee_code})</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{fmtDate(inv.created_at)}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {inv.status === 'pending' ? (
                          <div className="flex items-center justify-center gap-2">
                            <button onClick={() => copyLink(inv.token)} className="text-xs text-blue-600 hover:underline">Salin Link</button>
                            <button onClick={() => revokeInvite(inv.id)} className="text-xs text-red-500 hover:underline">Batalkan</button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 italic">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
