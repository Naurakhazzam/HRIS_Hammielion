'use client';

import React, { useState, useMemo } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAbsensiStore } from '@/stores/useAbsensiStore';
import { StatsOverview } from '@/components/features/absensi/StatsOverview';
import { HistoryList } from '@/components/features/absensi/HistoryList';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AbsensiRekapPage() {
  const { user } = useAuthStore();
  const { history, getRekapByKaryawan } = useAbsensiStore();
  
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  const monthStr = format(selectedMonth, 'yyyy-MM');
  const monthName = format(selectedMonth, 'MMMM yyyy', { locale: id });

  // Get Rekap
  const rekap = useMemo(() => {
    if (!user?.karyawanId) return null;
    return getRekapByKaryawan(user.karyawanId, monthStr);
  }, [user?.karyawanId, monthStr, getRekapByKaryawan]);

  // Get Detail Records for the month
  const monthlyRecords = useMemo(() => {
    if (!user?.karyawanId) return [];
    
    const start = startOfMonth(selectedMonth);
    const end = endOfMonth(selectedMonth);

    return history
      .filter((rec) => {
        const date = parseISO(rec.tanggal);
        return rec.karyawanId === user.karyawanId && isWithinInterval(date, { start, end });
      })
      .sort((a, b) => b.tanggal.localeCompare(a.tanggal));
  }, [user?.karyawanId, selectedMonth, history]);

  const changeMonth = (offset: number) => {
    setSelectedMonth((prev) => (offset > 0 ? subMonths(prev, -1) : subMonths(prev, 1)));
  };

  if (!user?.karyawanId) {
    return <div className="p-8 text-center text-rose-500">Akses Dibatasi. Silakan login sebagai karyawan.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8 flex flex-col gap-8">
      {/* Header Section */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-500 mb-1">
            <CalendarDays size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.2em]">Absensi & Kedisiplinan</span>
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-white">Rekapitulasi Mandiri</h1>
          <p className="text-gray-500 text-sm font-medium">Pantau performa kehadiran dan estimasi insentif Anda.</p>
        </div>

        {/* Month Picker */}
        <div className="flex items-center gap-1 bg-white/5 p-1 rounded-2xl border border-white/10 self-start md:self-auto">
          <button 
            onClick={() => changeMonth(-1)}
            className="p-2 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="px-4 py-1 text-center min-w-[140px]">
            <span className="text-sm font-bold text-white block leading-tight">{monthName}</span>
            <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest leading-none">Pilih Periode</span>
          </div>
          <button 
            onClick={() => changeMonth(1)}
            className="p-2 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      </header>

      {/* Stats Section */}
      {rekap && (
        <AnimatePresence mode="wait">
          <motion.div
            key={monthStr}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
          >
            <StatsOverview rekap={rekap} />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: History List */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black tracking-tight text-white flex items-center gap-2">
              <FileText size={18} className="text-emerald-500" />
              Riwayat Detail
            </h2>
            <span className="text-[10px] font-bold text-gray-500 uppercase">
              Total {monthlyRecords.length} Catatan
            </span>
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={monthStr}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <HistoryList records={monthlyRecords} />
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right Column: Information/Insights */}
        <div className="flex flex-col gap-6">
          <div className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 p-6 rounded-3xl relative overflow-hidden">
            <div className="relative z-10">
              <h3 className="text-indigo-400 font-bold text-sm mb-2 uppercase tracking-wider">💡 Insights Bulan Ini</h3>
              <p className="text-gray-400 text-xs leading-relaxed font-medium">
                {rekap && rekap.totalTerlambat > 0 
                  ? `Anda memiliki ${rekap.totalTerlambat} keterlambatan bulan ini. Usahakan datang lebih awal 5-10 menit untuk menjaga bonus kedisiplinan Anda tetap aktif.`
                  : "Luar biasa! Kedisiplinan Anda sangat baik bulan ini. Pertahankan untuk mendapatkan bonus Kedisiplinan di akhir bulan."}
              </p>
            </div>
            <CalendarDays className="absolute -right-4 -bottom-4 w-24 h-24 opacity-5 rotate-12 text-indigo-500" />
          </div>

          <div className="bg-white/[0.02] border border-white/5 p-6 rounded-3xl">
            <h3 className="text-white font-bold text-sm mb-4">Aturan Kedisiplinan</h3>
            <div className="flex flex-col gap-4">
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 shadow-[0_0_8px_rgba(244,63,94,0.5)]" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-300">Denda Keterlambatan</p>
                  <p className="text-[10px] text-gray-500 font-medium leading-tight">Rp 1.000 per menit keterlambatan dari jadwal shift.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-1.5 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-300">Bonus Kedisiplinan</p>
                  <p className="text-[10px] text-gray-500 font-medium leading-tight">Rp 100.000 jika total terlambat ≤ 60 menit & 0 Alpha.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-500 mt-1.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-300">Toleransi</p>
                  <p className="text-[10px] text-gray-500 font-medium leading-tight">Batas keterlambatan normal 5-10 menit tergantung shift.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
