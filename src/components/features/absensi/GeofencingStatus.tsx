'use client';

import React, { useMemo } from 'react';
import { useGeolocation, hitungJarak } from '@/lib/hooks/useGeolocation';
import { useSettingsStore } from '@/stores/useSettingsStore';
import styles from '@/app/(dashboard)/absensi/input/absensi.module.css';
import { MapPin, Navigation, AlertCircle, CheckCircle2 } from 'lucide-react';
import { BranchConfig } from '@/types/settings.types';

interface BranchWithDistance extends BranchConfig {
  distance: number;
}

interface GeofencingStatusProps {
  cabangUtama: string;
  onLocationUpdate?: (branchName: string | null, isMainBranch: boolean, lat: number | null, lng: number | null) => void;
}

export const GeofencingStatus: React.FC<GeofencingStatusProps> = ({ 
  cabangUtama,
  onLocationUpdate 
}) => {
  const { koordinat, isLoading, error, dapatkanLokasi } = useGeolocation();
  const branches = useSettingsStore((state) => state.branches);

  const nearestBranch = useMemo<BranchWithDistance | null>(() => {
    if (!koordinat) return null;

    let closest: BranchWithDistance | null = null;
    let minDistance = Infinity;

    branches.forEach((branch) => {
      const dist = hitungJarak(koordinat, { lat: branch.latitude, lng: branch.longitude });
      if (dist < minDistance) {
        minDistance = dist;
        closest = { ...branch, distance: dist };
      }
    });

    return closest;
  }, [koordinat, branches]);

  const status = useMemo(() => {
    if (isLoading) return 'loading';
    if (error) return 'error';
    if (!koordinat) return 'idle';
    
    const nb = nearestBranch as BranchWithDistance | null;
    if (nb && nb.distance <= nb.radiusMeter) return 'active';
    
    return 'out_of_range';
  }, [isLoading, error, koordinat, nearestBranch]);

  // Effect to notify parent
  React.useEffect(() => {
    if (status === 'active' && nearestBranch && koordinat) {
      onLocationUpdate?.(
        nearestBranch.nama, 
        nearestBranch.nama === cabangUtama,
        koordinat.lat,
        koordinat.lng
      );
    } else {
      onLocationUpdate?.(null, false, koordinat?.lat || null, koordinat?.lng || null);
    }
  }, [status, nearestBranch, cabangUtama, onLocationUpdate, koordinat]);

  if (status === 'idle') {
    return (
      <div className={`${styles.statusCard} ${styles.statusLoading}`} onClick={dapatkanLokasi} style={{ cursor: 'pointer' }}>
        <Navigation size={20} className="animate-pulse" />
        <div>
          <p className="font-bold">Klik untuk Deteksi Lokasi</p>
          <p className="text-xs opacity-80">Pastikan GPS aktif & izin lokasi diberikan</p>
        </div>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className={`${styles.statusCard} ${styles.statusLoading}`}>
        <Navigation size={20} className="animate-spin" />
        <div>
          <p className="font-bold">Mencari Koordinat...</p>
          <p className="text-xs opacity-80">Mengoptimalkan akurasi GPS</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={`${styles.statusCard} ${styles.statusError}`}>
        <AlertCircle size={20} />
        <div>
          <p className="font-bold">GPS Error</p>
          <p className="text-xs opacity-80">{error}</p>
        </div>
      </div>
    );
  }

  if (status === 'out_of_range') {
    return (
      <div className={`${styles.statusCard} ${styles.statusError}`}>
        <MapPin size={20} />
        <div>
          <p className="font-bold">Di Luar Radius Kantor</p>
          <p className="text-xs opacity-80">
            Terdeteksi {Math.round(nearestBranch?.distance || 0)}m dari {nearestBranch?.nama}
          </p>
        </div>
      </div>
    );
  }

  const isMain = nearestBranch?.nama === cabangUtama;

  return (
    <div className={`${styles.statusCard} ${styles.statusActive}`}>
      <CheckCircle2 size={20} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="font-bold">Siap Absen — {nearestBranch?.nama}</p>
          {isMain ? (
            <span className="bg-emerald-500 text-[10px] text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              Cabang Utama
            </span>
          ) : (
            <span className="bg-amber-500 text-[10px] text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
              Pindah Tugas
            </span>
          )}
        </div>
        <p className="text-xs opacity-80">Lokasi Anda berada dalam radius kerja valid ({Math.round(nearestBranch?.distance || 0)}m)</p>
      </div>
    </div>
  );
};
