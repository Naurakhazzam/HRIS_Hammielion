'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Profile = {
  full_name: string
  employee_code: string | null
  nik: string | null
  join_date: string | null
  phone: string | null
  birth_date: string | null
  birth_place: string | null
  gender: string | null
  address: string | null
  religion: string | null
  marital_status: string | null
  dependants: number | null
  education: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_account_name: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  positions: { name: string } | null
  departments: { name: string } | null
  branches: { name: string } | null
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-400 uppercase font-medium mb-0.5">{label}</p>
      <p className="text-sm text-slate-800">{value || <span className="text-slate-300 italic">—</span>}</p>
    </div>
  )
}

export default function PortalProfilPage() {
  const supabase = createClient()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) return

    // Semua role bisa lihat portal pribadi mereka sendiri — bukan cuma employee/supervisor,
    // karena owner/hr/finance juga karyawan (punya employee_id sendiri).

    const { data } = await supabase.from('employees')
      .select(`
        full_name, employee_code, nik, join_date, phone, birth_date, birth_place, gender,
        address, religion, marital_status, dependants, education,
        bank_name, bank_account_number, bank_account_name,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        positions(name), departments(name), branches(name)
      `)
      .eq('id', userData.employee_id).single()

    setProfile(data as unknown as Profile)
    setLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat profil...</div>
  if (!profile) return <div className="text-center py-12 text-slate-500">Data profil tidak ditemukan.</div>

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Profil Saya</h1>
        <p className="text-sm text-slate-500">Data kepegawaian Anda yang tercatat di sistem.</p>
      </div>

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5 mb-6">
        ℹ️ Data di halaman ini hanya bisa dilihat. Kalau ada yang salah atau perlu diperbarui (misalnya nomor rekening atau kontak darurat), hubungi HR.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">Data Kepegawaian</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nama Lengkap" value={profile.full_name} />
            <Field label="Kode Karyawan" value={profile.employee_code} />
            <Field label="Jabatan" value={profile.positions?.name} />
            <Field label="Departemen" value={profile.departments?.name} />
            <Field label="Cabang" value={profile.branches?.name} />
            <Field label="Tanggal Bergabung" value={fmtDate(profile.join_date)} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">Data Pribadi</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="NIK" value={profile.nik} />
            <Field label="No. HP" value={profile.phone} />
            <Field label="Tempat, Tanggal Lahir" value={profile.birth_place || profile.birth_date ? `${profile.birth_place || '—'}, ${fmtDate(profile.birth_date)}` : null} />
            <Field label="Jenis Kelamin" value={profile.gender} />
            <Field label="Agama" value={profile.religion} />
            <Field label="Status Pernikahan" value={profile.marital_status} />
            <Field label="Jumlah Tanggungan" value={profile.dependants} />
            <Field label="Pendidikan Terakhir" value={profile.education} />
          </div>
          <div className="mt-4">
            <Field label="Alamat" value={profile.address} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">Rekening Bank (untuk transfer gaji)</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Bank" value={profile.bank_name} />
            <Field label="No. Rekening" value={profile.bank_account_number} />
            <Field label="Nama Pemilik Rekening" value={profile.bank_account_name} />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-700 mb-4">Kontak Darurat</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Nama" value={profile.emergency_contact_name} />
            <Field label="No. HP" value={profile.emergency_contact_phone} />
            <Field label="Hubungan" value={profile.emergency_contact_relation} />
          </div>
        </div>
      </div>
    </div>
  )
}
