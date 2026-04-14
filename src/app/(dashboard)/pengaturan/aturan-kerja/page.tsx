'use client';

import { useState } from 'react';
import { Save, MapPin, DollarSign, Target } from 'lucide-react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import Button from '@/components/atoms/Button';
import styles from '../page.module.css';

export default function AturanKerjaPage() {
  const { branches, payrollRules, updateBranch, updatePayrollRules } = useSettingsStore();
  const [saving, setSaving] = useState(false);

  // Local state for payroll rules to allow "Save" button pattern
  const [localRules, setLocalRules] = useState({ ...payrollRules });

  const handleSaveRules = async () => {
    setSaving(true);
    await new Promise(r => setTimeout(r, 400));
    updatePayrollRules(localRules);
    setSaving(false);
  };

  const handleBranchUpdate = (nama: string, field: string, value: number) => {
    updateBranch(nama, { [field]: value });
  };

  return (
    <div className={styles.card}>
      {/* ── 1. Nominal Potongan & Bonus ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <DollarSign size={18} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>Parameter Finansial</h2>
        </div>
        
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <label className={styles.label}>Potongan Terlambat (per menit)</label>
            <input
              type="number"
              className={styles.input}
              value={localRules.potonganTerlambat}
              onChange={(e) => setLocalRules({ ...localRules, potonganTerlambat: Number(e.target.value) })}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-sub)' }}>Contoh: 1500</span>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Potongan Alpha (per kejadian)</label>
            <input
              type="number"
              className={styles.input}
              value={localRules.potonganAlpha}
              onChange={(e) => setLocalRules({ ...localRules, potonganAlpha: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Bonus Kedisiplinan</label>
            <input
              type="number"
              className={styles.input}
              value={localRules.bonusDisiplin}
              onChange={(e) => setLocalRules({ ...localRules, bonusDisiplin: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Ambang Menit Bonus</label>
            <input
              type="number"
              className={styles.input}
              value={localRules.ambangDisiplinMenit}
              onChange={(e) => setLocalRules({ ...localRules, ambangDisiplinMenit: Number(e.target.value) })}
            />
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-sub)' }}>Maks menit terlambat per periode</span>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={handleSaveRules} loading={saving}>
            <Save size={16} />
            &nbsp;Simpan Aturan Finansial
          </Button>
        </div>
      </section>

      <hr style={{ border: 'none', borderBottom: '1px solid var(--color-border)', margin: '24px 0' }} />

      {/* ── 2. Geofencing & Koordinat ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <MapPin size={18} style={{ color: 'var(--color-primary)' }} />
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>Konfigurasi Lokasi Cabang</h2>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nama Cabang</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Radius (Meter)</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.nama}>
                  <td style={{ fontWeight: 600 }}>{branch.nama}</td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      className={styles.input}
                      style={{ height: 32 }}
                      value={branch.latitude}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'latitude', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      className={styles.input}
                      style={{ height: 32 }}
                      value={branch.longitude}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'longitude', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className={styles.input}
                      style={{ height: 32, width: 80 }}
                      value={branch.radiusMeter}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'radiusMeter', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.empty} style={{ padding: '16px 0', border: 'none' }}>
          <Target size={20} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p style={{ fontSize: '80%' }}>Tip: Buka Maps untuk mendapatkan koordinat yang akurat.</p>
        </div>
      </section>
    </div>
  );
}
