-- 111: Hitung Ulang Telat setelah jadwal kerja diubah.
--
-- Masalah: trigger calc_attendance_times() cuma menghitung late_minutes saat absen masuk
-- (INSERT) atau saat jam masuk diubah. Kalau HR mengubah jadwal (work_schedules /
-- branch_shift_schedules / jam kerja khusus karyawan), absen lama TIDAK ikut dihitung ulang
-- (kasus nyata: jadwal Back Office 08:00 -> 07:30, periode 26 Sep - 25 Okt 2026).
--
-- Solusi:
-- 1. Trigger bisa dipaksa menghitung ulang lewat flag transaksi app.recalc_late = 'on'. Dalam
--    mode itu HANYA late_minutes yang diperbarui -- overtime_hours dikembalikan ke nilai lama
--    (lembur bisa sudah diklaim/diedit manual, tidak boleh ikut berubah diam-diam).
-- 2. recalc_late_minutes(): pratinjau (p_apply = false) atau terapkan (p_apply = true) untuk
--    rentang tanggal + filter departemen/cabang/karyawan. Rumus 100% lewat trigger yang sama,
--    jadi tidak ada rumus dobel. Hari yang klarifikasi telatnya DISETUJUI (kompensasi) dilewati.
--    Setiap perubahan dicatat di attendance_edit_logs.

create or replace function public.calc_attendance_times()
 returns trigger
 language plpgsql
as $function$
DECLARE
  v_dept_id       UUID;
  v_dept_name     TEXT;
  v_pos_name      TEXT;
  v_branch_id     UUID;
  v_branch_name   TEXT;
  v_custom_in     TIME;
  v_custom_out    TIME;
  v_ci_local      TIME;
  v_co_local      TIME;
  v_dept_sched_in  TIME;
  v_dept_sched_out TIME;
  v_dept_allow_ot  BOOLEAN;
  v_sa_in         TIME;
  v_sa_out        TIME;
  v_sa_allow_ot   BOOLEAN;
  v_sched_in      TIME;
  v_sched_out     TIME;
  v_allow_ot      BOOLEAN;
  v_ci_branch     UUID;
  v_co_branch     UUID;
  v_ci_is_perbantuan BOOLEAN;
  v_co_is_perbantuan BOOLEAN;
  v_bs_ci_time    TIME;
  v_bs_co_time    TIME;
  v_bs_allow_ot   BOOLEAN;
  v_late_sched_in TIME;
  v_ot_sched_out  TIME;
  v_ot_allow_ot   BOOLEAN;
  v_monday        DATE;
  v_late_sec      INT;
  v_ot_sec        INT;
  v_ot_co_capped  TIME;
  v_force_late    BOOLEAN := TG_OP = 'UPDATE' AND current_setting('app.recalc_late', true) = 'on';
