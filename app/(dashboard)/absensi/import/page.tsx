'use client'

import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet, ArrowRight, RefreshCw } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type EmpResult = {
  fingerprintId: number
  nameInFile: string
  nameInHris?: string
  employeeId?: string
  status: 'matched' | 'not_found'
  recordCount: number
}

type ParseResult = {
  period: string
  employees: EmpResult[]
  records: any[]
  totalRecords: number
  matchedCount: number
  notFoundCount: number
}

type Phase = 'upload' | 'preview' | 'done'

type DoneResult = {
  inserted: number
  skipped: number
  total: number
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ImportAbsensiPage() {
  const [phase, setPhase]           = useState<Phase>('upload')
  const [file, setFile]             = useState<File | null>(null)
  const [dragOver, setDragOver]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [doneResult, setDoneResult] = useState<DoneResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Drag & drop ──────────────────────────────────────────────────────────

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) pickFile(f)
  }

  function pickFile(f: File) {
    const ok = f.name.endsWith('.xls') || f.name.endsWith('.xlsx')
    if (!ok) { setError('Pilih file Excel (.xls atau .xlsx) dari mesin fingerprint.'); return }
    setFile(f)
    setError(null)
  }

  // ── Step 1: Parse XLS ────────────────────────────────────────────────────

  async function handleParse() {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/attendance/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Gagal memproses file.')
      setParseResult(json as ParseResult)
      setPhase('preview')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Step 2: Confirm import ───────────────────────────────────────────────

  async function handleConfirm() {
    if (!parseResult) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/attendance/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: parseResult.records }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Gagal menyimpan data.')
      setDoneResult(json as DoneResult)
      setPhase('done')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setPhase('upload')
    setFile(null)
    setParseResult(null)
    setDoneResult(null)
    setError(null)
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Import Absensi Fingerprint</h1>
        <p className="text-sm text-slate-500">
          Upload file export mesin fingerprint (.xls) untuk mengimpor data kehadiran karyawan.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-8">
        {(['upload', 'preview', 'done'] as Phase[]).map((p, i) => {
          const labels = ['Upload File', 'Preview', 'Selesai']
          const active = phase === p
          const done   = (['upload','preview','done'] as Phase[]).indexOf(phase) > i
          return (
            <div key={p} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold
                ${active ? 'bg-blue-600 text-white' : done ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`text-sm font-medium ${active ? 'text-slate-800' : 'text-slate-400'}`}>{labels[i]}</span>
              {i < 2 && <ArrowRight size={14} className="text-slate-300 ml-1" />}
            </div>
          )
        })}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 flex items-start gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Phase: upload ─────────────────────────────────────────────── */}
      {phase === 'upload' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          {/* Drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
              ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-300 hover:border-blue-300 hover:bg-slate-50'}`}
          >
            <FileSpreadsheet size={40} className="mx-auto mb-3 text-slate-400" />
            <p className="font-semibold text-slate-700 mb-1">
              {file ? file.name : 'Klik atau seret file ke sini'}
            </p>
            <p className="text-sm text-slate-400">Format: .xls / .xlsx dari mesin fingerprint</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xls,.xlsx"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) pickFile(e.target.files[0]) }}
            />
          </div>

          {file && (
            <div className="mt-4 flex items-center justify-between bg-blue-50 border border-blue-100 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-blue-800">
                <FileSpreadsheet size={16} />
                <span className="font-medium">{file.name}</span>
                <span className="text-blue-500">({(file.size / 1024).toFixed(0)} KB)</span>
              </div>
              <button onClick={() => setFile(null)} className="text-xs text-blue-400 hover:text-blue-600">Hapus</button>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleParse}
              disabled={!file || loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300
                text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {loading
                ? <><RefreshCw size={14} className="animate-spin" /> Memproses...</>
                : <><Upload size={14} /> Proses File</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: preview ────────────────────────────────────────────── */}
      {phase === 'preview' && parseResult && (
        <div className="space-y-5">
          {/* Summary */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h2 className="font-semibold text-slate-800 mb-4">Ringkasan Hasil Parse</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Periode',             val: parseResult.period,                          color: 'bg-slate-50 text-slate-700' },
                { label: 'Total Record Absensi', val: parseResult.totalRecords,                    color: 'bg-blue-50 text-blue-700' },
                { label: 'Karyawan Cocok',       val: parseResult.matchedCount,                    color: 'bg-green-50 text-green-700' },
                { label: 'Tidak Ditemukan',      val: parseResult.notFoundCount,                   color: 'bg-orange-50 text-orange-700' },
              ].map(item => (
                <div key={item.label} className={`rounded-lg border px-4 py-3 ${item.color} border-transparent`}>
                  <p className="text-xs font-medium opacity-60 mb-1">{item.label}</p>
                  <p className="text-lg font-bold">{item.val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Karyawan cocok */}
          {parseResult.employees.filter(e => e.status === 'matched').length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 bg-green-50 border-b border-green-100 flex items-center gap-2">
                <CheckCircle size={15} className="text-green-600" />
                <span className="text-sm font-semibold text-green-800">Karyawan Berhasil Dicocokkan</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['ID Fingerprint', 'Nama di File', 'Nama di HRIS', 'Jumlah Record'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {parseResult.employees.filter(e => e.status === 'matched').map(e => (
                      <tr key={e.fingerprintId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono text-slate-600">{e.fingerprintId}</td>
                        <td className="px-4 py-2.5 text-slate-700">{e.nameInFile}</td>
                        <td className="px-4 py-2.5 text-slate-800 font-medium">{e.nameInHris}</td>
                        <td className="px-4 py-2.5">
                          <span className="inline-block bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded">
                            {e.recordCount} hari
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Karyawan tidak ditemukan */}
          {parseResult.employees.filter(e => e.status === 'not_found').length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-3 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
                <AlertCircle size={15} className="text-orange-600" />
                <span className="text-sm font-semibold text-orange-800">ID Fingerprint Tidak Ditemukan di HRIS</span>
                <span className="ml-1 text-xs text-orange-500">(data ini akan dilewati)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['ID Fingerprint', 'Nama di File'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {parseResult.employees.filter(e => e.status === 'not_found').map(e => (
                      <tr key={e.fingerprintId} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-mono text-slate-500">{e.fingerprintId}</td>
                        <td className="px-4 py-2.5 text-slate-600">{e.nameInFile}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 bg-orange-50/50 border-t border-orange-100">
                <p className="text-xs text-orange-600">
                  Buka halaman <strong>Data Karyawan</strong> → edit karyawan → isi kolom <strong>ID Fingerprint</strong> agar cocok dengan ID di atas, lalu import ulang.
                </p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-between items-center pt-2">
            <button onClick={reset} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors">
              ← Upload Ulang
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || parseResult.totalRecords === 0}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-slate-300
                text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {loading
                ? <><RefreshCw size={14} className="animate-spin" /> Menyimpan...</>
                : <>Import {parseResult.totalRecords} Record →</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Phase: done ───────────────────────────────────────────────── */}
      {phase === 'done' && doneResult && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Import Berhasil!</h2>
          <p className="text-sm text-slate-500 mb-6">Data absensi fingerprint telah disimpan ke HRIS.</p>
          <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto mb-8">
            {[
              { label: 'Tersimpan', val: doneResult.inserted, color: 'text-green-600' },
              { label: 'Dilewati*', val: doneResult.skipped,  color: 'text-amber-600' },
              { label: 'Total',     val: doneResult.total,    color: 'text-blue-600' },
            ].map(item => (
              <div key={item.label} className="bg-slate-50 rounded-lg p-3">
                <p className={`text-2xl font-bold ${item.color}`}>{item.val}</p>
                <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-6">* Dilewati = tanggal sudah ada di database (tidak ditimpa)</p>
          <div className="flex justify-center gap-3">
            <button onClick={reset} className="px-5 py-2.5 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors">
              Import File Lain
            </button>
            <a href="/absensi/rekap" className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors inline-block">
              Lihat Rekap Absensi →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
