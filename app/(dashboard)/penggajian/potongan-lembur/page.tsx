'use client'

// SATU PINTU angka potongan, keterlambatan & lembur staff (tabel payroll_rules, migrasi 118).
// Semua slip, Portal, Aturan Potongan, dan Panduan membaca angka dari sini lewat
// lib/payrollRules.ts. Satu set aturan berlaku mulai periode yang dipilih sampai ada set berikutnya.
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import RupiahInput from '@/components/RupiahInput'
import { recalcDraftPayrolls } from '@/lib/payrollRecalc'
import {
  buildMultipliers, fmtMultiplier, normalizeRules, DEFAULT_PAYROLL_RULES, PAYROLL_RULE_NUMBER_KEYS, type PayrollRules,
} from '@/lib/payrollRules'

const fmtRp = (v: number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const MONTHS_LONG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const EXAMPLE_DAILY = 100000

type FormState = Record<(typeof PAYROLL_RULE_NUMBER_KEYS)[number], string>

// Periode gaji: 26 bulan lalu – 25 bulan ini, dinamai menurut bulan tanggal 25-nya.
function periodStartFor(d: Date): string {
  const y = d.getFullYear(), m = d.getMonth()
  const start = d.getDate() >= 26 ? new Date(y, m, 26) : new Date(y, m - 1, 26)
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-26`
}
function addPeriods(start: string, n: number): string {
  const [y, m] = start.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 26)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-26`
}
function periodName(start: string): string {
  const [y, m] = start.split('-').map(Number)
  const end = new Date(y, m, 25)
  return `Periode ${MONTHS_LONG[end.getMonth()]} ${end.getFullYear()} (26 ${MONTHS[m - 1]} – 25 ${MONTHS[end.getMonth()]})`
}
function periodMonthYear(start: string): { month: number; year: number } {
  const [y, m] = start.split('-').map(Number)
  const end = new Date(y, m, 25)
  return { month: end.getMonth() + 1, year: end.getFullYear() }
}

function toForm(r: PayrollRules): FormState {
  return Object.fromEntries(PAYROLL_RULE_NUMBER_KEYS.map(k => [k, String(r[k])])) as FormState
}
function num(v: string): number {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

function MultiplierInput({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 block mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input type="text" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        <span className="text-sm text-slate-500">×</span>
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

function EscalationSection({ title, desc, prefix, form, set, color }: {
  title: string; desc: string; prefix: 'izin' | 'sudden' | 'alpha'; form: FormState; set: (k: keyof FormState, v: string) => void; color: string
}) {
  const start = num(form[`${prefix}_start`]), step = num(form[`${prefix}_step`]), max = num(form[`${prefix}_max`])
  const valid = [start, step, max].every(Number.isFinite)
  const tiers = valid ? buildMultipliers(start, step, max) : []
  return (
    <div className="border border-slate-200 rounded-xl p-4">
      <p className={`text-sm font-semibold ${color}`}>{title}</p>
      <p className="text-xs text-slate-500 mb-3">{desc}</p>
      <div className="grid grid-cols-3 gap-3">
        <MultiplierInput label="Hari ke-1" value={form[`${prefix}_start`]} onChange={v => set(`${prefix}_start`, v)} hint="kali gaji harian" />
        <MultiplierInput label="Naik tiap hari" value={form[`${prefix}_step`]} onChange={v => set(`${prefix}_step`, v)} hint="0 = tidak naik" />
        <MultiplierInput label="Mentok di" value={form[`${prefix}_max`]} onChange={v => set(`${prefix}_max`, v)} hint="batas tertinggi" />
      </div>
      {valid && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          {tiers.map((m, i) => (
            <span key={i} className="px-2 py-1 rounded-md bg-slate-100 text-slate-700">
              Hari ke-{i + 1}{i === tiers.length - 1 && tiers.length > 1 ? ' dst' : ''}: <strong>{fmtMultiplier(m)}</strong> = {fmtRp(Math.round(EXAMPLE_DAILY * m))}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PotonganLemburPage() {
  const supabase = createClient()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [tableMissing, setTableMissing] = useState(false)
  const [history, setHistory] = useState<PayrollRules[]>([])
  const [form, setForm] = useState<FormState>(toForm(DEFAULT_PAYROLL_RULES))
  const [effectiveFrom, setEffectiveFrom] = useState(periodStartFor(new Date()))
  const [slipCount, setSlipCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const currentStart = periodStartFor(new Date())
  // Boleh mulai dari periode lalu (slip yang terlambat dibuat) sampai 2 periode ke depan.
  const periodOptions = [-1, 0, 1, 2].map(n => addPeriods(currentStart, n))

  useEffect(() => { init() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { checkSlips(effectiveFrom); loadFormFor(effectiveFrom, history) }, [effectiveFrom]) // eslint-disable-line react-hooks/exhaustive-deps

  async function init() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: u } = await supabase.from('users').select('role').eq('id', user.id).single()
    setCanEdit(['owner', 'hr', 'finance'].includes(u?.role ?? ''))
    const h = await loadHistory()
    loadFormFor(effectiveFrom, h)
    await checkSlips(effectiveFrom)
    setLoading(false)
  }

  async function loadHistory(): Promise<PayrollRules[]> {
    const { data, error } = await supabase.from('payroll_rules').select('*').order('effective_from', { ascending: false })
    if (error) { setTableMissing(true); setHistory([]); return [] }
    const rows = (data || []).map(normalizeRules)
    setHistory(rows)
    return rows
  }

  // Isi form dengan aturan yang berlaku di periode terpilih (supaya tinggal ubah angka yang perlu).
  function loadFormFor(start: string, rows: PayrollRules[]) {
    const r = rows.find(x => x.effective_from <= start) ?? DEFAULT_PAYROLL_RULES
    setForm(toForm(r))
  }

  async function checkSlips(start: string) {
    const { month, year } = periodMonthYear(start)
    const { count } = await supabase.from('payrolls').select('id', { count: 'exact', head: true }).eq('period_month', month).eq('period_year', year)
    setSlipCount(count ?? 0)
  }

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setMsg(null)
    const payload: Record<string, number | string> = { effective_from: effectiveFrom }
    for (const k of PAYROLL_RULE_NUMBER_KEYS) {
      const v = num(form[k])
      if (!Number.isFinite(v) || v < 0) { setMsg({ type: 'error', text: 'Semua angka wajib diisi dan tidak boleh minus.' }); return }
      payload[k] = v
    }
    for (const p of ['izin', 'sudden', 'alpha'] as const) {
      if (Number(payload[`${p}_max`]) < Number(payload[`${p}_start`])) { setMsg({ type: 'error', text: 'Nilai "Mentok di" tidak boleh lebih kecil dari "Hari ke-1".' }); return }
    }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('payroll_rules')
      .upsert({ ...payload, updated_by: user?.id ?? null, updated_at: new Date().toISOString() }, { onConflict: 'effective_from' })
    if (error) { setSaving(false); setMsg({ type: 'error', text: 'Gagal menyimpan: ' + error.message }); return }
    const rows = await loadHistory()
    // Slip DRAFT di periode yang kena aturan ini langsung dihitung ulang (potongan, telat, lembur).
    // Slip yang sudah disetujui/dibayar tidak diubah.
    const next = rows.filter(r => r.effective_from > effectiveFrom).map(r => r.effective_from).sort()[0] ?? null
    const { updated, failed } = await recalcDraftPayrolls(supabase, effectiveFrom, next)
    setSaving(false)
    await checkSlips(effectiveFrom)
    setMsg({
      type: failed > 0 ? 'error' : 'success',
      text: `Tersimpan. Berlaku mulai ${periodName(effectiveFrom)} dan seterusnya sampai ada aturan baru.`
        + (updated > 0 ? ` ${updated} slip draft langsung dihitung ulang dengan angka baru.` : '')
        + (failed > 0 ? ` ${failed} slip gagal dihitung ulang — buat ulang slipnya di Gaji Staff.` : '')
        + ' Slip yang sudah disetujui/dibayar tidak diubah.',
    })
  }

  if (loading) return <div className="text-center py-12 text-slate-500">Memuat...</div>

  const ot = num(form.overtime_rate_per_hour), late = num(form.late_penalty_per_minute)

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Potongan &amp; Lembur</h1>
        <p className="text-sm text-slate-500">Satu tempat untuk semua angka potongan, keterlambatan, dan lembur. Berlaku sama untuk semua staff. Slip gaji, Portal karyawan, Aturan Potongan, dan Panduan otomatis memakai angka di sini.</p>
      </div>

      {tableMissing && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          Tabel pengaturan belum dibuat di database. Jalankan migrasi <code>database/migrations/118_payroll_rules.sql</code> di Supabase SQL Editor dulu. Sementara itu sistem memakai angka bawaan yang ditampilkan di bawah.
        </div>
      )}

      {msg && (
        <div className={`rounded-xl p-3 text-sm border ${msg.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.text}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-5">
        <div>
          <label className="text-sm font-semibold text-slate-800 block mb-1">Berlaku mulai</label>
          <select value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} disabled={!canEdit}
            className="w-full sm:w-auto px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none">
            {periodOptions.map(p => <option key={p} value={p}>{periodName(p)}{p === currentStart ? ' — periode berjalan' : ''}</option>)}
          </select>
          <p className="text-xs text-slate-500 mt-1">Berlaku untuk periode ini dan seterusnya. Periode sebelumnya tidak berubah.</p>
          {slipCount > 0 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">ℹ Sudah ada {slipCount} slip gaji di periode ini. Saat disimpan, slip yang masih draft langsung dihitung ulang (potongan, telat, lembur). Slip yang sudah disetujui/dibayar tidak diubah.</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-emerald-700">Lembur</p>
            <p className="text-xs text-slate-500 mb-3">Dibayar per jam penuh. Team Gudang, karyawan gaji flat, dan yang lemburnya dimatikan di Data Karyawan tetap tidak dapat lembur.</p>
            <label className="text-xs font-medium text-slate-500 block mb-1">Rp / jam</label>
            <RupiahInput value={form.overtime_rate_per_hour} onChange={v => set('overtime_rate_per_hour', v)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            {Number.isFinite(ot) && <p className="text-xs text-slate-400 mt-1">Contoh 2 jam = {fmtRp(ot * 2)}</p>}
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-700">Keterlambatan</p>
            <p className="text-xs text-slate-500 mb-3">Dipotong per menit telat (toleransi absen QR tetap berlaku).</p>
            <label className="text-xs font-medium text-slate-500 block mb-1">Rp / menit</label>
            <RupiahInput value={form.late_penalty_per_minute} onChange={v => set('late_penalty_per_minute', v)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
            {Number.isFinite(late) && <p className="text-xs text-slate-400 mt-1">Contoh telat 15 menit = {fmtRp(late * 15)}</p>}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-800">Potongan tidak masuk kerja</p>
          <p className="text-xs text-slate-500 mb-3">Diisi dalam <strong>kali gaji harian</strong> (gaji harian = gaji pokok + semua tunjangan ÷ 26). Potongan naik per hari tidak masuk dalam 1 periode, lalu mulai dari awal lagi di periode berikutnya. Contoh di bawah memakai gaji harian {fmtRp(EXAMPLE_DAILY)}.</p>
          <div className="space-y-3">
            <EscalationSection title="Izin & Sakit tanpa surat dokter" desc="Izin duka, periksa, keperluan pribadi, dan sakit tanpa surat dihitung bersama." prefix="izin" form={form} set={set} color="text-orange-700" />
            <EscalationSection title="Izin Mendadak" desc="Izin tanpa pemberitahuan H-2. Hitungan harinya sendiri." prefix="sudden" form={form} set={set} color="text-orange-800" />
            <EscalationSection title="Alpha" desc="Tidak masuk tanpa keterangan, termasuk hari kosong yang melebihi jatah libur. Hitungan harinya sendiri." prefix="alpha" form={form} set={set} color="text-red-700" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-700">Sakit dengan surat dokter</p>
            <p className="text-xs text-slate-500 mb-3">Hari sakit dengan surat dalam 1 periode (di luar jatah libur). 0 = gratis.</p>
            <div className="grid grid-cols-3 gap-3">
              <MultiplierInput label="Hari ke-1" value={form.sick_doc_day1} onChange={v => set('sick_doc_day1', v)} />
              <MultiplierInput label="Hari ke-2 & 3" value={form.sick_doc_day2_3} onChange={v => set('sick_doc_day2_3', v)} />
              <MultiplierInput label="Hari ke-4 dst" value={form.sick_doc_day4_plus} onChange={v => set('sick_doc_day4_plus', v)} />
            </div>
          </div>
          <div className="border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-700">Karyawan training</p>
            <p className="text-xs text-slate-500 mb-3">Flat per hari, tidak naik bertahap (Izin, Sakit tanpa surat, Izin Mendadak, Alpha).</p>
            <MultiplierInput label="Potongan per hari" value={form.training_multiplier} onChange={v => set('training_multiplier', v)} />
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs text-slate-600 space-y-1">
          <p className="font-semibold text-slate-700">Denda tetap (belum bisa diubah di halaman ini)</p>
          <p>Lupa Absen Masuk Rp15.000 · Lupa Absen Pulang Rp5.000 per kejadian · Telat ajukan libur Rp10.000 per tanggal. Angka ini masih diatur langsung di database.</p>
          <p>Jatah libur gratis tetap 4 hari per periode (sama dengan kuota Ajukan Libur).</p>
        </div>

        {canEdit ? (
          <button onClick={save} disabled={saving || tableMissing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {saving ? 'Menyimpan...' : `Simpan — berlaku mulai ${periodName(effectiveFrom)}`}
          </button>
        ) : (
          <p className="text-xs text-slate-400">Hanya Owner, HR, dan Finance yang bisa mengubah.</p>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <p className="px-4 pt-4 text-sm font-semibold text-slate-800">Riwayat aturan</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left mt-2">
              <thead className="bg-slate-50 border-y border-slate-200 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-4 py-2">Mulai berlaku</th><th className="px-4 py-2 text-right">Lembur/jam</th><th className="px-4 py-2 text-right">Telat/menit</th>
                  <th className="px-4 py-2">Izin &amp; Sakit</th><th className="px-4 py-2">Izin Mendadak</th><th className="px-4 py-2">Alpha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(h => {
                  const seq = (s: number, st: number, m: number) => { const t = buildMultipliers(s, st, m); return t.length > 1 ? `${fmtMultiplier(t[0])} → maks ${fmtMultiplier(t[t.length - 1])}` : fmtMultiplier(t[0]) }
                  return (
                    <tr key={h.effective_from}>
                      <td className="px-4 py-2 whitespace-nowrap">{h.effective_from < '2026-01-01' ? 'Sebelum Okt 2026' : periodName(h.effective_from)}</td>
                      <td className="px-4 py-2 text-right">{fmtRp(h.overtime_rate_per_hour)}</td>
                      <td className="px-4 py-2 text-right">{fmtRp(h.late_penalty_per_minute)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{h.effective_from < '2026-09-26' ? 'flat 1×' : seq(h.izin_start, h.izin_step, h.izin_max)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{h.effective_from < '2026-09-26' ? 'flat 1×' : seq(h.sudden_start, h.sudden_step, h.sudden_max)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">{h.effective_from < '2026-09-26' ? 'flat 1×' : seq(h.alpha_start, h.alpha_step, h.alpha_max)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