BEGIN
  IF TG_OP = 'UPDATE' AND NOT v_force_late
     AND date_trunc('minute', NEW.check_in) IS NOT DISTINCT FROM date_trunc('minute', OLD.check_in) THEN
    RETURN NEW;
  END IF;

  IF NEW.status != 'present' OR NEW.check_in IS NULL THEN
    NEW.late_minutes   := 0;
    NEW.overtime_hours := CASE WHEN v_force_late THEN OLD.overtime_hours ELSE 0 END;
    RETURN NEW;
  END IF;

  SELECT e.department_id, d.name, p.name, e.branch_id, b.name,
         e.custom_check_in_time, e.custom_check_out_time
  INTO v_dept_id, v_dept_name, v_pos_name, v_branch_id, v_branch_name,
       v_custom_in, v_custom_out
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN positions   p ON p.id = e.position_id
  LEFT JOIN branches    b ON b.id = e.branch_id
  WHERE e.id = NEW.employee_id;

  IF v_pos_name = 'Helper' AND v_branch_name = 'Gudang' THEN
    NEW.late_minutes   := 0;
    NEW.overtime_hours := CASE WHEN v_force_late THEN OLD.overtime_hours ELSE 0 END;
    RETURN NEW;
  END IF;

  v_ci_local := (NEW.check_in AT TIME ZONE 'Asia/Jakarta')::TIME;
  v_co_local := CASE WHEN NEW.check_out IS NOT NULL
                THEN (NEW.check_out AT TIME ZONE 'Asia/Jakarta')::TIME
                ELSE NULL END;

  v_monday := NEW.date - ((EXTRACT(ISODOW FROM NEW.date)::INT - 1));

  SELECT ws.check_in_time, ws.check_out_time, ws.allow_overtime
  INTO v_dept_sched_in, v_dept_sched_out, v_dept_allow_ot
  FROM work_schedules ws
  WHERE ws.applies_to_dept = v_dept_id
    AND (ws.detect_until IS NULL OR v_ci_local <= ws.detect_until)
  ORDER BY ws.detect_until ASC NULLS LAST
  LIMIT 1;

  IF v_dept_sched_in IS NULL THEN
    SELECT ws.check_in_time, ws.check_out_time, ws.allow_overtime
    INTO v_dept_sched_in, v_dept_sched_out, v_dept_allow_ot
    FROM work_schedules ws
    WHERE ws.applies_to_dept = v_dept_id
    ORDER BY ws.check_in_time LIMIT 1;
  END IF;

  IF v_custom_in IS NOT NULL OR v_custom_out IS NOT NULL THEN
    v_sched_in  := COALESCE(v_custom_in, v_dept_sched_in, v_ci_local);
    v_sched_out := COALESCE(v_custom_out, v_dept_sched_out);
    v_allow_ot  := COALESCE(v_dept_allow_ot, true);
  ELSE
    SELECT ws.check_in_time, ws.check_out_time, ws.allow_overtime
    INTO v_sa_in, v_sa_out, v_sa_allow_ot
    FROM shift_assignments sa
    JOIN work_schedules ws ON ws.id = sa.schedule_id
    WHERE sa.employee_id = NEW.employee_id
      AND sa.week_start_date = v_monday
    LIMIT 1;

    IF v_sa_in IS NOT NULL THEN
      v_sched_in := v_sa_in; v_sched_out := v_sa_out; v_allow_ot := v_sa_allow_ot;
    ELSE
      v_sched_in := v_dept_sched_in; v_sched_out := v_dept_sched_out; v_allow_ot := v_dept_allow_ot;
    END IF;
  END IF;

  v_ci_branch        := COALESCE(NEW.check_in_branch_id, v_branch_id);
  v_ci_is_perbantuan := NEW.check_in_branch_id IS NOT NULL AND NEW.check_in_branch_id IS DISTINCT FROM v_branch_id;

  v_bs_ci_time := NULL; v_bs_co_time := NULL; v_bs_allow_ot := NULL;
  IF v_ci_branch IS NOT NULL THEN
    SELECT bs.check_in_time, bs.check_out_time, bs.allow_overtime
    INTO v_bs_ci_time, v_bs_co_time, v_bs_allow_ot
    FROM branch_shift_schedules bs
    WHERE bs.branch_id = v_ci_branch AND bs.is_active
      AND (bs.detect_until IS NULL OR v_ci_local <= bs.detect_until)
    ORDER BY bs.detect_until ASC NULLS LAST
    LIMIT 1;
  END IF;

  v_late_sched_in := NULL;
  IF v_custom_in IS NULL THEN
    v_late_sched_in := v_bs_ci_time;
  END IF;
  IF v_late_sched_in IS NULL AND NOT v_ci_is_perbantuan THEN
    v_late_sched_in := v_sched_in;
  END IF;

  v_co_branch        := COALESCE(NEW.check_out_branch_id, v_branch_id);
  v_co_is_perbantuan := NEW.check_out_branch_id IS NOT NULL AND NEW.check_out_branch_id IS DISTINCT FROM v_branch_id;

  v_ot_sched_out := NULL;
  v_ot_allow_ot  := NULL;
  IF v_custom_out IS NULL THEN
    IF v_co_branch IS NOT DISTINCT FROM v_ci_branch THEN
      v_ot_sched_out := v_bs_co_time;
      v_ot_allow_ot  := v_bs_allow_ot;
    ELSIF v_co_branch IS NOT NULL THEN
      SELECT bs.check_out_time, bs.allow_overtime INTO v_ot_sched_out, v_ot_allow_ot
      FROM branch_shift_schedules bs
      WHERE bs.branch_id = v_co_branch AND bs.is_active
        AND (bs.detect_until IS NULL OR v_co_local <= bs.detect_until)
      ORDER BY bs.detect_until ASC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_ot_sched_out IS NULL AND NOT v_co_is_perbantuan THEN
    v_ot_sched_out := v_sched_out;
    v_ot_allow_ot  := v_allow_ot;
  END IF;

  IF v_late_sched_in IS NULL THEN
    NEW.late_minutes := 0;
  ELSE
    v_late_sec       := GREATEST(0, EXTRACT(EPOCH FROM (v_ci_local - v_late_sched_in))::INT);
    NEW.late_minutes := v_late_sec / 60;
  END IF;

  -- Mode hitung ulang telat: lembur TIDAK disentuh.
  IF v_force_late THEN
    NEW.overtime_hours := OLD.overtime_hours;
    RETURN NEW;
  END IF;

  NEW.overtime_hours := 0;
  IF v_dept_name IS DISTINCT FROM 'Team Gudang'
     AND COALESCE(v_ot_allow_ot, true)
     AND v_co_local IS NOT NULL AND v_ot_sched_out IS NOT NULL THEN
    -- Jam lembur yang DIHITUNG dibatasi maksimal sampai jam 20:00 -- kalau jam pulang
    -- tercatat lebih malam (mis. jam 22:00), selisih yang dihitung cuma sampai jam 20:00,
    -- bukan dari jam pulang aslinya (Owner: banyak terjadi di Saepulloh/Gudang yang pulang
    -- rutin lewat jam 8 malam). Batas ini TIDAK berlaku kalau jam pulang TERJADWAL-nya
    -- sendiri sudah >= 20:00 (shift sore Raja Petshop/Markas Petshop, jadwal 14:00-21:00) --
    -- kalau tetap dipotong di situ, shift itu tidak akan pernah dapat lembur sama sekali.
    -- Tetap dikombinasikan dengan batas 3 jam/hari yang sudah ada sebelumnya.
    v_ot_co_capped := CASE WHEN v_ot_sched_out < TIME '20:00:00'
                       THEN LEAST(v_co_local, TIME '20:00:00')
                       ELSE v_co_local END;
    v_ot_sec := GREATEST(0, EXTRACT(EPOCH FROM (v_ot_co_capped - v_ot_sched_out))::INT);
    IF v_ot_sec >= 3600 THEN
      -- Batas maksimal 3 jam lembur/hari, berlaku semua karyawan.
      NEW.overtime_hours := LEAST(3, FLOOR(v_ot_sec / 3600.0));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- p_only_ids: saat p_apply = true, HANYA baris ini yang diterapkan (dipilih HR dari pratinjau).
