'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type EmployeeWithSalary = {
  id: string
  full_name: string
  branch_name: string
  position_name: string
  employee_type: string
  base_salary: number | null
  effective_date: string | null
}

export default function SetupKomponenGajiPage() {
  const [employees, setEmployees] = useState<EmployeeWithSalary[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const supabase = createClient()

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    
    // 1. Fetch active employees
    const { data: empData, error: empError } = await supabase
      .from('employees')
      .select(`
        id, full_name, employee_type,
        branches (name),
        positions (name)
      `)
      .eq('is_active', true)
      .order('full_name')

    if (empError) {
      console.error(empError)
      setLoading(false)
      return
    }

    // 2. Fetch ALL salary components ordered by date desc
    const { data: salaryData, error: salaryError } = await supabase
      .from('salary_components')
      .select('employee_id, base_salary, effective_date')
      .order('effective_date', { ascending: false })

    if (salaryError) {
      console.error(salaryError)
    }

    // 3. Gabungkan: ambil komponen gaji pertama (terbaru) untuk setiap employee
    const combined: EmployeeWithSalary[] = empData.map((emp: any) => {
      const latestSalary = salaryData?.find(s => s.employee_id === emp.id)
      return {
        id: emp.id,
        full_name: emp.full_name,
        branch_name: emp.branches?.name || '-',
        position_name: emp.positions?.name || '-',
        employee_type: emp.employee_type,
        base_salary: latestSalary?.base_salary || null,
        effective_date: latestSalary?.effective_date || null
      }
    })

    setEmployees(combined)
    setLoading(false)
  }

  const formatRupiah = (angka: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(angka)
  }

  const translateType = (type: string) => {
    switch (type) {
      case 'permanent': return 'Karyawan Tetap'
      case 'driver': return 'Driver'
      case 'freelance': return 'Freelance'
      default: return type
    }
  }

  const filteredEmployees = employees.filter(e => e.full_name.toLowerCase().includes(searchTerm.toLowerCase()))

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Setup Komponen Gaji</h1>
        <p className="text-sm text-slate-500">Kelola daftar gaji pokok, tunjangan, dan potongan untuk setiap karyawan.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-4 items-center justify-between">
          <div className="relative w-full sm:w-72">
            <input 
              type="text" 
              placeholder="Cari nama karyawan..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
            <svg className="w-4 h-4 absolute left-3 top-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Tabel */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b border-slate-200">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Karyawan</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Jabatan & Cabang</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status Tipe</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-right">Gaji Pokok Saat Ini</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Memuat data karyawan...</td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Tidak ditemukan karyawan.</td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-slate-800">{emp.full_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-slate-700">{emp.position_name}</div>
                      <div className="text-xs text-slate-500">{emp.branch_name}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                        {translateType(emp.employee_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {emp.base_salary !== null ? (
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{formatRupiah(emp.base_salary)}</div>
                          <div className="text-[10px] text-slate-400">Efektif: {new Date(emp.effective_date!).toLocaleDateString('id-ID')}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-red-500 italic">Belum Diatur</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link 
                        href={`/penggajian/komponen/${emp.id}`}
                        className="inline-flex items-center px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition shadow-sm"
                      >
                        Atur Komponen & Histori
                      </Link>
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
