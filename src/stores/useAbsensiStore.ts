import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AbsensiRecord, RekapAbsensi } from '@/types/absensi.types';
import { DUMMY_ABSENSI } from '@/data/dummy-absensi';
import { format, isSameMonth, parseISO } from 'date-fns';
import { useSettingsStore } from './useSettingsStore';

interface AbsensiState {
  history: AbsensiRecord[];
  
  // Actions
  addRecord: (record: AbsensiRecord) => void;
  updateRecord: (id: string, updates: Partial<AbsensiRecord>) => void;
  deleteRecord: (id: string) => void;
  
  // Getters
  getRekapByKaryawan: (karyawanId: string, monthStr: string) => RekapAbsensi;
  getTodayRecord: (karyawanId: string) => AbsensiRecord | undefined;
}

export const useAbsensiStore = create<AbsensiState>()(
  persist(
    (set, get) => ({
      history: DUMMY_ABSENSI,

      addRecord: (record) => set((state) => ({
        history: [record, ...state.history]
      })),

      updateRecord: (id, updates) => set((state) => ({
        history: state.history.map((rec) => rec.id === id ? { ...rec, ...updates } : rec)
      })),

      deleteRecord: (id) => set((state) => ({
        history: state.history.filter((rec) => rec.id !== id)
      })),

      getTodayRecord: (karyawanId) => {
        const today = format(new Date(), 'yyyy-MM-dd');
        return get().history.find((rec) => rec.karyawanId === karyawanId && rec.tanggal === today);
      },

      getRekapByKaryawan: (karyawanId, monthStr) => {
        const targetDate = parseISO(`${monthStr}-01`);
        const records = get().history.filter((rec) => 
          rec.karyawanId === karyawanId && 
          isSameMonth(parseISO(rec.tanggal), targetDate)
        );

        const rekap: RekapAbsensi = {
          karyawanId,
          totalHadir: records.filter((r) => r.status === 'Hadir' || r.status === 'Terlambat').length,
          totalTerlambat: records.filter((r) => r.status === 'Terlambat').length,
          totalAlpha: records.filter((r) => r.status === 'Alpha').length,
          totalIzin: records.filter((r) => r.status === 'Izin' || r.status === 'Sakit').length,
          totalSakit: records.filter((r) => r.status === 'Sakit').length,
          totalMenitTerlambat: records.reduce((acc, curr) => acc + curr.menitTerlambat, 0),
          bonusKedisiplinan: 0,
          potonganTerlambat: 0,
          potonganAlpha: 0,
        };

        // Calculate dynamic values from settings
        const settings = useSettingsStore.getState().payrollRules;
        rekap.potonganTerlambat = rekap.totalMenitTerlambat * settings.potonganTerlambat;
        rekap.potonganAlpha = rekap.totalAlpha * settings.potonganAlpha;
        
        if (rekap.totalMenitTerlambat <= settings.ambangDisiplinMenit && rekap.totalAlpha === 0) {
          rekap.bonusKedisiplinan = settings.bonusDisiplin;
        }

        return rekap;
      },
    }),
    {
      name: 'hris-absensi',
    }
  )
);
