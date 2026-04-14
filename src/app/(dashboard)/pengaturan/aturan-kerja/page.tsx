'use client';

import { useState } from 'react';
import { Save, MapPin, DollarSign, ShieldCheck, Target, Info } from 'lucide-react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import styles from './rules.module.css';

export default function AturanKerjaPage() {
  const { branches, payrollRules, updateBranch, updatePayrollRules } = useSettingsStore();
  const [saving, setSaving] = useState(false);

  // Local state for payroll rules to allow "Save" button pattern
  const [localRules, setLocalRules] = useState({ ...payrollRules });

  const handleSaveRules = async () => {
    setSaving(true);
    try {
      // Simulate API call
      await new Promise(r => setTimeout(r, 600));
      updatePayrollRules(localRules);
      toast.success('Aturan operasional berhasil disimpan');
    } catch (_error) {
      toast.error('Gagal menyimpan aturan');
    } finally {
      setSaving(false);
    }
  };

  const handleBranchUpdate = (nama: string, field: string, value: number) => {
    updateBranch(nama, { [field]: value });
    toast.success(`${nama} diperbarui`, { duration: 1000 });
  };

  return (
    <motion.div 
      className={styles.container}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      {/* ── 1. Parameter Finansial ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.iconWrapper}>
            <DollarSign size={20} />
          </div>
          <div>
            <h2 className={styles.sectionTitle}>Parameter Finansial</h2>
            <p className={styles.sectionSubtitle}>Atur denda keterlambatan dan bonus kedisiplinan karyawan.</p>
          </div>
        </div>
        
        <div className={styles.grid}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Denda Terlambat (per menit)</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>Rp</span>
              <input
                type="number"
                className={styles.input}
                value={localRules.potonganTerlambat}
                onChange={(e) => setLocalRules({ ...localRules, potonganTerlambat: Number(e.target.value) })}
              />
            </div>
            <p className={styles.inputHint}>Denda akumulasi per menit keterlambatan.</p>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Potongan Alpha (per hari)</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>Rp</span>
              <input
                type="number"
                className={styles.input}
                value={localRules.potonganAlpha}
                onChange={(e) => setLocalRules({ ...localRules, potonganAlpha: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Bonus Kedisiplinan</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}>Rp</span>
              <input
                type="number"
                className={styles.input}
                value={localRules.bonusDisiplin}
                onChange={(e) => setLocalRules({ ...localRules, bonusDisiplin: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className={styles.inputGroup}>
            <label className={styles.label}>Ambang Menit Bonus (Max)</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}><Target size={16} /></span>
              <input
                type="number"
                className={styles.input}
                value={localRules.ambangDisiplinMenit}
                onChange={(e) => setLocalRules({ ...localRules, ambangDisiplinMenit: Number(e.target.value) })}
              />
            </div>
            <p className={styles.inputHint}>Max total menit telat per bulan untuk dapat bonus.</p>
          </div>
        </div>
      </section>

      {/* ── 2. Keamanan & Otentikasi ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={`${styles.iconWrapper} bg-amber-500/10 text-amber-500`}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <h2 className={styles.sectionTitle}>Keamanan & Otentikasi</h2>
            <p className={styles.sectionSubtitle}>Atur kode keamanan untuk operasional khusus.</p>
          </div>
        </div>

        <div className={styles.grid}>
          <div className={styles.inputGroup}>
            <label className={styles.label}>Master Auth Code (Pindah Tugas)</label>
            <div className={styles.inputWrapper}>
              <span className={styles.inputIcon}><ShieldCheck size={16} /></span>
              <input
                type="text"
                className={styles.input}
                style={{ letterSpacing: '0.2em', fontWeight: '800' }}
                value={localRules.masterAuthCode}
                onChange={(e) => setLocalRules({ ...localRules, masterAuthCode: e.target.value.toUpperCase() })}
              />
            </div>
            <p className={styles.inputHint}>Digunakan karyawan saat absen di cabang yang bukan asalnya.</p>
          </div>
          
          <div className="flex items-end pb-8">
            <button 
              className={styles.saveButton}
              onClick={handleSaveRules}
              disabled={saving}
            >
              <Save size={18} />
              {saving ? 'Menyimpan...' : 'Simpan Semua Aturan'}
            </button>
          </div>
        </div>
      </section>

      {/* ── 3. Geofencing ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={`${styles.iconWrapper} bg-blue-500/10 text-blue-500`}>
            <MapPin size={20} />
          </div>
          <div>
            <h2 className={styles.sectionTitle}>Titik Geofencing Cabang</h2>
            <p className={styles.sectionSubtitle}>Tentukan koordinat GPS dan radius deteksi absensi.</p>
          </div>
        </div>

        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Lokasi</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Radius (m)</th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.nama}>
                  <td className="font-bold">{branch.nama}</td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      className={styles.tableInput}
                      value={branch.latitude}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'latitude', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.000001"
                      className={styles.tableInput}
                      value={branch.longitude}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'longitude', Number(e.target.value))}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      className={styles.tableInput}
                      style={{ width: '80px' }}
                      value={branch.radiusMeter}
                      onChange={(e) => handleBranchUpdate(branch.nama, 'radiusMeter', Number(e.target.value))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="flex items-center gap-2 p-4 bg-blue-500/5 rounded-xl border border-blue-500/10">
          <Info size={16} className="text-blue-400 shrink-0" />
          <p className="text-xs text-blue-200/60 leading-relaxed">
            Perubahan koordinat akan berpengaruh langsung pada kemampuan deteksi lokasi absensi karyawan di halaman Input Absensi.
          </p>
        </div>
      </section>
    </motion.div>
  );
}