-- manually_edited = telat baris itu pernah diubah manual di Rekap Absensi (mis. dinolkan karena
-- "salah telat") -- di UI tidak dicentang default supaya keputusan HR tidak tertimpa diam-diam.
drop function if exists public.recalc_late_minutes(date, date, uuid, uuid, uuid, boolean, text);

create or replace function public.recalc_late_minutes(
  p_start date,
  p_end date,
  p_department_id uuid default null,
  p_branch_id uuid default null,
  p_employee_id uuid default null,
  p_apply boolean default false,
  p_reason text default null,
  p_only_ids uuid[] default null
)
returns table(
  attendance_id uuid,
  employee_id uuid,
  employee_name text,
  att_date date,
  check_in_local text,
  source text,
  old_late integer,
  new_late integer,
  manually_edited boolean,
  payroll_status text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_new int;
  v_uid uuid := auth.uid();
  -- Prefix tetap 'Hitung ulang telat' -- dipakai untuk membedakan dari edit manual.
  v_reason text := 'Hitung ulang telat: ' || coalesce(nullif(trim(p_reason), ''), 'jadwal kerja diubah');
begin
  if get_my_role() not in ('owner', 'hr') then
    raise exception 'Tidak diizinkan';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Rentang tanggal tidak valid';
  end if;
  if p_end - p_start > 62 then
    raise exception 'Rentang maksimal 62 hari';
  end if;
  if p_apply and (p_only_ids is null or cardinality(p_only_ids) = 0) then
    raise exception 'Pilih minimal satu baris untuk diterapkan';
  end if;

  for r in
    select a.id, a.employee_id, e.full_name, a.date, a.check_in, a.check_out, a.status,
           a.source, a.late_minutes, a.overtime_hours,
           exists (
             select 1 from attendance_edit_logs l
             where l.attendance_id = a.id
               and l.new_late_minutes is distinct from l.old_late_minutes
               and l.reason not like 'Hitung ulang telat%'
           ) as manual
    from attendances a
    join employees e on e.id = a.employee_id
    where a.date between p_start and p_end
      and a.status = 'present' and a.check_in is not null
      and (p_department_id is null or e.department_id = p_department_id)
      and (p_branch_id is null or e.branch_id = p_branch_id)
      and (p_employee_id is null or a.employee_id = p_employee_id)
      and (not p_apply or a.id = any(p_only_ids))
      -- Telat yang sudah dikompensasi HR (klarifikasi disetujui) tidak boleh muncul lagi.
      and not exists (
        select 1 from late_clarifications lc
        where lc.attendance_id = a.id and lc.status = 'approved'
      )
    order by e.full_name, a.date
  loop
    v_new := null;
    begin
      perform set_config('app.recalc_late', 'on', true);
      update attendances set check_in = check_in where id = r.id
        returning late_minutes into v_new;
      perform set_config('app.recalc_late', 'off', true);
      -- Pratinjau: batalkan perubahan baris ini (nilai v_new tetap tersimpan di variabel).
      if not p_apply then
        raise exception using errcode = 'RL001', message = 'preview';
      end if;
    exception when sqlstate 'RL001' then
      null;
    end;

    if v_new is distinct from r.late_minutes then
      if p_apply then
        insert into attendance_edit_logs (
          attendance_id, edited_by_user_id,
          old_check_in, old_check_out, old_status, old_late_minutes, old_overtime_hours,
          new_check_in, new_check_out, new_status, new_late_minutes, new_overtime_hours, reason)
        values (
          r.id, v_uid,
          r.check_in, r.check_out, r.status, r.late_minutes, r.overtime_hours,
          r.check_in, r.check_out, r.status, v_new, r.overtime_hours, v_reason);
      end if;

      attendance_id  := r.id;
      employee_id    := r.employee_id;
      employee_name  := r.full_name;
      att_date       := r.date;
      check_in_local := to_char(r.check_in at time zone 'Asia/Jakarta', 'HH24:MI');
      source         := r.source;
      old_late       := r.late_minutes;
      new_late       := v_new;
      manually_edited := r.manual;
      payroll_status := null;
      -- Periode gaji 26 bulan lalu s/d 25 bulan ini -> tanggal >= 26 masuk gaji bulan berikutnya.
      select p.status::text into payroll_status
      from payrolls p
      where p.employee_id = r.employee_id
        and (p.period_year * 12 + p.period_month) =
            (extract(year from r.date)::int * 12 + extract(month from r.date)::int
             + case when extract(day from r.date) >= 26 then 1 else 0 end)
      limit 1;
      return next;
    end if;
  end loop;

  perform set_config('app.recalc_late', 'off', true);
end;
$function$;

revoke all on function public.recalc_late_minutes(date, date, uuid, uuid, uuid, boolean, text, uuid[]) from public, anon;
grant execute on function public.recalc_late_minutes(date, date, uuid, uuid, uuid, boolean, text, uuid[]) to authenticated;
