-- 113: Jam absen QR / HP wajib pakai JAM SERVER, bukan jam HP.
--
-- Masalah: AbsenSekarang.tsx mengisi check_in / check_out dari new Date() di HP. Karyawan bisa
-- memundurkan jam HP sebelum scan supaya tidak tercatat telat (atau memajukan jam saat absen
-- pulang supaya dapat lembur). RLS mobile_checkin juga membolehkan karyawan meng-UPDATE kolom
-- apa saja di baris absennya hari ini (termasuk check_in & late_minutes) lewat API langsung.
--
-- Cek data lama (18 Sep - 1 Nov 2026, 1.001 foto absen): jam HP vs jam server (storage.objects
-- .created_at foto) selisih maksimal 1,1 menit -- belum ada yang curang lewat jam HP, jadi data
-- lama TIDAK diubah. 7 absen masuk yang berbeda jauh dari jam foto adalah koreksi manual HR.
--
-- Solusi: trigger trg_00_enforce_server_clock (nama "00" supaya jalan SEBELUM
-- trg_calc_attendance_times, trigger BEFORE dieksekusi urut abjad). Berlaku untuk baris absen
-- MILIK USER YANG SEDANG LOGIN SENDIRI (semua role, termasuk HR/owner -- tidak ada yang boleh
-- mengatur jam absennya sendiri; koreksi data sendiri dilakukan admin lain):
--   INSERT dengan check_in: check_in := now(), date := tanggal WIB server, check_out := null,
--          validasi lembur dikosongkan. late_minutes lalu dihitung trigger calc dari jam server.
--   UPDATE: check_in, date, late_minutes, overtime_validated, overtime_hours_adjusted dikunci ke
--          nilai lama. check_out yang diisi -> now(). overtime_hours tetap dihitung aplikasi
--          (rumus lembur perbantuan ada di aplikasi), tapi ditolak kalau jam pulang yang dikirim
--          aplikasi beda > 5 menit dari jam server (aplikasi sekarang mengambil jam server lewat
--          server_now() sebelum menghitung, jadi selisih besar = jam HP dimanipulasi / app lama).
-- Mode hitung ulang telat (app.recalc_late, migr 111) & proses tanpa login (cron/service role)
-- tidak disentuh.

create or replace function public.server_now()
 returns timestamptz
 language sql
 stable
as $function$
  select now();
$function$;

grant execute on function public.server_now() to authenticated;

create or replace function public.enforce_server_clock()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_now timestamptz := now();
begin
  if auth.uid() is null
     or current_setting('app.recalc_late', true) = 'on'
     or NEW.employee_id is distinct from get_my_employee_id() then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    if NEW.check_in is not null then
      NEW.check_in                := v_now;
      NEW.date                    := (v_now at time zone 'Asia/Jakarta')::date;
      NEW.check_out               := null;
      NEW.overtime_validated      := false;
      NEW.overtime_hours_adjusted := null;
    end if;
    return NEW;
  end if;

  NEW.check_in                := OLD.check_in;
  NEW.date                    := OLD.date;
  NEW.late_minutes            := OLD.late_minutes;
  NEW.overtime_validated      := OLD.overtime_validated;
  NEW.overtime_hours_adjusted := OLD.overtime_hours_adjusted;

  if NEW.check_out is distinct from OLD.check_out then
    if NEW.check_out is null then
      NEW.check_out := OLD.check_out;
    else
      if abs(extract(epoch from (NEW.check_out - v_now))) > 300 then
        raise exception 'Jam HP tidak sesuai jam server (selisih % menit). Muat ulang halaman lalu coba lagi.',
          round(extract(epoch from (NEW.check_out - v_now)) / 60)
          using errcode = 'P0001';
      end if;
      NEW.check_out := v_now;
    end if;
  end if;

  return NEW;
end;
$function$;

drop trigger if exists trg_00_enforce_server_clock on public.attendances;
create trigger trg_00_enforce_server_clock
  before insert or update on public.attendances
  for each row execute function public.enforce_server_clock();
