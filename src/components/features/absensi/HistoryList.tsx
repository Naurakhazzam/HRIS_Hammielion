'use client';

import React from 'react';
import { AbsensiRecord } from '@/types/absensi.types';
import { format, parseISO } from 'date-fns';
import { id } from 'date-fns/locale';
import { 
  CheckCircle2, 
  Clock, 
  MapPin, 
  ChevronRight,
  ShieldAlert,
  AlertTriangle
} from 'lucide-react';
import { motion } from 'framer-motion';

interface HistoryListProps {
  records: AbsensiRecord[];
}

export function HistoryList({ records }: HistoryListProps) {
  if (records.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white/5 border border-dashed border-white/10 rounded-3xl">
        <h3 className="text-gray-400 font-medium text-sm">Tidak ada riwayat untuk bulan ini</h3>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {records.map((record, idx) => {
        const isTerlambat = record.status === 'Terlambat';
        const isAlpha = record.status === 'Alpha';
        const isIzin = record.status === 'Izin' || record.status === 'Sakit';

        return (
          <motion.div
            key={record.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="group relative flex items-center gap-4 p-4 bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl transition-all duration-300"
          >
            {/* Status Icon */}
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              isAlpha ? 'bg-rose-500/10 text-rose-500' :
              isTerlambat ? 'bg-amber-500/10 text-amber-500' :
              isIzin ? 'bg-sky-500/10 text-sky-500' :
              'bg-emerald-500/10 text-emerald-500'
            }`}>
              {isAlpha ? <ShieldAlert size={20} /> :
               isTerlambat ? <Clock size={20} /> :
               isIzin ? <AlertTriangle size={20} /> :
               <CheckCircle2 size={20} />}
            </div>

            {/* Main Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-bold text-white">
                  {format(parseISO(record.tanggal), 'EEEE, d MMM', { locale: id })}
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  isAlpha ? 'bg-rose-500/10 text-rose-500' :
                  isTerlambat ? 'bg-amber-500/10 text-amber-500' :
                  isIzin ? 'bg-sky-500/10 text-sky-500' :
                  'bg-emerald-500/10 text-emerald-500'
                }`}>
                  {record.status}
                </span>
              </div>
              
              <div className="flex items-center gap-3 text-xs text-gray-400 font-medium">
                <div className="flex items-center gap-1">
                  <Clock size={12} className="opacity-50" />
                  <span>{record.jamMasuk} - {record.jamKeluar || '--:--'}</span>
                </div>
                <div className="flex items-center gap-1">
                  <MapPin size={12} className="opacity-50" />
                  <span className="truncate">{record.cabang}</span>
                </div>
              </div>
            </div>

            {/* Stats Sidebar */}
            <div className="text-right flex flex-col items-end gap-1">
              {isTerlambat && (
                <span className="text-[10px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md">
                  +{record.menitTerlambat}m Telat
                </span>
              )}
              {record.isPindahTugas && (
                <span className="text-[10px] font-bold text-sky-500 bg-sky-500/10 px-2 py-0.5 rounded-md">
                  Pindah Tugas
                </span>
              )}
              <ChevronRight size={16} className="text-gray-600 group-hover:text-white transition-colors" />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
