import { AbsensiRecord, StatusKehadiran } from "@/types/absensi.types";
import { format, subDays, isSunday } from "date-fns";

const generateDummyAbsensi = (): AbsensiRecord[] => {
  const records: AbsensiRecord[] = [];
  const karyawanIds = [
    'k001', 'k002', 'k003', 'k004', 'k005', 'k006', 'k007', 'k008',
    'k009', 'k010', 'k011', 'k012', 'k013', 'k014', 'k015', 'k016', 'k017'
  ];

  // Generate data for the last 30 days
  for (let i = 29; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const dateStr = format(date, 'yyyy-MM-dd');
    
    // Sunday is off for everyone in this dummy set (4 days off handled simply)
    const isWeekEnd = isSunday(date);

    karyawanIds.forEach((kid) => {
      // k017 is nonactive since 2025-01-31, so no data after that
      if (kid === 'k017' && date > new Date('2025-01-31')) return;

      if (isWeekEnd) {
        records.push({
          id: `abs-${kid}-${dateStr}`,
          karyawanId: kid,
          tanggal: dateStr,
          jamMasuk: null,
          jamKeluar: null,
          lat: null,
          lng: null,
          jarakMeter: null,
          status: 'Libur',
          menitTerlambat: 0,
          cabang: 'Hammielion Central',
        });
        return;
      }

      // Random status logic
      const rand = Math.random();
      let status: StatusKehadiran = 'Hadir';
      let jamMasuk: string | null = '08:00:00';
      let jamKeluar: string | null = '16:00:00';
      let menitTerlambat = 0;

      if (rand < 0.05) {
        status = 'Alpha';
        jamMasuk = null;
        jamKeluar = null;
      } else if (rand < 0.15) {
        status = 'Terlambat';
        menitTerlambat = Math.floor(Math.random() * 45) + 16; // 16 - 60 minutes late
        const hour = 8;
        const minute = menitTerlambat;
        jamMasuk = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
      } else if (rand < 0.20) {
        status = 'Izin';
        jamMasuk = null;
        jamKeluar = null;
      } else {
        // Precise or slight lateness within tolerance (e.g. 08:05)
        const smallLate = Math.floor(Math.random() * 10);
        jamMasuk = `08:${String(smallLate).padStart(2, '0')}:00`;
        status = 'Hadir';
      }

      records.push({
        id: `abs-${kid}-${dateStr}`,
        karyawanId: kid,
        tanggal: dateStr,
        jamMasuk,
        jamKeluar,
        lat: -6.2000, // Dummy coordinates
        lng: 106.8166,
        jarakMeter: 50,
        status,
        menitTerlambat,
        cabang: 'Hammielion Central',
      });
    });
  }

  return records;
};

export const DUMMY_ABSENSI = generateDummyAbsensi();
