'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

// --- TYPES ---
export type BonusRule = {
  id: string
  name: string
  type: 'revenue_tiered' | 'pcs_tiered'
  department_id: string | null
  accumulation_months: number
  cycle_anchor_month: number
  cycle_anchor_year: number
  is_active: boolean
  notes: string | null
  departments: { name: string } | null
}

export type BonusTier = {
  id: string
  bonus_rule_id: string
  tier_order: number
  threshold_value: number
  bonus_amount: number
  label: string | null
}

export type BonusMonthlyEntry = {
  id: string
  bonus_rule_id: string
  period_month: number
  period_year: number
  achievement_value: number
  qualified_tier_id: string | null
  calculated_amount: number
  notes: string | null
  bonus_rules?: { name: string; type: string; departments: { name: string } | null }
  bonus_tiers?: { label: string | null, bonus_amount: number } | null
}

export type BonusCycle = {
  id: string
  bonus_rule_id: string
  cycle_label: string
  cycle_start_month: number
  cycle_start_year: number
  cycle_end_month: number
  cycle_end_year: number
  total_accumulated: number
  status: 'accumulating' | 'ready_to_pay' | 'paid'
  payout_date: string | null
  bonus_rules?: { name: string; departments: { name: string } | null }
}

export type BonusAllocation = {
  id: string
  bonus_cycle_id: string
  employee_id: string
  allocated_amount: number
  status: 'pending' | 'paid' | 'forfeited'
  paid_at: string | null
  notes: string | null
  employees?: { name: string; employee_code: string; full_name?: string }
}

export type Department = { id: string; name: string }
export type Employee = { id: string; full_name: string; employee_code: string }

// --- HELPERS ---
export function getCycleForMonth(
  month: number,
  year: number,
  rule: { cycle_anchor_month: number; cycle_anchor_year: number; accumulation_months: number }
): { startMonth: number; startYear: number; endMonth: number; endYear: number; label: string } {
  const anchorTotal = rule.cycle_anchor_year * 12 + (rule.cycle_anchor_month - 1)
  const inputTotal  = year * 12 + (month - 1)
  const diff        = inputTotal - anchorTotal

  if (diff < 0) throw new Error('Bulan sebelum anchor siklus')

  const cycleIndex       = Math.floor(diff / rule.accumulation_months)
  const cycleStartTotal  = anchorTotal + cycleIndex * rule.accumulation_months
  const cycleEndTotal    = cycleStartTotal + rule.accumulation_months - 1

  const startYear  = Math.floor(cycleStartTotal / 12)
  const startMonth = (cycleStartTotal % 12) + 1
  const endYear    = Math.floor(cycleEndTotal / 12)
  const endMonth   = (cycleEndTotal % 12) + 1

  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des']
  const label = startYear === endYear
    ? `${MONTH_NAMES[startMonth-1]} – ${MONTH_NAMES[endMonth-1]} ${startYear}`
    : `${MONTH_NAMES[startMonth-1]} ${startYear} – ${MONTH_NAMES[endMonth-1]} ${endYear}`

  return { startMonth, startYear, endMonth, endYear, label }
}

export function getQualifiedTier(
  achievementValue: number,
  tiers: BonusTier[]
): BonusTier | null {
  const sorted = [...tiers].sort((a, b) => a.tier_order - b.tier_order)
  for (const tier of sorted) {
    if (achievementValue >= tier.threshold_value) {
      return tier
    }
  }
  return null
}

export const fmtRp = (val: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)

export const fmtNum = (val: number) =>
  new Intl.NumberFormat('id-ID').format(val)

export const MONTH_NAMES = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']

