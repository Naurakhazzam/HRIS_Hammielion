-- 108: Satukan aturan libur (Ajukan Libur, Ganti Libur, Tukar Libur saat Absen, Persetujuan HR).
--
-- Sebelumnya tiap jalur punya aturan sendiri dan saling tumpang tindih:
-- - Maks. 3 orang/hari SE-PERUSAHAAN (bukan per cabang) -- kuota secara matematis tidak cukup.
-- - Batas 1 weekend: RLS mengecualikan cabang <= 2 orang, halaman memblokir semua orang.
-- - "Jangan barengan satu cabang" & "jarak 5 hari" cuma peringatan, tapi HR menolak manual.
-- - Ganti Libur / Tukar saat Absen tidak mengecek kuota, weekend, maupun batas per hari.
-- - Libur yang dipindah tetap tercatat 'approved' di tanggal lama ("libur hantu") dan terus
--   memakan slot + hitungan weekend.
--
-- Aturan baru (satu sumber: dayoff_block_reason, dipakai di SEMUA jalur):
-- 1. Jatah 4 hari libur per periode 26-25 -- dihitung dari jadwal yang benar-benar berlaku
--    (employee_roster) + pengajuan yang belum diputuskan.
-- 2. Maks. 1 hari Sabtu/Minggu per periode, untuk semua karyawan.
-- 3. Per cabang per hari maks. 2 orang libur (1 orang kalau cabangnya cuma <= 2 orang).
--    Driver & karyawan gaji flat tidak dihitung (dan tidak dibatasi aturan ini).
-- 4. Aturan jarak 5 hari dihapus.

-- ---------------------------------------------------------------------------------------------
-- Status 'moved' = libur sudah disetujui tapi kemudian dipindah (Ganti Libur / Tukar saat Absen /
-- diedit HR di Jadwal & Shift). Riwayat & denda disiplinnya tetap ada, tapi tidak dihitung lagi.
alter table public.roster_pick_requests drop constraint if exists roster_pick_requests_status_check;
alter table public.roster_pick_requests add constraint roster_pick_requests_status_check
  check (status = any (array['draft', 'pending', 'approved', 'rejected', 'moved']));

-- Awal periode 26-25 yang menaungi p_date.
create or replace function public.roster_period_start(p_date date)
returns date language sql immutable as $$
  select case when extract(day from p_date) >= 26 then date_trunc('month', p_date::timestamp)::date + 25
              else (date_trunc('month', p_date::timestamp) - interval '1 month')::date + 25 end
$$;

