import { ShiftConfig, BranchConfig } from '@/types/settings.types';
import { hitungJarak } from '@/lib/hooks/useGeolocation';

/**
 * Hitung keterlambatan dalam menit
 * @param jamMasukActual Format "HH:mm" atau "HH:mm:ss" dari input karyawan
 * @param shift Shift yang diikuti karyawan
 * @returns jumlah menit terlambat (0 jika tepat waktu/dalam toleransi)
 */
export function hitungMenitTerlambat(jamMasukActual: string, shift: ShiftConfig): number {
  const [actualH, actualM] = jamMasukActual.split(':').map(Number);
  const [targetH, targetM] = shift.jamMasuk.split(':').map(Number);

  const actualTotalMinutes = actualH * 60 + actualM;
  const targetTotalMinutes = targetH * 60 + targetM;

  const diff = actualTotalMinutes - targetTotalMinutes;

  // Jika lewat jam masuk + toleransi, hitung selisih dari jam masuk asli
  if (diff > shift.toleransiMenit) {
    return diff;
  }

  return 0;
}

/**
 * Validasi apakah lokasi karyawan ada di dalam radius cabang
 */
export function isDalamRadius(
  playerLat: number,
  playerLng: number,
  branch: BranchConfig
): boolean {
  const distance = hitungJarak(
    { lat: playerLat, lng: playerLng },
    { lat: branch.latitude, lng: branch.longitude }
  );
  
  return distance <= branch.radiusMeter;
}

/**
 * Mendapatkan status kehadiran berdasarkan keterlambatan
 */
export function getStatusKehadiran(menitTerlambat: number): 'Hadir' | 'Terlambat' {
  return menitTerlambat > 0 ? 'Terlambat' : 'Hadir';
}
