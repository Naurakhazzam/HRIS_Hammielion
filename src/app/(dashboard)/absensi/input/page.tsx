'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { DUMMY_KARYAWAN } from '@/data/dummy-karyawan';
import { GeofencingStatus } from '@/components/features/absensi/GeofencingStatus';
import { ClockControls } from '@/components/features/absensi/ClockControls';
import styles from './absensi.module.css';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';

export default function AbsensiInputPage() {
  const { user } = useAuthStore();
  const [time, setTime] = useState(new Date());
  
  // State from GeofencingStatus
  const [locationInfo, setLocationInfo] = useState<{
    branch: string | null;
    isMain: boolean;
    lat: number | null;
    lng: number | null;
  }>({
    branch: null,
    isMain: false,
    lat: null,
    lng: null
  });

  // Get Karyawan data
  const karyawan = DUMMY_KARYAWAN.find((k) => k.id === user?.karyawanId);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!user || !karyawan) {
    return (
      <div className="p-8 text-center">
        <p className="text-red-500">Karyawan tidak ditemukan. Pastikan Anda login sebagai akun karyawan.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-xl shadow-lg">
            {karyawan.nama.charAt(0)}
          </div>
          <div className="text-left">
            <h1 className="text-xl font-bold tracking-tight">{karyawan.nama}</h1>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-widest">{karyawan.jabatan} • {karyawan.cabang}</p>
          </div>
        </div>
      </header>

      <main className="flex flex-col gap-6">
        {/* Digital Clock Card */}
        <div className={styles.clockWrapper}>
          <p className={styles.dateText}>
            {format(time, 'EEEE, d MMMM yyyy', { locale: id })}
          </p>
          <div className={styles.digitalClock}>
            {format(time, 'HH:mm:ss')}
          </div>
          <div className="flex justify-center mt-2">
            <span className={styles.branchTag}>
              Cabang Penempatan: {karyawan.cabang}
            </span>
          </div>
        </div>

        {/* Geofencing Status Widget */}
        <GeofencingStatus 
          cabangUtama={karyawan.cabang} 
          onLocationUpdate={(branch, isMain, lat, lng) => setLocationInfo({ branch, isMain, lat, lng })}
        />

        {/* Clock In / Out Buttons */}
        <ClockControls 
          currentBranch={locationInfo.branch}
          isMainBranch={locationInfo.isMain}
          lat={locationInfo.lat}
          lng={locationInfo.lng}
        />

        {/* Tip Section */}
        <div className="bg-white/[0.03] border border-white/5 p-4 rounded-2xl text-xs text-gray-500">
          <div className="flex gap-2">
            <span className="text-amber-500/80 font-bold uppercase tracking-tighter">Himbauan:</span>
            <p>
              Pastikan Anda berada dalam radius 100 meter dari titik koordinat cabang. 
              Jika terdeteksi di luar radius, tombol absen tidak akan aktif. 
              Gunakan mode &apos;Pindah Tugas&apos; jika sedang diperbantukan di cabang lain.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