// --- MAIN COMPONENT ---
export default function BonusPage() {
  const [activeTab, setActiveTab] = useState<'aturan' | 'bulanan' | 'siklus'>('aturan')
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  
  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setMessage(null), 5000)
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 mb-1">Bonus Kinerja</h1>
          <p className="text-sm text-slate-500">Kelola aturan, pencapaian bulanan, dan siklus bonus.</p>
        </div>
      </div>

      {/* Alert Message */}
      {message && (
        <div className={`p-4 mb-6 rounded-lg border text-sm ${
          message.type === 'success'
            ? 'bg-green-50 border-green-200 text-green-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {message.text}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-slate-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('aturan')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'aturan' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Aturan Bonus
        </button>
        <button
          onClick={() => setActiveTab('bulanan')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'bulanan' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Input Bulanan
        </button>
        <button
          onClick={() => setActiveTab('siklus')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'siklus' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Siklus & Pencairan
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'aturan' && <TabAturan showMessage={showMessage} />}
      {activeTab === 'bulanan' && <TabBulanan showMessage={showMessage} />}
      {activeTab === 'siklus' && <TabSiklus showMessage={showMessage} />}
    </div>
  )
}


function TabAturan({ showMessage }: { showMessage: (type: 'success'|'error', text: string) => void }) {
  const supabase = createClient()
  const [rules, setRules] = useState<(BonusRule & { tiers: BonusTier[] })[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    name: '', type: 'revenue_tiered', department_id: '',
    accumulation_months: 6, cycle_anchor_month: 1, cycle_anchor_year: new Date().getFullYear(),
    notes: ''
  })

  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null)
  const [tierForm, setTierForm] = useState({ threshold_value: '', bonus_amount: '', label: '' })

  useEffect(() => { fetchRulesAndDepts() }, [])

  async function fetchRulesAndDepts() {
    setLoading(true)
    const { data: depts } = await supabase.from('departments').select('id, name').order('name')
    if (depts) setDepartments(depts)

    const { data: rData } = await supabase.from('bonus_rules').select('*, departments(name)').order('created_at', { ascending: false })
    if (rData) {
      const { data: tData } = await supabase.from('bonus_tiers').select('*').in('bonus_rule_id', rData.map((r:any) => r.id))
      const combined = rData.map((r:any) => ({
        ...r,
        tiers: (tData || []).filter((t: any) => t.bonus_rule_id === r.id).sort((a: any, b: any) => a.tier_order - b.tier_order)
      }))
      setRules(combined as any)
    }
    setLoading(false)
  }

  async function handleAddRule(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const payload = {
      ...formData,
      department_id: formData.department_id || null
    }
    const { error } = await supabase.from('bonus_rules').insert(payload)
    if (error) {
      showMessage('error', 'Gagal menambah aturan: ' + error.message)
    } else {
      showMessage('success', 'Aturan bonus berhasil ditambahkan.')
      setShowForm(false)
      fetchRulesAndDepts()
    }
    setSubmitting(false)
  }

  async function toggleRuleActive(id: string, currentStatus: boolean) {
    const { error } = await supabase.from('bonus_rules').update({ is_active: !currentStatus }).eq('id', id)
    if (error) showMessage('error', 'Gagal update status: ' + error.message)
    else fetchRulesAndDepts()
  }

  async function handleDeleteRule(id: string) {
    if (!confirm('Hapus aturan ini beserta semua tier-nya?')) return
    const { error } = await supabase.from('bonus_rules').delete().eq('id', id)
    if (error) showMessage('error', 'Gagal hapus aturan: ' + error.message)
    else {
      showMessage('success', 'Aturan berhasil dihapus.')
      fetchRulesAndDepts()
    }
  }

  async function reassignTiersOrder(ruleId: string) {
    const { data: currentTiers } = await supabase.from('bonus_tiers').select('*').eq('bonus_rule_id', ruleId)
    if (!currentTiers || currentTiers.length === 0) return
    const sorted = currentTiers.sort((a, b) => b.threshold_value - a.threshold_value)
    
    for (let i = 0; i < sorted.length; i++) {
      await supabase.from('bonus_tiers').update({ tier_order: i + 1 }).eq('id', sorted[i].id)
    }
  }

  async function handleAddTier(e: React.FormEvent, ruleId: string) {
    e.preventDefault()
    const tv = Number(tierForm.threshold_value)
    const ba = Number(tierForm.bonus_amount)
    
    const rule = rules.find(r => r.id === ruleId)
    if (rule?.tiers.some(t => t.threshold_value === tv)) {
      showMessage('error', 'Threshold tersebut sudah digunakan di tier lain.')
      return
    }

    setSubmitting(true)
    const { error } = await supabase.from('bonus_tiers').insert({
      bonus_rule_id: ruleId,
      threshold_value: tv,
      bonus_amount: ba,
      label: tierForm.label || null,
      tier_order: 999 
    })
    
    if (error) {
      showMessage('error', 'Gagal menambah tier: ' + error.message)
    } else {
      await reassignTiersOrder(ruleId)
      showMessage('success', 'Tier berhasil ditambahkan.')
      setTierForm({ threshold_value: '', bonus_amount: '', label: '' })
      fetchRulesAndDepts()
    }
    setSubmitting(false)
  }

  async function handleDeleteTier(tierId: string, ruleId: string) {
    if (!confirm('Hapus tier ini?')) return
    const { error } = await supabase.from('bonus_tiers').delete().eq('id', tierId)
    if (error) showMessage('error', 'Gagal menghapus tier: ' + error.message)
    else {
      await reassignTiersOrder(ruleId)
      showMessage('success', 'Tier berhasil dihapus.')
      fetchRulesAndDepts()
    }
  }

  if (loading) return <div className="p-8 text-center text-slate-500">Memuat aturan...</div>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Aturan Bonus</h2>
          <p className="text-sm text-slate-500">Setup aturan & tier bonus per departemen.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition">
          {showForm ? 'Batal' : '+ Tambah Aturan'}
        </button>
      </div>

      {showForm && (
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <h3 className="font-semibold text-slate-800 mb-4">Form Aturan Baru</h3>
          <form onSubmit={handleAddRule} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Nama Aturan *</label>
              <input required type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" placeholder="Contoh: Bonus Tahunan Sales" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tipe Target *</label>
              <select value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="revenue_tiered">Revenue (Rp)</option>
                <option value="pcs_tiered">Unit (PCS)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Departemen</label>
              <select value={formData.department_id} onChange={e => setFormData({...formData, department_id: e.target.value})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                <option value="">Semua Departemen</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Akumulasi (Bulan) *</label>
              <input required type="number" min="1" max="12" value={formData.accumulation_months} onChange={e => setFormData({...formData, accumulation_months: Number(e.target.value)})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Siklus Mulai (Bulan) *</label>
              <select value={formData.cycle_anchor_month} onChange={e => setFormData({...formData, cycle_anchor_month: Number(e.target.value)})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm">
                {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Siklus Mulai (Tahun) *</label>
              <input required type="number" value={formData.cycle_anchor_year} onChange={e => setFormData({...formData, cycle_anchor_year: Number(e.target.value)})} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <div className="md:col-span-2 flex justify-end mt-2">
              <button disabled={submitting} type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm">
                {submitting ? 'Menyimpan...' : 'Simpan Aturan'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {rules.map(rule => (
          <div key={rule.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-bold text-slate-800 text-base">{rule.name}</h3>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${rule.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                    {rule.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>
                <div className="text-sm text-slate-500 space-y-0.5">
                  <p>🏢 {rule.departments?.name || 'Semua Departemen'} &nbsp;·&nbsp; 🎯 {rule.type === 'revenue_tiered' ? 'Revenue (Rp)' : 'Unit (PCS)'}</p>
                  <p>⏱️ Akumulasi: {rule.accumulation_months} bulan/siklus &nbsp;·&nbsp; 🏁 Mulai: {MONTH_NAMES[rule.cycle_anchor_month - 1]} {rule.cycle_anchor_year}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleRuleActive(rule.id, rule.is_active)} className="px-3 py-1.5 border border-slate-300 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50">
                  {rule.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                </button>
                <button onClick={() => setExpandedRuleId(expandedRuleId === rule.id ? null : rule.id)} className="px-3 py-1.5 border border-blue-200 text-blue-700 bg-blue-50 rounded-lg text-xs font-medium hover:bg-blue-100">
                  Kelola Tier ({rule.tiers.length})
                </button>
                <button onClick={() => handleDeleteRule(rule.id)} className="px-3 py-1.5 border border-red-200 text-red-600 bg-red-50 rounded-lg text-xs font-medium hover:bg-red-100">
                  Hapus
                </button>
              </div>
            </div>

            {expandedRuleId === rule.id && (
              <div className="border-t border-slate-200 bg-slate-50 p-5">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">Tingkat Pencapaian (Tiers)</h4>
                {rule.tiers.length === 0 ? (
                  <p className="text-sm text-slate-500 mb-4">Belum ada tier. Tambahkan di bawah.</p>
                ) : (
                  <div className="overflow-x-auto mb-4 border border-slate-200 rounded-lg">
                    <table className="w-full text-left text-sm bg-white">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-2 font-semibold text-slate-600">Tier</th>
                          <th className="px-4 py-2 font-semibold text-slate-600">Threshold (≥)</th>
                          <th className="px-4 py-2 font-semibold text-slate-600">Nominal Bonus</th>
                          <th className="px-4 py-2 font-semibold text-slate-600">Label</th>
                          <th className="px-4 py-2 font-semibold text-slate-600 text-center">Aksi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rule.tiers.map(t => (
                          <tr key={t.id}>
                            <td className="px-4 py-2 text-slate-700 font-medium">Tier {t.tier_order}</td>
                            <td className="px-4 py-2 text-slate-700">{rule.type === 'revenue_tiered' ? fmtRp(t.threshold_value) : fmtNum(t.threshold_value) + ' PCS'}</td>
                            <td className="px-4 py-2 text-green-600 font-medium">{fmtRp(t.bonus_amount)}</td>
                            <td className="px-4 py-2 text-slate-500">{t.label || '—'}</td>
                            <td className="px-4 py-2 text-center">
                              <button onClick={() => handleDeleteTier(t.id, rule.id)} className="text-red-500 hover:text-red-700 text-xs">Hapus</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                
                <form onSubmit={(e) => handleAddTier(e, rule.id)} className="flex flex-wrap items-end gap-3 bg-white p-3 rounded-lg border border-slate-200 shadow-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Threshold *</label>
                    <input required type="number" min="0" value={tierForm.threshold_value} onChange={e => setTierForm({...tierForm, threshold_value: e.target.value})} className="w-32 px-3 py-1.5 border border-slate-300 rounded text-sm" placeholder="Contoh: 500" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Bonus (Rp) *</label>
                    <input required type="number" min="0" value={tierForm.bonus_amount} onChange={e => setTierForm({...tierForm, bonus_amount: e.target.value})} className="w-32 px-3 py-1.5 border border-slate-300 rounded text-sm" placeholder="Contoh: 1000000" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Label</label>
                    <input type="text" value={tierForm.label} onChange={e => setTierForm({...tierForm, label: e.target.value})} className="w-32 px-3 py-1.5 border border-slate-300 rounded text-sm" placeholder="Opsional" />
                  </div>
                  <button disabled={submitting} type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition">
                    + Tambah Tier
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TabBulanan({ showMessage }: { showMessage: (type: 'success'|'error', text: string) => void }) {
  const supabase = createClient()
  const today = new Date()
  const [filterMonth, setFilterMonth] = useState(today.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(today.getFullYear())
  
  const [rules, setRules] = useState<(BonusRule & { tiers: BonusTier[] })[]>([])
  const [entries, setEntries] = useState<Record<string, BonusMonthlyEntry>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  const [inputs, setInputs] = useState<Record<string, string>>({})

  useEffect(() => { fetchData() }, [filterMonth, filterYear])

  async function fetchData() {
    setLoading(true)
    const { data: rData } = await supabase.from('bonus_rules').select('*, departments(name)').eq('is_active', true)
    if (rData) {
      const ruleIds = rData.map((r:any) => r.id)
      const { data: tData } = await supabase.from('bonus_tiers').select('*').in('bonus_rule_id', ruleIds)
      
      const combinedRules = rData.map((r:any) => ({
        ...r,
        tiers: (tData || []).filter((t: any) => t.bonus_rule_id === r.id).sort((a: any, b: any) => a.tier_order - b.tier_order)
      }))
      setRules(combinedRules as any)

      const { data: eData } = await supabase
        .from('bonus_monthly_entries')
        .select('*')
        .in('bonus_rule_id', ruleIds)
        .eq('period_month', filterMonth)
        .eq('period_year', filterYear)

      const entriesMap: Record<string, any> = {}
      const initInputs: Record<string, string> = {}
      if (eData) {
        eData.forEach((e:any) => {
          entriesMap[e.bonus_rule_id] = e
          initInputs[e.bonus_rule_id] = e.achievement_value.toString()
        })
      }
      setEntries(entriesMap)
      setInputs(initInputs)
    }
    setLoading(false)
  }

  async function handleSave(ruleId: string) {
    const valStr = inputs[ruleId]
    if (!valStr || isNaN(Number(valStr))) {
      showMessage('error', 'Masukkan nilai pencapaian yang valid.')
      return
    }
    const achValue = Number(valStr)
    const rule = rules.find(r => r.id === ruleId)
    if (!rule) return

    setSaving(ruleId)
    
    const qualifiedTier = getQualifiedTier(achValue, rule.tiers)
    const calcAmount = qualifiedTier ? qualifiedTier.bonus_amount : 0
    const tierId = qualifiedTier ? qualifiedTier.id : null

    const entryPayload = {
      bonus_rule_id: ruleId,
      period_month: filterMonth,
      period_year: filterYear,
      achievement_value: achValue,
      qualified_tier_id: tierId,
      calculated_amount: calcAmount
    }

    const { data: upsertData, error: upsertErr } = await supabase
      .from('bonus_monthly_entries')
      .upsert(entryPayload, { onConflict: 'bonus_rule_id, period_month, period_year' })
      .select()
      .single()

    if (upsertErr) {
      showMessage('error', 'Gagal simpan entry: ' + upsertErr.message)
      setSaving(null)
      return
    }

    try {
      const cycleInfo = getCycleForMonth(filterMonth, filterYear, rule)
      
      const { data: existCycle } = await supabase
        .from('bonus_cycles')
        .select('id')
        .eq('bonus_rule_id', ruleId)
        .eq('cycle_start_month', cycleInfo.startMonth)
        .eq('cycle_start_year', cycleInfo.startYear)
        .single()
      
      let cycleId = existCycle?.id
      
      if (!cycleId) {
        const { data: newCycle, error: cycleErr } = await supabase
          .from('bonus_cycles')
          .insert({
            bonus_rule_id: ruleId,
            cycle_label: cycleInfo.label,
            cycle_start_month: cycleInfo.startMonth,
            cycle_start_year: cycleInfo.startYear,
            cycle_end_month: cycleInfo.endMonth,
            cycle_end_year: cycleInfo.endYear,
            total_accumulated: 0,
            status: 'accumulating'
          })
          .select('id')
          .single()
        
        if (cycleErr) throw cycleErr
        cycleId = newCycle.id
      }

      const { data: allEntriesInCycle } = await supabase
        .from('bonus_monthly_entries')
        .select('calculated_amount, period_month, period_year')
        .eq('bonus_rule_id', ruleId)
        
      const sum = (allEntriesInCycle || [])
        .filter((e:any) => {
          const eVal = e.period_year * 12 + e.period_month
          const sVal = cycleInfo.startYear * 12 + cycleInfo.startMonth
          const endVal = cycleInfo.endYear * 12 + cycleInfo.endMonth
          return eVal >= sVal && eVal <= endVal
        })
        .reduce((acc:number, curr:any) => acc + Number(curr.calculated_amount), 0)

      await supabase.from('bonus_cycles').update({ total_accumulated: sum }).eq('id', cycleId)
      
      showMessage('success', 'Pencapaian bulanan berhasil disimpan dan siklus diupdate.')
      fetchData()
    } catch (err: any) {
      showMessage('error', 'Entry tersimpan, tapi gagal update siklus: ' + err.message)
    }

    setSaving(null)
  }

  const yearOptions = Array.from({ length: 4 }, (_, i) => today.getFullYear() - i + 1)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Input Pencapaian Bulanan</h2>
          <p className="text-sm text-slate-500">Masukkan pencapaian aktual untuk menghitung bonus bulanan.</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={filterMonth} onChange={e => setFilterMonth(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {MONTH_NAMES.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
          <select value={filterYear} onChange={e => setFilterYear(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center p-8 text-slate-500">Memuat data...</div>
      ) : rules.length === 0 ? (
        <div className="text-center p-8 bg-white border border-slate-200 rounded-xl text-slate-500">Tidak ada aturan bonus yang aktif.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rules.map(rule => {
            const currentInput = inputs[rule.id] || ''
            const numVal = Number(currentInput)
            const qualifiedTier = !isNaN(numVal) ? getQualifiedTier(numVal, rule.tiers) : null
            const hasEntry = !!entries[rule.id]
            const typeLabel = rule.type === 'revenue_tiered' ? 'Pencapaian Omset (Rp)' : 'Pencapaian Unit (PCS)'

            return (
              <div key={rule.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-bold text-slate-800">{rule.name}</h3>
                      <p className="text-xs text-slate-500">{rule.departments?.name || 'Semua Departemen'} &nbsp;·&nbsp; {rule.type === 'revenue_tiered' ? 'Rp' : 'PCS'}</p>
                    </div>
                    {hasEntry && <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded uppercase">Tersimpan</span>}
                  </div>
                  
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-slate-600 mb-1">{typeLabel}</label>
                    <input 
                      type="number" 
                      min="0" 
                      value={currentInput} 
                      onChange={e => setInputs({...inputs, [rule.id]: e.target.value})} 
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="Masukkan nilai pencapaian..."
                    />
                  </div>
                  
                  <div className="mb-4 text-sm p-3 rounded-lg bg-slate-50 border border-slate-100">
                    <p className="text-xs text-slate-500 mb-1 font-medium">Preview Kalkulasi:</p>
                    {currentInput === '' ? (
                      <span className="text-slate-400">—</span>
                    ) : qualifiedTier ? (
                      <span className="text-green-600 font-medium">Lolos Tier {qualifiedTier.tier_order} → Bonus {fmtRp(qualifiedTier.bonus_amount)}</span>
                    ) : (
                      <span className="text-slate-500">Tidak ada tier terpenuhi → Rp 0</span>
                    )}
                  </div>
                </div>
                
                <button 
                  onClick={() => handleSave(rule.id)} 
                  disabled={saving === rule.id}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg transition disabled:opacity-50"
                >
                  {saving === rule.id ? 'Menyimpan...' : 'Simpan Pencapaian'}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TabSiklus({ showMessage }: { showMessage: (type: 'success'|'error', text: string) => void }) {
  const supabase = createClient()
  const [filterStatus, setFilterStatus] = useState<string>('')
  
  const [cycles, setCycles] = useState<BonusCycle[]>([])
  const [loading, setLoading] = useState(true)
  
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null)
  
  const [monthlyEntries, setMonthlyEntries] = useState<any[]>([])
  const [allocations, setAllocations] = useState<BonusAllocation[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  const [allocForm, setAllocForm] = useState<Record<string, string>>({})
  const [submittingAlloc, setSubmittingAlloc] = useState(false)

  useEffect(() => { fetchCycles() }, [filterStatus])

  async function fetchCycles() {
    setLoading(true)
    let query = supabase.from('bonus_cycles').select('*, bonus_rules(name, department_id, departments(name))').order('created_at', { ascending: false })
    if (filterStatus) query = query.eq('status', filterStatus)
    
    const { data } = await query
    if (data) setCycles(data as any)
    setLoading(false)
  }

  async function handleExpandCycle(cycle: any) {
    if (expandedCycleId === cycle.id) {
      setExpandedCycleId(null)
      return
    }
    setExpandedCycleId(cycle.id)
    setLoadingDetail(true)

    const { data: mData } = await supabase
      .from('bonus_monthly_entries')
      .select('*, bonus_tiers(label)')
      .eq('bonus_rule_id', cycle.bonus_rule_id)
      
    const filteredEntries = (mData || []).filter((e: any) => {
      const eVal = e.period_year * 12 + e.period_month
      const sVal = cycle.cycle_start_year * 12 + cycle.cycle_start_month
      const endVal = cycle.cycle_end_year * 12 + cycle.cycle_end_month
      return eVal >= sVal && eVal <= endVal
    }).sort((a: any, b: any) => (a.period_year * 12 + a.period_month) - (b.period_year * 12 + b.period_month))
    
    setMonthlyEntries(filteredEntries)

    const { data: aData } = await supabase
      .from('bonus_employee_allocations')
      .select('*, employees(full_name, employee_code)')
      .eq('bonus_cycle_id', cycle.id)
    
    setAllocations((aData as any) || [])

    const deptId = cycle.bonus_rules?.department_id
    let empQuery = supabase.from('employees').select('id, full_name, employee_code').eq('is_active', true)
    if (deptId) {
      empQuery = empQuery.eq('department_id', deptId)
    }
    const { data: empData } = await empQuery
    setEmployees((empData as any) || [])

    const formInit: Record<string, string> = {}
    if (aData) {
      aData.forEach((a: any) => formInit[a.employee_id] = a.allocated_amount.toString())
    }
    setAllocForm(formInit)

    setLoadingDetail(false)
  }

  async function handleSaveAllocations(cycle: any) {
    setSubmittingAlloc(true)
    const payloads: any[] = []
    
    for (const [empId, valStr] of Object.entries(allocForm)) {
      const amt = Number(valStr)
      if (amt > 0 || (amt === 0 && allocations.some(a => a.employee_id === empId))) {
        payloads.push({
          bonus_cycle_id: cycle.id,
          employee_id: empId,
          allocated_amount: amt,
          status: 'pending'
        })
      }
    }

    if (payloads.length > 0) {
      const { error } = await supabase
        .from('bonus_employee_allocations')
        .upsert(payloads, { onConflict: 'bonus_cycle_id, employee_id' })
      
      if (error) showMessage('error', 'Gagal menyimpan alokasi: ' + error.message)
      else {
        showMessage('success', 'Alokasi berhasil disimpan.')
        const { data: aData } = await supabase
          .from('bonus_employee_allocations')
          .select('*, employees(full_name, employee_code)')
          .eq('bonus_cycle_id', cycle.id)
        setAllocations((aData as any) || [])
      }
    } else {
      showMessage('error', 'Tidak ada alokasi > 0 untuk disimpan.')
    }
    setSubmittingAlloc(false)
  }

  async function updateCycleStatus(cycleId: string, status: 'ready_to_pay' | 'paid') {
    if (status === 'paid') {
      if (!confirm('Cairkan bonus siklus ini? Semua alokasi akan ditandai Lunas.')) return
    } else {
      if (!confirm('Tandai siklus ini siap cair?')) return
    }

    const { error } = await supabase
      .from('bonus_cycles')
      .update({ status, payout_date: status === 'paid' ? new Date().toISOString() : null })
      .eq('id', cycleId)

    if (error) {
      showMessage('error', 'Gagal update status siklus: ' + error.message)
      return
    }

    if (status === 'paid') {
      await supabase
        .from('bonus_employee_allocations')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('bonus_cycle_id', cycleId)
        .eq('status', 'pending')
    }

    showMessage('success', `Status siklus berhasil diperbarui menjadi ${status}.`)
    fetchCycles()
    if (expandedCycleId === cycleId) {
      setExpandedCycleId(null)
    }
  }
  
  async function forfeitAllocation(allocId: string) {
    if (!confirm('Tandai alokasi ini sebagai hangus? (Misal karyawan resign)')) return
    const { error } = await supabase
      .from('bonus_employee_allocations')
      .update({ status: 'forfeited' })
      .eq('id', allocId)
    
    if (error) showMessage('error', 'Gagal menandai hangus: ' + error.message)
    else {
      showMessage('success', 'Alokasi ditandai hangus.')
      const { data: aData } = await supabase
        .from('bonus_employee_allocations')
        .select('*, employees(full_name, employee_code)')
        .eq('bonus_cycle_id', expandedCycleId)
      setAllocations((aData as any) || [])
    }
  }

  const currentTotalAllocated = Object.values(allocForm).reduce((acc, val) => acc + (Number(val) || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Siklus Akumulasi & Pencairan</h2>
          <p className="text-sm text-slate-500">Kelola distribusi dan pencairan bonus dari total akumulasi bulanan.</p>
        </div>
        <div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white outline-none">
            <option value="">Semua Status</option>
            <option value="accumulating">Sedang Berjalan</option>
            <option value="ready_to_pay">Siap Cair</option>
            <option value="paid">Sudah Cair</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-center p-8 text-slate-500">Memuat data siklus...</div>
      ) : cycles.length === 0 ? (
        <div className="text-center p-8 bg-white border border-slate-200 rounded-xl text-slate-500">Belum ada siklus berjalan.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {cycles.map(cycle => {
            const isExpanded = expandedCycleId === cycle.id
            const isAccumulating = cycle.status === 'accumulating'
            const isReady = cycle.status === 'ready_to_pay'
            const isPaid = cycle.status === 'paid'
            
            let statusBadge = <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-xs font-semibold">Unknown</span>
            if (isAccumulating) statusBadge = <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">Sedang Berjalan</span>
            if (isReady) statusBadge = <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-semibold">Siap Cair</span>
            if (isPaid) statusBadge = <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">Sudah Cair</span>

            return (
              <div key={cycle.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-bold text-slate-800 text-base">{cycle.bonus_rules?.name || 'Aturan Dihapus'}</h3>
                      {statusBadge}
                    </div>
                    <div className="text-sm text-slate-500 space-y-0.5">
                      <p>Siklus: {cycle.cycle_label}</p>
                      <p>Departemen: {cycle.bonus_rules?.departments?.name || 'Semua Departemen'}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-slate-500 mb-0.5">Total Akumulasi</p>
                      <p className="font-bold text-slate-800 text-lg">{fmtRp(cycle.total_accumulated)}</p>
                    </div>
                    <button 
                      onClick={() => handleExpandCycle(cycle)}
                      className="px-4 py-2 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium transition"
                    >
                      {isExpanded ? 'Tutup Detail' : 'Lihat Detail'}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50 p-5 space-y-6">
                    {loadingDetail ? (
                      <div className="text-center py-4 text-slate-500">Memuat rincian...</div>
                    ) : (
                      <>
                        <div>
                          <h4 className="font-bold text-slate-700 mb-3 border-b border-slate-200 pb-2">A. Rincian Akumulasi Bulanan</h4>
                          {monthlyEntries.length === 0 ? (
                            <p className="text-sm text-slate-500">Belum ada pencapaian di siklus ini.</p>
                          ) : (
                            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-slate-100 border-b border-slate-200">
                                  <tr>
                                    <th className="px-4 py-2 font-semibold text-slate-600">Bulan</th>
                                    <th className="px-4 py-2 font-semibold text-slate-600">Pencapaian</th>
                                    <th className="px-4 py-2 font-semibold text-slate-600">Tier Lolos</th>
                                    <th className="px-4 py-2 font-semibold text-slate-600 text-right">Bonus Terkumpul</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {monthlyEntries.map(e => (
                                    <tr key={e.id}>
                                      <td className="px-4 py-2 text-slate-700">{MONTH_NAMES[e.period_month-1]} {e.period_year}</td>
                                      <td className="px-4 py-2 text-slate-700">{fmtNum(e.achievement_value)}</td>
                                      <td className="px-4 py-2 text-slate-700">{e.bonus_tiers?.label || '—'}</td>
                                      <td className="px-4 py-2 text-right font-medium text-green-600">{fmtRp(e.calculated_amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="bg-slate-50 font-bold">
                                    <td colSpan={3} className="px-4 py-2 text-right text-slate-700">Total Akumulasi:</td>
                                    <td className="px-4 py-2 text-right text-slate-900">{fmtRp(cycle.total_accumulated)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-3 border-b border-slate-200 pb-2">
                            <h4 className="font-bold text-slate-700">B. Alokasi Karyawan</h4>
                            <div className="text-right">
                              <span className="text-xs text-slate-500">Dialokasikan: </span>
                              <span className={`text-sm font-bold ${currentTotalAllocated > cycle.total_accumulated ? 'text-red-600' : 'text-green-600'}`}>
                                {fmtRp(currentTotalAllocated)}
                              </span>
                              <span className="text-xs text-slate-500"> / {fmtRp(cycle.total_accumulated)}</span>
                            </div>
                          </div>

                          {!isPaid && (
                            <form onSubmit={(e) => { e.preventDefault(); handleSaveAllocations(cycle) }} className="mb-6 bg-white p-4 border border-slate-200 rounded-lg shadow-sm">
                              <p className="text-xs text-slate-500 mb-4">Masukkan nominal alokasi untuk karyawan. Karyawan dengan nominal 0 tidak akan dibuatkan alokasi.</p>
                              
                              <div className="max-h-60 overflow-y-auto pr-2 space-y-2 mb-4">
                                {employees.map(emp => {
                                  // if employee not active anymore, but has allocation, show it? the query filtered active only. 
                                  // For a full implementation, we might want to fetch all that have allocs.
                                  return (
                                    <div key={emp.id} className="flex justify-between items-center gap-4 p-2 bg-slate-50 rounded border border-slate-100">
                                      <div>
                                        <p className="font-medium text-slate-800 text-sm">{emp.full_name}</p>
                                        <p className="text-xs text-slate-500">{emp.employee_code}</p>
                                      </div>
                                      <input 
                                        type="number" 
                                        min="0"
                                        value={allocForm[emp.id] || ''} 
                                        onChange={e => setAllocForm({...allocForm, [emp.id]: e.target.value})} 
                                        className="w-32 px-3 py-1.5 border border-slate-300 rounded text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="Rp"
                                      />
                                    </div>
                                  )
                                })}
                              </div>
                              
                              <div className="flex justify-end gap-3">
                                {currentTotalAllocated > cycle.total_accumulated && (
                                  <span className="text-xs text-red-500 self-center">Peringatan: Total alokasi melebihi total akumulasi!</span>
                                )}
                                <button disabled={submittingAlloc} type="submit" className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition disabled:opacity-50">
                                  {submittingAlloc ? 'Menyimpan...' : 'Simpan Alokasi'}
                                </button>
                              </div>
                            </form>
                          )}

                          {allocations.length > 0 && (
                            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-slate-100 border-b border-slate-200">
                                  <tr>
                                    <th className="px-4 py-2 font-semibold text-slate-600">Karyawan</th>
                                    <th className="px-4 py-2 font-semibold text-slate-600 text-right">Alokasi</th>
                                    <th className="px-4 py-2 font-semibold text-slate-600 text-center">Status</th>
                                    {!isPaid && <th className="px-4 py-2 font-semibold text-slate-600 text-center">Aksi</th>}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                  {allocations.map(a => (
                                    <tr key={a.id}>
                                      <td className="px-4 py-2">
                                        <p className="font-medium text-slate-700">{a.employees?.full_name}</p>
                                        <p className="text-xs text-slate-500">{a.employees?.employee_code}</p>
                                      </td>
                                      <td className="px-4 py-2 text-right font-bold text-slate-800">{fmtRp(a.allocated_amount)}</td>
                                      <td className="px-4 py-2 text-center">
                                        {a.status === 'pending' && <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">Menunggu</span>}
                                        {a.status === 'paid' && <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-[10px] font-bold uppercase">Sudah Cair</span>}
                                        {a.status === 'forfeited' && <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-[10px] font-bold uppercase">Hangus</span>}
                                      </td>
                                      {!isPaid && (
                                        <td className="px-4 py-2 text-center">
                                          {a.status === 'pending' && (
                                            <button onClick={() => forfeitAllocation(a.id)} className="text-xs text-red-500 hover:text-red-700 font-medium">Tandai Hangus</button>
                                          )}
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {!isPaid && (
                          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                            {isAccumulating && (
                              <button onClick={() => updateCycleStatus(cycle.id, 'ready_to_pay')} className="px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-100 font-medium text-sm rounded-lg transition">
                                Tandai Siap Cair
                              </button>
                            )}
                            {(isAccumulating || isReady) && allocations.some(a => a.status === 'pending') && (
                              <button onClick={() => updateCycleStatus(cycle.id, 'paid')} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium text-sm rounded-lg transition shadow-sm">
                                Cairkan Bonus Siklus Ini
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

