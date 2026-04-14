import { useState, useCallback } from 'react';

interface Koordinat {
  lat: number;
  lng: number;
}

interface GeolocationState {
  koordinat: Koordinat | null;
  error: string | null;
  isLoading: boolean;
}

/**
 * Hitung jarak antara dua koordinat (dalam meter)
 * Menggunakan formula Haversine
 */
export function hitungJarak(a: Koordinat, b: Koordinat): number {
  const R = 6371000; // radius bumi dalam meter
  const phi1 = (a.lat * Math.PI) / 180;
  const phi2 = (b.lat * Math.PI) / 180;
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180;
  const dLambda = ((b.lng - a.lng) * Math.PI) / 180;

  const x =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(dLambda / 2) *
      Math.sin(dLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/**
 * Cek apakah koordinat berada dalam radius lokasi kantor
 */
export function cekDalamRadius(
  posisiKaryawan: Koordinat,
  posisiKantor: Koordinat,
  radiusMeter: number,
): boolean {
  return hitungJarak(posisiKaryawan, posisiKantor) <= radiusMeter;
}

export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    koordinat: null,
    error: null,
    isLoading: false,
  });

  const dapatkanLokasi = useCallback(() => {
    if (!navigator.geolocation) {
      setState((s) => ({
        ...s,
        error: 'Perangkat Anda tidak mendukung GPS',
      }));
      return;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          koordinat: {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          },
          error: null,
          isLoading: false,
        });
      },
      (err) => {
        setState({
          koordinat: null,
          error:
            err.code === 1
              ? 'Akses lokasi ditolak. Izinkan akses lokasi di browser Anda.'
              : 'Gagal mendapatkan lokasi. Coba lagi.',
          isLoading: false,
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, []);

  return { ...state, dapatkanLokasi };
}
