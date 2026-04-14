import { create } from 'zustand';
import type { Karyawan, KaryawanFormInput } from '@/types/karyawan.types';
import { DUMMY_KARYAWAN } from '@/data/dummy-karyawan';
import { generateNomorKaryawan } from '@/lib/utils/formatters';

interface KaryawanStore {
  karyawan: Karyawan[];
  tambahKaryawan: (data: KaryawanFormInput) => void;
  updateKaryawan: (id: string, data: Partial<Karyawan>) => void;
  deleteKaryawan: (id: string) => void;
  nonaktifkanKaryawan: (id: string, tanggalKeluar: string) => void;
  getKaryawanById: (id: string) => Karyawan | undefined;
  getKaryawanAktif: () => Karyawan[];
}

export const useKaryawanStore = create<KaryawanStore>((set, get) => ({
  karyawan: DUMMY_KARYAWAN,

  tambahKaryawan: (data) => {
    const { karyawan } = get();
    const tahun = new Date().getFullYear();
    const urutan = karyawan.length + 1;
    const newKaryawan: Karyawan = {
      ...data,
      id: `k${Date.now()}`,
      nomorKaryawan: generateNomorKaryawan(tahun, urutan),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    set({ karyawan: [...karyawan, newKaryawan] });
  },

  updateKaryawan: (id, data) => {
    set((state) => ({
      karyawan: state.karyawan.map((k) =>
        k.id === id ? { ...k, ...data, updatedAt: new Date().toISOString() } : k,
      ),
    }));
  },

  deleteKaryawan: (id) => {
    set((state) => ({
      karyawan: state.karyawan.filter((k) => k.id !== id),
    }));
  },

  nonaktifkanKaryawan: (id, tanggalKeluar) => {
    set((state) => ({
      karyawan: state.karyawan.map((k) =>
        k.id === id
          ? { ...k, statusKaryawan: 'Nonaktif', tanggalKeluar, updatedAt: new Date().toISOString() }
          : k,
      ),
    }));
  },

  getKaryawanById: (id) => get().karyawan.find((k) => k.id === id),

  getKaryawanAktif: () =>
    get().karyawan.filter((k) => k.statusKaryawan === 'Aktif'),
}));
