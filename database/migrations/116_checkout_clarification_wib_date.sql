-- 116: Klarifikasi "Lupa Absen Pulang" pakai tanggal WIB server, bukan current_date (UTC).
--
-- Masalah: current_date di database = tanggal UTC. Antara 00:00-06:59 WIB tanggal UTC masih
-- kemarin, jadi klarifikasi untuk tanggal kemarin ditolak "Belum bisa diajukan untuk hari ini"
-- sampai jam 07:00 WIB. Sisanya identik dengan versi sebelumnya.

create or replace function public.submit_checkout_clarification(p_attendance_id uuid, p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_att record;
  v_emp_id uuid := get_my_employee_id();
  v_id uuid;
  v_period_start date;
  v_period_end date;
  v_count integer;
begin
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'Keterangan wajib diisi';
  end if;

  select * into v_att from attendances where id = p_attendance_id for update;
  if not found then
    raise exception 'Data absensi tidak ditemukan';
  end if;
  if v_att.employee_id != v_emp_id then
    raise exception 'Tidak berhak mengklarifikasi absensi ini';
  end if;
  if v_att.status != 'present' or v_att.check_in is null or v_att.check_out is not null then
    raise exception 'Absensi ini bukan kasus lupa absen pulang (harus sudah absen masuk, belum absen pulang)';
  end if;
  if v_att.date >= (now() at time zone 'Asia/Jakarta')::date then
    raise exception 'Belum bisa diajukan untuk hari ini -- tunggu sampai hari itu selesai';
  end if;
  if exists (select 1 from checkout_clarifications where attendance_id = p_attendance_id and status = 'pending') then
    raise exception 'Sudah ada klarifikasi yang menunggu untuk tanggal ini';
  end if;

  -- Kuota "Lupa Absen Pulang": maksimal 4 kali per periode gajian (26-25), terpisah dari kuota
  -- Lupa Absen Masuk.
  v_period_start := case when extract(day from v_att.date) >= 26
    then (date_trunc('month', v_att.date) + interval '25 days')::date
    else (date_trunc('month', v_att.date) - interval '1 month' + interval '25 days')::date
  end;
  v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;

  select count(*) into v_count
  from checkout_clarifications
  where employee_id = v_emp_id and status in ('pending', 'approved')
    and date between v_period_start and v_period_end;

  if v_count >= 4 then
    raise exception 'Jatah klarifikasi "Lupa Absen Pulang" periode ini sudah habis (maksimal 4x) -- hubungi HR langsung.';
  end if;

  insert into checkout_clarifications (attendance_id, employee_id, date, reason, status)
  values (p_attendance_id, v_emp_id, v_att.date, trim(p_reason), 'pending')
  returning id into v_id;

  return v_id;
end;
$function$;
