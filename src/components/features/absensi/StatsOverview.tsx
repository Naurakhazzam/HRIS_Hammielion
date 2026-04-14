'use client';

import React from 'react';
import { RekapAbsensi } from '@/types/absensi.types';
import { 
  Calendar, 
  Clock, 
  MinusCircle, 
  Trophy,
  ArrowUpRight,
  TrendingDown
} from 'lucide-react';
import { motion } from 'framer-motion';

interface StatsOverviewProps {
  rekap: RekapAbsensi;
}

export function StatsOverview({ rekap }: StatsOverviewProps) {
  const formatIDR = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0
    }).format(val);
  };

  const cards = [
    {
      label: 'Total Kehadiran',
      value: `${rekap.totalHadir} Hari`,
      icon: Calendar,
      color: 'emerald',
      trend: `${rekap.totalAlpha} Alpha`,
      trendIcon: rekap.totalAlpha > 0 ? TrendingDown : undefined,
    },
    {
      label: 'Keterlambatan',
      value: `${rekap.totalMenitTerlambat} Menit`,
      icon: Clock,
      color: 'amber',
      trend: `${rekap.totalTerlambat} Kali`,
      trendIcon: ArrowUpRight,
    },
    {
      label: 'Estimasi Denda',
      value: formatIDR(rekap.potonganTerlambat + rekap.potonganAlpha),
      icon: MinusCircle,
      color: 'rose',
      trend: 'Potongan Gaji',
      trendIcon: TrendingDown,
    },
    {
      label: 'Bonus Disiplin',
      value: formatIDR(rekap.bonusKedisiplinan),
      icon: Trophy,
      color: 'sky',
      trend: rekap.bonusKedisiplinan > 0 ? 'Memenuhi Syarat' : 'Belum Memenuhi',
      trendIcon: rekap.bonusKedisiplinan > 0 ? ArrowUpRight : undefined,
    },
  ];

  const getColorClasses = (color: string) => {
    switch (color) {
      case 'emerald': return 'from-emerald-500/20 to-teal-500/20 text-emerald-500 border-emerald-500/20';
      case 'amber': return 'from-amber-500/20 to-orange-500/20 text-amber-500 border-amber-500/20';
      case 'rose': return 'from-rose-500/20 to-pink-500/20 text-rose-500 border-rose-500/20';
      case 'sky': return 'from-sky-500/20 to-blue-500/20 text-sky-500 border-sky-500/20';
      default: return 'from-gray-500/20 to-slate-500/20 text-gray-400 border-gray-500/20';
    }
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, idx) => (
        <motion.div
          key={card.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.1 }}
          className={`relative overflow-hidden bg-gradient-to-br ${getColorClasses(card.color)} border p-4 rounded-3xl backdrop-blur-md`}
        >
          {/* Decorative background icon */}
          <card.icon className="absolute -right-4 -bottom-4 w-24 h-24 opacity-10 rotate-12" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2 opacity-80">
              <card.icon size={16} />
              <span className="text-[10px] font-bold uppercase tracking-wider">{card.label}</span>
            </div>
            
            <div className="text-xl font-black tracking-tight mb-1 text-white">
              {card.value}
            </div>
            
            <div className="flex items-center gap-1">
              {card.trendIcon && <card.trendIcon size={12} className="opacity-70" />}
              <span className="text-[10px] font-medium opacity-70 italic">{card.trend}</span>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