-- Ikut dihitung dalam batas libur per cabang? (aktif, bukan driver, bukan gaji flat)
create or replace function public.dayoff_counted(p_employee_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((
    select e.is_active and e.employee_type <> 'driver' and not coalesce(e.flat_salary, false)
    from employees e where e.id = p_employee_id), false)
$$;

-- Maks. orang libur per hari di satu cabang: 1 kalau cabangnya <= 2 orang, selain itu 2.
create or replace function public.branch_dayoff_cap(p_branch_id uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select case when count(*) <= 2 then 1 else 2 end
  from employees e
  where e.branch_id = p_branch_id and e.is_active
    and e.employee_type <> 'driver' and not coalesce(e.flat_salary, false)
$$;

-- Alasan tanggal TIDAK BOLEH jadi libur karyawan ini (kosong = boleh). Cek tanggal lewat / H-2
-- tetap di masing-masing jalur karena batas waktunya memang beda.
--   p_ignore_date       = libur sendiri yang sedang dilepas (Ganti Libur / Tukar saat Absen)
--   p_ignore_request_id = pengajuan yang sedang dicek ulang (insert / approve HR)
--   p_skip_branch_cap   = tukar mutual satu cabang -- jumlah libur cabang di kedua tanggal tetap
create or replace function public.dayoff_block_reason(
  p_employee_id uuid,
  p_date date,
  p_ignore_date date default null,
  p_ignore_request_id uuid default null,
  p_skip_branch_cap boolean default false
) returns table(code text, reason text)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_start date := roster_period_start(p_date);
  v_end date := (roster_period_start(p_date) + interval '1 month')::date - 1;
  v_is_own boolean;
  v_own int;
  v_weekend int;
  v_branch uuid;
  v_cap int;
  v_count int;
  v_names text;
begin
  with own as (
    select er.date as d from employee_roster er
    where er.employee_id = p_employee_id and er.is_day_off and er.date between v_start and v_end
    union
    select r.requested_date from roster_pick_requests r
    where r.employee_id = p_employee_id and r.status in ('draft', 'pending')
      and r.id is distinct from p_ignore_request_id
      and r.requested_date between v_start and v_end
  )
  select bool_or(d = p_date),
         count(*) filter (where d <> p_date),
         count(*) filter (where d <> p_date and extract(dow from d) in (0, 6))
    into v_is_own, v_own, v_weekend
  from own where d is distinct from p_ignore_date;

  if coalesce(v_is_own, false) then
    return query select 'own'::text, 'Tanggal itu sudah jadi hari libur Anda.'::text; return;
  end if;
  if v_own >= 4 then
    return query select 'quota'::text, 'Jatah 4 hari libur periode ini sudah penuh.'::text; return;
  end if;
  if extract(dow from p_date) in (0, 6) and v_weekend >= 1 then
    return query select 'weekend'::text, 'Jatah 1 hari Sabtu/Minggu periode ini sudah terpakai.'::text; return;
  end if;

  if not p_skip_branch_cap and dayoff_counted(p_employee_id) then
    select branch_id into v_branch from employees where id = p_employee_id;
    if v_branch is not null then
      v_cap := branch_dayoff_cap(v_branch);
      select count(*), string_agg(e.full_name, ', ' order by e.full_name) into v_count, v_names
      from employees e
      where e.branch_id = v_branch and e.id <> p_employee_id and e.is_active
        and e.employee_type <> 'driver' and not coalesce(e.flat_salary, false)
        and (exists (select 1 from employee_roster er where er.employee_id = e.id and er.date = p_date and er.is_day_off)
          or exists (select 1 from roster_pick_requests r where r.employee_id = e.id and r.requested_date = p_date
                       and r.status = 'pending' and r.id is distinct from p_ignore_request_id));
      if v_count >= v_cap then
        return query select 'full'::text,
          format('Sudah penuh: maks. %s orang libur per hari di cabang ini (%s).', v_cap, v_names); return;
      end if;
    end if;
  end if;
end;
$$;
revoke execute on function public.dayoff_block_reason(uuid, date, date, uuid, boolean) from public, anon, authenticated;

-- Versi "raise" untuk jalur yang menyimpan data. Signature lama dipertahankan (dipakai trigger
-- insert & decide_roster_pick_request).
create or replace function public.check_dayoff_pick_rules(p_employee_id uuid, p_date date, p_exclude_request_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_reason text;
begin
  perform pg_advisory_xact_lock(hashtext('dayoff_pick:' || p_date::text));
  select b.reason into v_reason from dayoff_block_reason(p_employee_id, p_date, null, p_exclude_request_id) b;
  if v_reason is not null then
    raise exception '%: %', to_char(p_date, 'DD-MM-YYYY'), v_reason;
  end if;
end;
$$;

-- Insert pengajuan: aturan isi (kuota, weekend, per cabang) pindah ke trigger supaya pesan
-- errornya jelas -- RLS cuma menjaga kepemilikan & rentang tanggal. Pakai tanggal WIB, bukan UTC.
drop policy if exists roster_pick_requests_insert on public.roster_pick_requests;
create policy roster_pick_requests_insert on public.roster_pick_requests for insert
  with check (
    employee_id = get_my_employee_id()
    and status = 'pending'
    and requested_date > (now() at time zone 'Asia/Jakarta')::date
    and period_start = roster_period_start(requested_date)
    and requested_date <= period_end
  );

-- ---------------------------------------------------------------------------------------------
-- Libur hantu: begitu jadwal libur di employee_roster dilepas (jalur mana pun), pengajuan
-- 'approved' di tanggal itu ditandai 'moved'.
create or replace function public.mark_roster_pick_moved()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if old.is_day_off and (tg_op = 'DELETE'
      or not new.is_day_off or new.date <> old.date or new.employee_id <> old.employee_id) then
    update roster_pick_requests set status = 'moved'
    where employee_id = old.employee_id and requested_date = old.date and status = 'approved';
  end if;
  return null;
end;
$$;
drop trigger if exists trg_mark_roster_pick_moved on public.employee_roster;
create trigger trg_mark_roster_pick_moved after update or delete on public.employee_roster
  for each row execute function public.mark_roster_pick_moved();

-- Bersihkan libur hantu yang sudah ada.
update public.roster_pick_requests r set status = 'moved'
where r.status = 'approved'
  and not exists (select 1 from public.employee_roster er
                  where er.employee_id = r.employee_id and er.date = r.requested_date and er.is_day_off);

-- ---------------------------------------------------------------------------------------------
-- RPC untuk halaman: alasan blokir per tanggal & batas cabang (karyawan sendiri, atau Owner/HR/
-- Finance untuk Preview Tampilan Karyawan).
create or replace function public.get_dayoff_block_reasons(p_employee_id uuid, p_from date, p_to date, p_ignore_date date default null)
returns table(off_date date, code text, reason text)
language sql stable security definer set search_path to 'public' as $$
  select gs::date, b.code, b.reason
  from generate_series(p_from, p_to, interval '1 day') gs
  cross join lateral dayoff_block_reason(p_employee_id, gs::date, p_ignore_date) b
  where (p_employee_id = get_my_employee_id()
         or get_my_role() = any (array['owner'::user_role, 'hr'::user_role, 'finance'::user_role]))
    and p_to - p_from <= 62;
$$;

-- null = tidak dibatasi per cabang (driver / gaji flat / tanpa cabang).
create or replace function public.get_dayoff_branch_cap(p_employee_id uuid)
returns int language sql stable security definer set search_path to 'public' as $$
  select case when dayoff_counted(e.id) and e.branch_id is not null then branch_dayoff_cap(e.branch_id) end
  from employees e
  where e.id = p_employee_id
    and (p_employee_id = get_my_employee_id()
         or get_my_role() = any (array['owner'::user_role, 'hr'::user_role, 'finance'::user_role]));
$$;

-- Kalender libur: tambah kolom `counted` supaya halaman bisa menampilkan hitungan per cabang
-- yang sama dengan aturan di atas.
drop function if exists public.get_dayoff_pick_calendar(date, date);
create function public.get_dayoff_pick_calendar(p_from date, p_to date)
returns table(off_date date, employee_id uuid, full_name text, branch_id uuid, branch_name text, status text, counted boolean)
language sql stable security definer set search_path to 'public' as $$
  select distinct on (x.d, x.emp) x.d, x.emp, e.full_name::text, e.branch_id, b.name::text, x.status,
         (e.employee_type <> 'driver' and not coalesce(e.flat_salary, false))
  from (
    select r.requested_date as d, r.employee_id as emp, r.status::text as status, 1 as prio
    from roster_pick_requests r
    where r.status = 'pending' and r.requested_date between p_from and p_to
    union all
    select er.date, er.employee_id, 'approved', 0
    from employee_roster er
    where er.is_day_off = true and er.date between p_from and p_to
  ) x
  join employees e on e.id = x.emp and e.is_active = true
  left join branches b on b.id = e.branch_id
  order by x.d, x.emp, x.prio;
$$;

-- Peringatan untuk HR: aturan jarak 5 hari dihapus (near_dates selalu null).
create or replace function public.get_dayoff_pick_warnings(p_request_ids uuid[])
returns table(request_id uuid, same_branch_names text, near_dates text)
language sql stable security definer set search_path to 'public' as $$
  select r.id,
    (select string_agg(distinct e2.full_name, ', ')
     from employees e2
     where e2.branch_id = e.branch_id and e2.id <> r.employee_id and e2.is_active = true
       and (exists (select 1 from roster_pick_requests r2 where r2.employee_id = e2.id and r2.requested_date = r.requested_date and r2.status = 'pending')
         or exists (select 1 from employee_roster er where er.employee_id = e2.id and er.date = r.requested_date and er.is_day_off = true))),
    null::text
  from roster_pick_requests r
  join employees e on e.id = r.employee_id
  where r.id = any(p_request_ids)
    and get_my_role() = any (array['owner'::user_role, 'hr'::user_role]);
$$;

-- Kuota per karyawan: "disetujui" = libur yang benar-benar ada di jadwal periode itu (termasuk
-- hasil Ganti Libur / atur HR), bukan baris pengajuan 'approved' yang bisa saja sudah dipindah.
create or replace function public.get_dayoff_quota_status(p_period_start date)
returns table(employee_id uuid, full_name text, branch_name text, approved_count integer, pending_count integer, draft_count integer)
language sql stable security definer set search_path to 'public' as $$
  select e.id, e.full_name, b.name,
    (select count(*)::int from employee_roster er where er.employee_id = e.id and er.is_day_off
       and er.date between p_period_start and (p_period_start + interval '1 month')::date - 1),
    (select count(*)::int from roster_pick_requests r where r.employee_id = e.id and r.period_start = p_period_start and r.status = 'pending'),
    (select count(*)::int from roster_pick_requests r where r.employee_id = e.id and r.period_start = p_period_start and r.status = 'draft')
  from employees e
  left join branches b on b.id = e.branch_id
  where e.is_active = true
    and coalesce(e.flat_salary, false) = false
    and e.employee_type <> 'driver'
    and (get_my_role() = 'owner' or e.id = get_my_employee_id())
  order by e.full_name;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ganti Libur: pindah langsung boleh selama cabang belum penuh di tanggal baru; tukar dengan
-- rekan cuma wajib kalau sudah penuh. Kuota & weekend dicek untuk KEDUA pihak.
create or replace function public.request_day_off_change(p_original_date date, p_requested_date date, p_counterpart_id uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_me uuid := get_my_employee_id();
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_my_branch uuid;
  v_new_id uuid;
  v_code text;
  v_reason text;
  v_cp_name text;
begin
  if v_me is null then
    raise exception 'Karyawan tidak ditemukan.';
  end if;
  if p_requested_date = p_original_date then
    raise exception 'Tanggal baru harus berbeda dari tanggal libur sekarang.';
  end if;
  if least(p_original_date, p_requested_date) < v_today + 2 then
    raise exception 'Pengajuan ganti libur minimal 2 hari sebelum tanggal yang paling dekat (baik tanggal lama maupun tanggal baru).';
  end if;
  if not exists (select 1 from employee_roster where employee_id = v_me and date = p_original_date and is_day_off = true) then
    raise exception 'Tanggal itu bukan hari libur Anda yang sudah disetujui.';
  end if;
  if exists (select 1 from roster_change_requests where requester_id = v_me and status in ('pending_counterpart', 'pending_approval')) then
    raise exception 'Anda masih punya pengajuan ganti libur yang sedang diproses.';
  end if;

  select branch_id into v_my_branch from employees where id = v_me;

  if p_counterpart_id is not null then
    if p_counterpart_id = v_me then
      raise exception 'Tidak bisa memilih diri sendiri sebagai rekan tukar.';
    end if;
    select e.full_name into v_cp_name
    from employees e join employee_roster er on er.employee_id = e.id
    where e.id = p_counterpart_id and e.is_active = true and e.branch_id = v_my_branch
      and er.date = p_requested_date and er.is_day_off = true;
    if v_cp_name is null then
      raise exception 'Rekan yang dipilih tidak memiliki hari libur di tanggal itu.';
    end if;

    select b.reason into v_reason from dayoff_block_reason(v_me, p_requested_date, p_original_date, null, true) b;
    if v_reason is not null then raise exception '%', v_reason; end if;
    select b.reason into v_reason from dayoff_block_reason(p_counterpart_id, p_original_date, p_requested_date, null, true) b;
    if v_reason is not null then raise exception 'Tidak bisa tukar dengan %: %', v_cp_name, v_reason; end if;

    insert into roster_change_requests (requester_id, original_date, requested_date, counterpart_id, counterpart_status, status)
    values (v_me, p_original_date, p_requested_date, p_counterpart_id, 'pending', 'pending_counterpart')
    returning id into v_new_id;
  else
    select b.code, b.reason into v_code, v_reason from dayoff_block_reason(v_me, p_requested_date, p_original_date) b;
    if v_code = 'full' then
      raise exception '% Pilih salah satu rekan tersebut untuk diajak tukar.', v_reason;
    elsif v_reason is not null then
      raise exception '%', v_reason;
    end if;

    insert into roster_change_requests (requester_id, original_date, requested_date, status)
    values (v_me, p_original_date, p_requested_date, 'pending_approval')
    returning id into v_new_id;
  end if;

  return v_new_id;
end;
$$;

-- HR menyetujui Ganti Libur: cek ulang aturan (keadaan bisa sudah berubah sejak diajukan).
create or replace function public.decide_day_off_change(p_request_id uuid, p_approve boolean, p_reason text default null, p_requester_schedule_id uuid default null, p_counterpart_schedule_id uuid default null)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_my_employee_id uuid := get_my_employee_id();
  v_req roster_change_requests%rowtype;
  v_reason text;
  v_name text;
begin
  if not (get_my_role() = any (array['owner'::user_role, 'hr'::user_role])) then
    raise exception 'Hanya Owner/HR yang bisa memutuskan pengajuan ini.';
  end if;

  select * into v_req from roster_change_requests where id = p_request_id for update;
  if not found then
    raise exception 'Pengajuan tidak ditemukan.';
  end if;
  if v_req.status <> 'pending_approval' then
    raise exception 'Pengajuan ini belum siap diputuskan (masih menunggu rekan, atau sudah diproses).';
  end if;

  if p_approve then
    if p_requester_schedule_id is null then
      raise exception 'Pilih jadwal kerja untuk pemohon di tanggal lama.';
    end if;
    if v_req.counterpart_id is not null and p_counterpart_schedule_id is null then
      raise exception 'Pilih jadwal kerja untuk rekan di tanggal yang ia lepas.';
    end if;

    perform pg_advisory_xact_lock(hashtext('dayoff_pick:' || v_req.requested_date::text));
    select full_name into v_name from employees where id = v_req.requester_id;
    select b.reason into v_reason
    from dayoff_block_reason(v_req.requester_id, v_req.requested_date, v_req.original_date, null, v_req.counterpart_id is not null) b;
    if v_reason is not null then raise exception 'Tidak bisa disetujui (%): %', v_name, v_reason; end if;
    if v_req.counterpart_id is not null then
      select full_name into v_name from employees where id = v_req.counterpart_id;
      select b.reason into v_reason
      from dayoff_block_reason(v_req.counterpart_id, v_req.original_date, v_req.requested_date, null, true) b;
      if v_reason is not null then raise exception 'Tidak bisa disetujui (%): %', v_name, v_reason; end if;
    end if;

    update employee_roster set schedule_id = p_requester_schedule_id, is_day_off = false
      where employee_id = v_req.requester_id and date = v_req.original_date;

    insert into employee_roster (employee_id, date, schedule_id, is_day_off, assigned_by)
    values (v_req.requester_id, v_req.requested_date, null, true, v_my_employee_id)
    on conflict (employee_id, date) do update
      set schedule_id = null, is_day_off = true, assigned_by = excluded.assigned_by;

    if v_req.counterpart_id is not null then
      update employee_roster set schedule_id = p_counterpart_schedule_id, is_day_off = false
        where employee_id = v_req.counterpart_id and date = v_req.requested_date;

      insert into employee_roster (employee_id, date, schedule_id, is_day_off, assigned_by)
      values (v_req.counterpart_id, v_req.original_date, null, true, v_my_employee_id)
      on conflict (employee_id, date) do update
        set schedule_id = null, is_day_off = true, assigned_by = excluded.assigned_by;
    end if;

    update roster_change_requests set status = 'approved', decided_by = v_my_employee_id, decided_at = now()
      where id = p_request_id;
  else
    update roster_change_requests set status = 'rejected', rejection_reason = p_reason, decided_by = v_my_employee_id, decided_at = now()
      where id = p_request_id;
  end if;
end;
$$;

-- Tukar Libur saat Absen: tetap jalur darurat, tapi tanggal penggantinya ikut aturan yang sama.
create or replace function public.request_day_off_swap(p_employee_id uuid, p_schedule_id uuid, p_replacement_date date)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
  v_dept uuid;
  v_sched_dept uuid;
  v_reason text;
begin
  if get_my_employee_id() is distinct from p_employee_id then
    raise exception 'Tidak diizinkan.';
  end if;
  if p_replacement_date <= v_today then
    raise exception 'Tanggal pengganti harus setelah hari ini.';
  end if;
  if not exists (select 1 from employee_roster where employee_id = p_employee_id and date = v_today and is_day_off = true) then
    raise exception 'Hari ini bukan jadwal libur Anda.';
  end if;

  select department_id into v_dept from employees where id = p_employee_id;
  select applies_to_dept into v_sched_dept from work_schedules where id = p_schedule_id;
  if v_sched_dept is null or v_sched_dept is distinct from v_dept then
    raise exception 'Jadwal kerja tidak valid untuk departemen Anda.';
  end if;

  perform pg_advisory_xact_lock(hashtext('dayoff_pick:' || p_replacement_date::text));
  select b.reason into v_reason from dayoff_block_reason(p_employee_id, p_replacement_date, v_today) b;
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  update employee_roster
  set schedule_id = p_schedule_id, is_day_off = false
  where employee_id = p_employee_id and date = v_today;

  insert into employee_roster (employee_id, date, schedule_id, is_day_off, assigned_by)
  values (p_employee_id, p_replacement_date, null, true, p_employee_id)
  on conflict (employee_id, date) do update
    set schedule_id = null, is_day_off = true, assigned_by = excluded.assigned_by;

  insert into roster_swap_logs (employee_id, original_date, replacement_date)
  values (p_employee_id, v_today, p_replacement_date);
end;
$$;
