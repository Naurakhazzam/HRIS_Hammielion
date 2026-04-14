'use client';

import React, { useState } from 'react';
import { useAbsensiStore } from '@/stores/useAbsensiStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAuthStore } from '@/stores/useAuthStore'; // To get current user
import styles from '@/app/(dashboard)/absensi/input/absensi.module.css';
import { LogIn, LogOut, ShieldCheck, X } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'react-hot-toast';

interface ClockControlsProps {
  currentBranch: string | null;
  isMainBranch: boolean;
  lat: number | null;
  lng: number | null;
}

export const ClockControls: React.FC<ClockControlsProps> = ({
  currentBranch,
  isMainBranch,
  lat,
  lng
}) => {
  const { user } = useAuthStore();
  const { addRecord, updateRecord, getTodayRecord } = useAbsensiStore();
  const masterAuthCode = useSettingsStore((state) => state.payrollRules.masterAuthCode);
  
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authCodeInput, setAuthCodeInput] = useState('');
  const [pendingAction, setPendingAction] = useState<'masuk' | 'pulang' | null>(null);

  const todayRecord = user ? getTodayRecord(user.id) : undefined;
  const isClockedIn = !!todayRecord?.jamMasuk;
  const isClockedOut = !!todayRecord?.jamKeluar;

  const handleClockIn = () => {
    if (!currentBranch) {
      toast.error('Lokasi Anda tidak valid untuk absen');
      return;
    }

    if (!isMainBranch) {
      setPendingAction('masuk');
      setShowAuthModal(true);
      return;
    }

    executeClockIn();
  };

  const executeClockIn = () => {
    if (!user) return;
    
    const now = new Date();
    // In a real app, we'd calculate menitTerlambat here using useSettingsStore shifts
    // For now, let's keep it simple as the foundation is already there in store actions
    
    addRecord({
      id: `abs-${user.karyawanId || user.id}-${format(now, 'yyyy-MM-dd')}`,
      karyawanId: user.karyawanId || user.id,
      tanggal: format(now, 'yyyy-MM-dd'),
      jamMasuk: format(now, 'HH:mm:ss'),
      jamKeluar: null,
      lat,
      lng,
      jarakMeter: 0,
      status: 'Hadir',
      menitTerlambat: 0,
      cabang: currentBranch || 'Tanpa Cabang',
      isPindahTugas: !isMainBranch,
    });

    toast.success(`Berhasil Absen Masuk di ${currentBranch}`);
    setShowAuthModal(false);
    setAuthCodeInput('');
  };

  const handleClockOut = () => {
    if (!todayRecord) return;
    
    const now = new Date();
    updateRecord(todayRecord.id, {
      jamKeluar: format(now, 'HH:mm:ss')
    });

    toast.success('Berhasil Absen Pulang. Sampai jumpa besok!');
  };

  const verifyCode = () => {
    if (authCodeInput.toUpperCase() === masterAuthCode.toUpperCase()) {
      if (pendingAction === 'masuk') executeClockIn();
    } else {
      toast.error('Kode Otentikasi Salah');
    }
  };

  return (
    <div className={styles.controlsGrid}>
      <button 
        className={`${styles.btnMain} ${styles.btnMasuk}`}
        disabled={isClockedIn}
        onClick={handleClockIn}
      >
        <LogIn size={32} />
        <span>Absen Masuk</span>
      </button>

      <button 
        className={`${styles.btnMain} ${styles.btnPulang}`}
        disabled={!isClockedIn || isClockedOut}
        onClick={handleClockOut}
      >
        <LogOut size={32} />
        <span>Absen Pulang</span>
      </button>

      {/* Auth Modal */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#111] border border-[#333] rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className={styles.authModal}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2 text-amber-500">
                  <ShieldCheck size={20} />
                  <span className="font-bold uppercase tracking-widest text-sm">Otentikasi Pindah Tugas</span>
                </div>
                <button onClick={() => setShowAuthModal(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <p className="text-gray-400 text-sm">
                Anda berada di <strong>{currentBranch}</strong> (Bukan Cabang Utama). 
                Masukkan kode otentikasi dari Admin untuk melanjutkan absen.
              </p>

              <input 
                type="text"
                placeholder="KODE"
                className={styles.authInput}
                value={authCodeInput}
                onChange={(e) => setAuthCodeInput(e.target.value.toUpperCase())}
                autoFocus
              />

              <button 
                className="w-full bg-white text-black py-4 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                onClick={verifyCode}
              >
                Verifikasi & Absen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
