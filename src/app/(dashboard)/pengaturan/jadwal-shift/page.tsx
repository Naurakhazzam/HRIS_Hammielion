'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil, X, Save, Clock } from 'lucide-react';
import { useSettingsStore } from '@/stores/useSettingsStore';
import Button from '@/components/atoms/Button';
import styles from '../page.module.css';

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
    if (!formData.nama) return alert('Nama shift wajib diisi');
    
    if (editingId) {
      updateShift(editingId, formData);
      setEditingId(null);
    } else {
      addShift(formData);
      setIsAdding(false);
    }
    setFormData({ nama: '', jamMasuk: '08:00', jamPulang: '16:00', toleransiMenit: 15 });
  };

  const startEdit = (shift: import('@/types/settings.types').ShiftConfig) => {
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
    <div className={styles.card}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>Master Shift</h2>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-sub)' }}>
            Tentukan jam kerja dan batas toleransi keterlambatan.
          </p>
        </div>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)}>
            <Plus size={16} />
            &nbsp;Tambah Shift
          </Button>
        )}
      </header>

      {isAdding && (
        <div className={styles.form}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 className={styles.label}>{editingId ? 'Edit Shift' : 'Tambah Shift Baru'}</h3>
            <button onClick={cancelEdit} className={styles.btnIcon}><X size={14} /></button>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label className={styles.label}>Nama Shift</label>
              <input
                className={styles.input}
                value={formData.nama}
                onChange={(e) => setFormData({ ...formData, nama: e.target.value })}
                placeholder="Contoh: Pagi, Siang, Lembur"
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Jam Masuk</label>
              <input
                type="time"
                className={styles.input}
                value={formData.jamMasuk}
                onChange={(e) => setFormData({ ...formData, jamMasuk: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Jam Pulang</label>
              <input
                type="time"
                className={styles.input}
                value={formData.jamPulang}
                onChange={(e) => setFormData({ ...formData, jamPulang: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Toleransi (Menit)</label>
              <input
                type="number"
                className={styles.input}
                value={formData.toleransiMenit}
                onChange={(e) => setFormData({ ...formData, toleransiMenit: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className={styles.formFooter}>
            <Button variant="secondary" onClick={cancelEdit}>Batal</Button>
            <Button onClick={handleSave}>
              <Save size={16} />
              &nbsp;{editingId ? 'Simpan Perubahan' : 'Tambah Shift'}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Nama Shift</th>
              <th>Jam Masuk</th>
              <th>Jam Pulang</th>
              <th>Toleransi</th>
              <th style={{ textAlign: 'right' }}>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => (
              <tr key={shift.id}>
                <td style={{ fontWeight: 600 }}>{shift.nama}</td>
                <td>{shift.jamMasuk}</td>
                <td>{shift.jamPulang}</td>
                <td>{shift.toleransiMenit} Menit</td>
                <td>
                  <div className={styles.actions} style={{ justifyContent: 'flex-end' }}>
                    <button className={styles.btnIcon} onClick={() => startEdit(shift)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className={`${styles.btnIcon} ${styles.danger}`}
                      onClick={() => confirm(`Hapus shift "${shift.nama}"?`) && deleteShift(shift.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {shifts.length === 0 && (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  <Clock size={32} style={{ opacity: 0.2, marginBottom: 8 }} />
                  <p>Belum ada shift yang dikonfigurasi.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
