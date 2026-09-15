'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { toWhatsAppLink } from '@/lib/waLink'

type Row = {
  id: string
  application_code: string
  full_name: string
  phone: string
  status: string
  interview_confirmation: string | null
  interview_confirmed_at: string | null
  test_impression: string | null
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function InterviewKonfirmasiPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyConfirmed, setOnlyConfirmed] = useState(true)

  const supabase = createClient()

  const fetchRows = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('job_applicants')
      .select('id, application_code, full_name, phone, status, interview_confirmation, interview_confirmed_at, test_impression')
      .order('interview_confirmed_at', { ascending: false, nullsFirst: false })
    setRows((data as Row[]) || [])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRows()
  }, [fetchRows])

  const filtered = rows
    .filter(r => !onlyConfirmed || !!r.interview_confirmation)
    .filter(r => !search.trim() || r.full_name.toLowerCase().includes(search.trim().toLowerCase()) || r.application_code.toLowerCase().includes(search.trim().toLowerCase()))

  const totalConfirmed = rows.filter(r => r.interview_confirmation).length

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 text-sm">
        <Link href="/rekrutmen" className="text-blue-600 hover:underline">Rekrutmen</Link>
        <span className="text-slate-300">/</span>
        <span className="text-slate-500">Rekap Konfirmasi Interview</span>
      </div>
      <h1 className="text-2xl font-bold text-slate-800 mb-2">Rekap Konfirmasi Interview</h1>
      <p className="text-sm text-slate-500 mb-6">
        Ringkasan konfirmasi kehadiran & kesan pelamar terhadap tes/sistem rekrutmen, dari halaman undangan interview
        masing-masing — tanpa perlu buka Detail satu per satu. Untuk kirim link undangan, buka{' '}
        <Link href="/rekrutmen/pelamar" className="text-blue-600 hover:underline">Daftar Pelamar</Link>.
      </p>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-800">
            {totalConfirmed} dari {rows.length} pelamar sudah konfirmasi
          </h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={onlyConfirmed} onChange={e => setOnlyConfirmed(e.target.checked)} />
              Hanya yang sudah konfirmasi
            </label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama/kode..."
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Kode</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Nama</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Telepon</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Konfirmasi Kehadiran</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Waktu Konfirmasi</th>
                <th className="bg-slate-50 text-left px-4 py-2 font-medium text-slate-600">Kesan Terhadap Tes/Sistem Rekrutmen</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Memuat...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Belum ada data.</td></tr>
              )}
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2 font-mono text-xs text-blue-600 whitespace-nowrap">{r.application_code}</td>
                  <td className="px-4 py-2 text-slate-800 whitespace-nowrap">{r.full_name}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <a href={toWhatsAppLink(r.phone)} target="_blank" rel="noopener noreferrer"
                      className="text-green-600 hover:underline" title="Chat via WhatsApp">
                      {r.phone}
                    </a>
                  </td>
                  <td className="px-4 py-2 text-slate-600 max-w-[220px]">
                    {r.interview_confirmation || <span className="text-slate-300 italic">Belum konfirmasi</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-500 whitespace-nowrap">
                    {r.interview_confirmed_at ? fmtDateTime(r.interview_confirmed_at) : '-'}
                  </td>
                  <td className="px-4 py-2 text-slate-600 max-w-[280px]">
                    {r.test_impression || <span className="text-slate-300 italic">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
