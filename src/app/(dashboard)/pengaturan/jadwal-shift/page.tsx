'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Save, Clock, Calendar, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { ShiftConfig } from '@/types/settings.types';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-hot-toast';
import styles from '../aturan-kerja/rules.module.css';

export default function JadwalShiftPage() {
  const { shifts, addShift, deleteShift, updateShift } = useSettingsStore();
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [formData, setFormData] = useState({
    nama: '',
    jamMasuk: '08:00',
    jamPulang: '16:00',
    toleransiMenit: 15,
  });

  const handleSave = () => {
    if (!formData.nama) return toast.error('Nama shift wajib diisi');
    
    if (editingId) {
      updateShift(editingId, formData);
      toast.success('Shift diperbarui');
      setEditingId(null);
    } else {
      addShift(formData);
      toast.success('Shift baru ditambahkan');
      setIsAdding(false);
    }
    setFormData({ nama: '', jamMasuk: '08:00', jamPulang: '16:00', toleransiMenit: 15 });
  };

  const startEdit = (shift: ShiftConfig) => {
    setEditingId(shift.id);
    setFormData({
      nama: shift.nama,
      jamMasuk: shift.jamMasuk,
      jamPulang: shift.jamPulang,
      toleransiMenit: shift.toleransiMenit,
    });
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ nama: '', jamMasuk: '08:00', jamPulang: '16:00', toleransiMenit: 15 });
  };

  return (
    <motion.div 
      className={styles.container}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      {/* Header & New Shift Trigger */}
      <section className={styles.section}>
        <div className="flex justify-between items-center">
          <div className={styles.sectionHeader}>
            <div className={`${styles.iconWrapper} bg-teal-500/10 text-teal-500`}>
              <Calendar size={20} />
            </div>
            <div>
              <h2 className={styles.sectionTitle}>Master Shift Kerja</h2>
              <p className={styles.sectionSubtitle}>Kelola jam operasional dan toleransi keterlambatan.</p>
            </div>
          </div>
          {!isAdding && (
            <button className={styles.saveButton} onClick={() => setIsAdding(true)}>
              <Plus size={18} />
              Tambah Shift
            </button>
          )}
        </div>

        {/* Add/Edit Form */}
        <AnimatePresence>
          {isAdding && (
            <motion.div 
              className="mt-4 p-6 bg-white/5 rounded-2xl border border-white/10 flex flex-col gap-6"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold uppercase tracking-widest text-[#0d9488]">
                  {editingId ? 'Edit Konfigurasi Shift' : 'Konfigurasi Shift Baru'}
                </h3>
                <button onClick={cancelEdit} className="text-white/40 hover:text-white"><X size={18} /></button>
              </div>

              <div className={styles.grid}>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Nama Shift</label>
                  <div className={styles.inputWrapper}>
                    <span className={styles.inputIcon}><Calendar size={16} /></span>
                    <input
                      className={styles.input}
                      value={formData.nama}
                      onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                      placeholder="Misal: Pagi, Siang, Full"
                    />
                  </div>
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Jam Masuk</label>
                  <div className={styles.inputWrapper}>
                    <span className={styles.inputIcon}><Clock size={16} /></span>
                    <input
                      type="time"
                      className={styles.input}
                      value={formData.jamMasuk}
                      onChange={(e) => setFormData({ ...formData, jamMasuk: e.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Jam Pulang</label>
                  <div className={styles.inputWrapper}>
                    <span className={styles.inputIcon}><Clock size={16} /></span>
                    <input
                      type="time"
                      className={styles.input}
                      value={formData.jamPulang}
                      onChange={(e) => setFormData({ ...formData, jamPulang: e.target.value })}
                    />
                  </div>
                </div>
                <div className={styles.inputGroup}>
                  <label className={styles.label}>Toleransi (Menit)</label>
                  <div className={styles.inputWrapper}>
                    <span className={styles.inputIcon}><AlertCircle size={16} /></span>
                    <input
                      type="number"
                      className={styles.input}
                      value={formData.toleransiMenit}
                      onChange={(e) => setFormData({ ...formData, toleransiMenit: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <button 
                  className="px-6 py-3 rounded-xl font-bold text-sm bg-white/5 hover:bg-white/10 text-white transition-all"
                  onClick={cancelEdit}
                >
                  Batal
                </button>
                <button 
                  className={styles.saveButton}
                  onClick={handleSave}
                >
                  <Save size={18} />
                  Simpan Shift
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Shift List Table */}
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Nama Shift</th>
                <th>Masuk</th>
                <th>Pulang</th>
                <th>Toleransi</th>
                <th style={{ textAlign: 'right' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((shift) => (
                <tr key={shift.id}>
                  <td className="font-bold">{shift.nama}</td>
                  <td className="text-teal-400 font-mono">{shift.jamMasuk}</td>
                  <td className="text-teal-400 font-mono">{shift.jamPulang}</td>
                  <td>{shift.toleransiMenit} Menit</td>
                  <td>
                    <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                      <button className={styles.iconBtn} onClick={() => startEdit(shift)}>
                        <Pencil size={14} />
                      </button>
                      <button 
                        className={`${styles.iconBtn} ${styles.danger}`}
                        onClick={() => {
                          if (confirm(`Hapus shift "${shift.nama}"?`)) {
                            deleteShift(shift.id);
                            toast.success('Shift dihapus');
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className={styles.emptyState}>
                      <Clock size={40} className="mb-4" />
                      <p>Belum ada daftar shift kerja.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </motion.div>
  );
}
