'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Employee = { id: string; full_name: string }

export default function AjukanCutiPage() {
  const router = useRouter()
  const supabase = createClient()

  const [employees, setEmployees] = useState<Employee[]>([])
  const [myRole, setMyRole] = useState<string>('employee')
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  const [documentFile, setDocumentFile] = useState<File | null>(null)
  
  const [formData, setFormData] = useState({
    employee_id: '',
    leave_type: 'annual',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    reason: ''
  })

  // Total days calculation (selisih hari kalender + 1)
  const calcTotalDays = (start: string, end: string) => {
    if (!start || !end) return 0
    const diffTime = Math.abs(new Date(end).getTime() - new Date(start).getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) 
    // Jika end_date < start_date, hasilkan 0 untuk handle error
    if (new Date(end) < new Date(start)) return 0
    return diffDays + 1
  }

  const totalDays = calcTotalDays(formData.start_date, formData.end_date)
  const isSickWarning = formData.leave_type === 'sick' && totalDays > 1

  useEffect(() => {
    fetchMyUserAndEmployees()
  }, [])

  async function fetchMyUserAndEmployees() {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
      if (data) {
        setMyRole(data.role)
        setMyEmployeeId(data.employee_id)
        // Set default employee_id ke diri sendiri jika employee
        if (data.role !== 'hr' && data.role !== 'owner') {
          setFormData(prev => ({ ...prev, employee_id: data.employee_id }))
        } else {
          // Fetch semua karyawan aktif untuk HR/Owner
          const { data: empData } = await supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name')
          if (empData) setEmployees(empData)
        }
      }
    }
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setMessage(null)

    if (totalDays <= 0) {
      showMessage('error', 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.')
      setSubmitting(false)
      return
    }

    if (!formData.employee_id) {
      showMessage('error', 'Karyawan harus dipilih.')
      setSubmitting(false)
      return
    }

    let finalLeaveType = formData.leave_type

    // Auto-correct sick to sick_doc if > 1 day
    if (isSickWarning) {
      if (!documentFile) {
        showMessage('error', 'Sakit lebih dari 1 hari WAJIB menyertakan Surat Dokter.')
        setSubmitting(false)
        return
      }
      finalLeaveType = 'sick_doc'
    }

    // Require document if sick_doc
    if (finalLeaveType === 'sick_doc' && !documentFile) {
      showMessage('error', 'Harap lampirkan foto/file Surat Dokter.')
      setSubmitting(false)
      return
    }

    let uploadedUrl = null

    // Jika ada file dokumen, lakukan upload ke Supabase Storage
    if (documentFile) {
      const fileExt = documentFile.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `surat_dokter/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(filePath, documentFile)

      if (uploadError) {
        showMessage('error', 'Gagal mengupload file: ' + uploadError.message)
        setSubmitting(false)
        return
      }
      
      const { data: publicUrlData } = supabase.storage.from('documents').getPublicUrl(filePath)
      uploadedUrl = publicUrlData.publicUrl
    }

    const { error } = await supabase
      .from('leave_requests')
      .insert([{
        employee_id: formData.employee_id,
        leave_type: finalLeaveType,
        start_date: formData.start_date,
        end_date: formData.end_date,
        total_days: totalDays,
        reason: formData.reason || null,
        document_url: uploadedUrl
      }])

    if (error) {
      showMessage('error', 'Gagal mengajukan cuti: ' + error.message)
      setSubmitting(false)
    } else {
      showMessage('success', 'Pengajuan cuti berhasil dikirim. Menunggu persetujuan.')
      setTimeout(() => {
        router.push('/cuti')
      }, 1500)
    }
  }

  const isHrOrOwner = myRole === 'hr' || myRole === 'owner'
  const showDocumentField = formData.leave_type === 'sick_doc' || isSickWarning

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Form Pengajuan</h1>
        <p className="text-sm text-slate-500">Ajukan cuti, izin, atau pemberitahuan sakit.</p>
      </div>

      {message && (
        <div className={`p-4 mb-6 rounded-lg border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
        <form onSubmit={handleSubmit} className="space-y-5">
          
          {/* Pemilihan Karyawan */}
          {isHrOrOwner ? (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Pengajuan Untuk Karyawan <span className="text-red-500">*</span></label>
              <select 
                required 
                value={formData.employee_id} 
                onChange={(e) => setFormData({...formData, employee_id: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              >
                <option value="">-- Pilih Karyawan --</option>
                {/* Tambahkan diri sendiri jika HR/Owner juga ingin mengajukan */}
                {myEmployeeId && <option value={myEmployeeId}>[Diri Sendiri]</option>}
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
              <p className="text-xs text-slate-500 mt-1">Anda dapat mengajukan atas nama karyawan lain (Hak Akses HR/Owner).</p>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Karyawan</label>
              <div className="w-full px-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm text-slate-500">
                Data Anda (Otomatis)
              </div>
            </div>
          )}

          {/* Jenis Pengajuan */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Jenis Cuti / Izin <span className="text-red-500">*</span></label>
            <select 
              required 
              value={formData.leave_type} 
              onChange={(e) => setFormData({...formData, leave_type: e.target.value})}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
            >
              <option value="annual">Cuti Tahunan</option>
              <option value="sick">Sakit (Tanpa Surat)</option>
              <option value="sick_doc">Sakit (Dengan Surat Dokter)</option>
              <option value="permission">Izin Periksa / Keperluan</option>
              <option value="bereaved">Izin Duka Keluarga</option>
            </select>
          </div>

          {/* Tanggal */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Mulai <span className="text-red-500">*</span></label>
              <input 
                type="date" 
                required 
                value={formData.start_date} 
                onChange={(e) => setFormData({...formData, start_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tanggal Selesai <span className="text-red-500">*</span></label>
              <input 
                type="date" 
                required 
                value={formData.end_date} 
                onChange={(e) => setFormData({...formData, end_date: e.target.value})}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
              />
            </div>
          </div>

          {/* Info Total Hari & Warning */}
          <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex justify-between items-center">
            <span className="text-sm font-medium text-slate-700">Total Hari Diajukan:</span>
            <span className="text-lg font-bold text-blue-600">{totalDays} Hari</span>
          </div>

          {isSickWarning && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm flex gap-2 items-start border border-red-100">
              <span>⚠️</span>
              <p>
                <strong>Perhatian:</strong> Sakit lebih dari 1 hari berturut-turut 
                otomatis akan diubah menjadi jenis <strong>Sakit dengan Surat Dokter</strong>. 
                Anda <strong>WAJIB</strong> melampirkan dokumen.
              </p>
            </div>
          )}

          {/* Alasan */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Alasan / Keterangan <span className="text-red-500">*</span></label>
            <textarea 
              required
              rows={3}
              value={formData.reason} 
              onChange={(e) => setFormData({...formData, reason: e.target.value})}
              placeholder="Jelaskan alasan secara singkat..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
            />
          </div>

          {/* Upload Surat Dokter */}
          {showDocumentField && (
            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
              <label className="block text-sm font-medium text-slate-700 mb-1">Lampiran Foto/Surat Dokter <span className="text-red-500">*</span></label>
              <input 
                type="file" 
                required
                accept="image/*, application/pdf"
                capture="environment"
                onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
                className="w-full px-3 py-2 border border-blue-300 bg-blue-50/30 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" 
              />
              <p className="text-xs text-slate-500 mt-1">Gunakan kamera HP atau unggah file foto/PDF secara langsung.</p>
            </div>
          )}

          <div className="pt-4 flex items-center justify-between">
            <button 
              type="button" 
              onClick={() => router.push('/cuti')}
              className="text-sm text-slate-600 font-medium hover:text-slate-900"
            >
              Kembali
            </button>
            <button 
              type="submit" 
              disabled={submitting} 
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
