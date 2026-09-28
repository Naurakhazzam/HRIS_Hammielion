'use client'

import { useState } from 'react'
import { AudienceValue, Branch, Dept, Emp, expandAudience } from '@/lib/meeting'

type Props = {
  value: AudienceValue
  onChange: (v: AudienceValue) => void
  branches: Branch[]
  departments: Dept[]
  employees: Emp[]
}

function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id]
}

function Chip({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition disabled:opacity-40 ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
      {children}
    </button>
  )
}

export default function AudiencePicker({ value, onChange, branches, departments, employees }: Props) {
  const [q, setQ] = useState('')
  const total = expandAudience(value, employees).length
  const matches = q.trim()
    ? employees.filter(e => e.full_name.toLowerCase().includes(q.trim().toLowerCase()) && !value.employeeIds.includes(e.id)).slice(0, 6)
    : []

  return (
    <div className="space-y-3 border border-slate-200 rounded-lg p-3 bg-slate-50/50">
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700 cursor-pointer">
        <input type="checkbox" checked={value.all} onChange={e => onChange({ ...value, all: e.target.checked })} className="rounded" />
        🌐 Semua karyawan
      </label>

      <div className={value.all ? 'opacity-40 pointer-events-none space-y-3' : 'space-y-3'}>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5">Cabang</p>
          <div className="flex flex-wrap gap-1.5">
            {branches.map(b => (
              <Chip key={b.id} active={value.branchIds.includes(b.id)} onClick={() => onChange({ ...value, branchIds: toggle(value.branchIds, b.id) })}>
                {b.name} ({employees.filter(e => e.branch_id === b.id).length})
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5">Divisi</p>
          <div className="flex flex-wrap gap-1.5">
            {departments.map(d => (
              <Chip key={d.id} active={value.departmentIds.includes(d.id)} onClick={() => onChange({ ...value, departmentIds: toggle(value.departmentIds, d.id) })}>
                {d.name} ({employees.filter(e => e.department_id === d.id).length})
              </Chip>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 mb-1.5">Orang tertentu</p>
          {value.employeeIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {value.employeeIds.map(id => (
                <span key={id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-blue-600 text-white">
                  {employees.find(e => e.id === id)?.full_name ?? '?'}
                  <button type="button" onClick={() => onChange({ ...value, employeeIds: value.employeeIds.filter(x => x !== id) })} className="hover:text-red-200" aria-label="Hapus">×</button>
                </span>
              ))}
            </div>
          )}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Ketik nama karyawan..."
            className="w-full px-3 py-1.5 border border-slate-300 rounded text-sm bg-white" />
          {matches.length > 0 && (
            <div className="mt-1 border border-slate-200 rounded bg-white divide-y divide-slate-100 max-h-40 overflow-y-auto">
              {matches.map(e => (
                <button key={e.id} type="button" onClick={() => { onChange({ ...value, employeeIds: [...value.employeeIds, e.id] }); setQ('') }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50">
                  {e.full_name}
                  <span className="text-xs text-slate-400 ml-2">{branches.find(b => b.id === e.branch_id)?.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">Sasaran: <span className="font-semibold text-slate-700">{total} orang</span> (karyawan aktif yang cocok dengan salah satu pilihan)</p>
    </div>
  )
}
