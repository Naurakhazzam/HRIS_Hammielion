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

// Sama persis dengan opsi di form Karyawan (menu admin) — supaya nilai yang tersimpan konsisten
// mau diedit dari sisi karyawan sendiri atau dari sisi HR.
const GENDER_OPTIONS = [{ value: 'male', label: 'Laki-laki' }, { value: 'female', label: 'Perempuan' }]
const RELIGION_OPTIONS = ['Islam', 'Kristen', 'Katolik', 'Hindu', 'Buddha', 'Konghucu']
const MARITAL_OPTIONS = [
  { value: 'single', label: 'Belum Menikah' },
  { value: 'married', label: 'Menikah' },
  { value: 'divorced', label: 'Cerai' },
  { value: 'widowed', label: 'Janda/Duda' },
]
const EDUCATION_OPTIONS = ['SD', 'SMP', 'SMA/SMK', 'D1', 'D2', 'D3', 'D4', 'S1', 'S2', 'S3']

const emptyForm = {
  phone: '', birth_date: '', birth_place: '', gender: '', religion: '', marital_status: '',
  dependants: '0', education: '', address: '',
  emergency_contact_name: '', emergency_contact_phone: '', emergency_contact_relation: '',
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

const inputClass = 'w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white'

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 font-medium mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function PortalProfilPage() {
  const supabase = createClient()
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: userData } = await supabase.from('users').select('role, employee_id').eq('id', user.id).single()
    if (!userData) return

    // Semua role bisa lihat & edit sebagian data pribadinya sendiri — bukan cuma
    // employee/supervisor, karena owner/hr/finance juga karyawan (punya employee_id sendiri).
    await fetchProfile(userData.employee_id)
    setLoading(false)
  }

  async function fetchProfile(employeeId: string) {
    const { data } = await supabase.from('employees')
      .select(`
        full_name, employee_code, nik, join_date, phone, birth_date, birth_place, gender,
        address, religion, marital_status, dependants, education,
        bank_name, bank_account_number, bank_account_name,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        positions(name), departments(name), branches(name)
      `)
      .eq('id', employeeId).single()

    setProfile(data as unknown as Profile)
  }

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  function startEditing() {
    if (!profile) return
    setForm({
      phone: profile.phone || '',
      birth_date: profile.birth_date || '',
      birth_place: profile.birth_place || '',
      gender: profile.gender || '',
      religion: profile.religion || '',
      marital_status: profile.marital_status || '',
      dependants: String(profile.dependants ?? 0),
      education: profile.education || '',
      address: profile.address || '',
      emergency_contact_name: profile.emergency_contact_name || '',
      emergency_contact_phone: profile.emergency_contact_phone || '',
      emergency_contact_relation: profile.emergency_contact_relation || '',
    })
    setEditing(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: userData } = await supabase.from('users').select('employee_id').eq('id', user.id).single()
    if (!userData) { setSaving(false); return }

    const { error } = await supabase.rpc('update_own_employee_profile', {
      p_phone: form.phone || null,
      p_birth_date: form.birth_date || null,
      p_birth_place: form.birth_place || null,
      p_gender: form.gender || null,
      p_religion: form.religion || null,
      p_marital_status: form.marital_status || null,
      p_dependants: form.dependants ? parseInt(form.dependants) : null,
      p_education: form.education || null,
      p_address: form.address || null,
      p_emergency_contact_name: form.emergency_contact_name || null,
      p_emergency_contact_phone: form.emergency_contact_phone || null,
      p_emergency_contact_relation: form.emergency_contact_relation || null,
    })

    if (error) {
      showMessage('error', 'Gagal menyimpan: ' + error.message)
    } else {
      await fetchProfile(userData.employee_id)
      setEditing(false)
      showMessage('success', 'Data pribadi berhasil diperbarui.')
    }
    setSaving(false)
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat profil...</div>
  if (!profile) return <div className="text-center py-12 text-slate-500">Data profil tidak ditemukan.</div>

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Profil Saya</h1>
          <p className="text-sm text-slate-500">Data kepegawaian Anda yang tercatat di sistem.</p>
        </div>
        {!editing && (
          <button onClick={startEditing}
            className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
            ✏️ Edit Data Pribadi
          </button>
        )}
      </div>

      {message && (
        <div className={`p-3 mb-6 rounded-lg border text-sm ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {message.text}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5 mb-6">
        ℹ️ Data Kepegawaian &amp; Rekening Bank cuma bisa dilihat (perlu diubah lewat HR, demi keamanan transfer gaji). Data Pribadi &amp; Kontak Darurat bisa Anda perbarui sendiri.
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
            <Field label="NIK" value={profile.nik} />
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

        {editing ? (
          <form onSubmit={handleSave} className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-blue-200 p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Edit Data Pribadi &amp; Kontak Darurat</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <FormField label="No. HP">
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Tanggal Lahir">
                <input type="date" value={form.birth_date} onChange={e => setForm({ ...form, birth_date: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Tempat Lahir">
                <input type="text" value={form.birth_place} onChange={e => setForm({ ...form, birth_place: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Jenis Kelamin">
                <select value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })} className={inputClass}>
                  <option value="">-- Pilih --</option>
                  {GENDER_OPTIONS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </FormField>
              <FormField label="Agama">
                <select value={form.religion} onChange={e => setForm({ ...form, religion: e.target.value })} className={inputClass}>
                  <option value="">-- Pilih --</option>
                  {RELIGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </FormField>
              <FormField label="Status Pernikahan">
                <select value={form.marital_status} onChange={e => setForm({ ...form, marital_status: e.target.value })} className={inputClass}>
                  <option value="">-- Pilih --</option>
                  {MARITAL_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </FormField>
              <FormField label="Jumlah Tanggungan">
                <input type="number" min="0" value={form.dependants} onChange={e => setForm({ ...form, dependants: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Pendidikan Terakhir">
                <select value={form.education} onChange={e => setForm({ ...form, education: e.target.value })} className={inputClass}>
                  <option value="">-- Pilih --</option>
                  {EDUCATION_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </FormField>
              <FormField label="Nama Kontak Darurat">
                <input type="text" value={form.emergency_contact_name} onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="No. HP Kontak Darurat">
                <input type="tel" value={form.emergency_contact_phone} onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} className={inputClass} />
              </FormField>
              <FormField label="Hubungan Kontak Darurat">
                <input type="text" value={form.emergency_contact_relation} onChange={e => setForm({ ...form, emergency_contact_relation: e.target.value })} placeholder="Contoh: Orang tua, Suami/Istri" className={inputClass} />
              </FormField>
            </div>
            <div className="mt-5 sm:col-span-2 lg:col-span-3">
              <FormField label="Alamat">
                <textarea value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} rows={2} className={inputClass} />
              </FormField>
            </div>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setEditing(false)} disabled={saving}
                className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 disabled:opacity-50">
                Batal
              </button>
              <button type="submit" disabled={saving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
              <h2 className="text-sm font-bold text-slate-700 mb-4">Data Pribadi</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="No. HP" value={profile.phone} />
                <Field label="Tempat, Tanggal Lahir" value={profile.birth_place || profile.birth_date ? `${profile.birth_place || '—'}, ${fmtDate(profile.birth_date)}` : null} />
                <Field label="Jenis Kelamin" value={GENDER_OPTIONS.find(g => g.value === profile.gender)?.label || profile.gender} />
                <Field label="Agama" value={profile.religion} />
                <Field label="Status Pernikahan" value={MARITAL_OPTIONS.find(m => m.value === profile.marital_status)?.label || profile.marital_status} />
                <Field label="Jumlah Tanggungan" value={profile.dependants} />
                <Field label="Pendidikan Terakhir" value={profile.education} />
              </div>
              <div className="mt-4">
                <Field label="Alamat" value={profile.address} />
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
          </>
        )}
      </div>
    </div>
  )
}
