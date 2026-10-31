-- 105: Persetujuan kasbon boleh oleh Owner/HR/Finance + nominal cair bisa diatur saat menyetujui.
--
-- Sebelumnya:
-- - Kasbon karyawan (kasbon_requests): 2 tahap, Finance cek nominal -> Owner verifikasi akhir
--   (RLS kasbon_req_update owner-saja). HR sama sekali tidak bisa memproses.
-- - Kasbon driver/kenek (driver_kasbon/helper_kasbon): approve_*_kasbon owner-saja, dan nominal
--   cair selalu = nominal pengajuan (tidak bisa disesuaikan). Pengajuan yang belum di-ACC tidak
--   muncul di Penggajian Driver (cuma status 'active' yang dipotong), jadi kasbon "tidak masuk".
--
-- Sekarang: satu langkah persetujuan oleh Owner/HR/Finance, nominal cair ditentukan saat itu juga
-- (default = nominal pengajuan, boleh lebih kecil/besar). Nominal pengajuan awal disimpan
-- (original_amount_requested / original_amount) supaya tetap kelihatan kalau disesuaikan.
-- Lewat RPC SECURITY DEFINER supaya update status + cicilan atomik dan role-nya ditegakkan di DB,
-- bukan cuma sembunyi tombol di UI.

-- ── Kasbon karyawan ──────────────────────────────────────────────────────────────────────────
create or replace function public.approve_kasbon_request(
  p_id uuid,
  p_amount numeric,
  p_deduction_per_month numeric,
  p_start_month int,
  p_start_year int
) returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req kasbon_requests%rowtype;
  v_total int;
  v_month int;
  v_year int;
  i int;
begin
  if get_my_role() not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang bisa menyetujui kasbon.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Nominal cair harus lebih dari 0.';
  end if;
  if p_deduction_per_month is null or p_deduction_per_month <= 0 then
    raise exception 'Cicilan per bulan harus lebih dari 0.';
  end if;
  if p_start_month not between 1 and 12 then
    raise exception 'Bulan mulai cicilan tidak valid.';
  end if;

  -- FOR UPDATE + cek status mencegah dua orang menyetujui pengajuan yang sama bersamaan
  -- (dobel cicilan / dobel Kas Keluar).
  select * into v_req from kasbon_requests where id = p_id for update;
  if not found then
    raise exception 'Pengajuan kasbon tidak ditemukan.';
  end if;
  if v_req.status not in ('pending', 'finance_reviewed') then
    raise exception 'Pengajuan ini sudah diproses (status: %). Silakan refresh.', v_req.status;
  end if;

  -- Trigger fin_autopost_kasbon_request otomatis mencatat Kas Keluar sebesar amount_requested
  -- (= nominal cair) dan menandai disbursed_at.
  update kasbon_requests set
    original_amount_requested = coalesce(original_amount_requested, amount_requested),
    amount_requested = p_amount,
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = now(),
    deduction_per_month = p_deduction_per_month,
    deduction_start_month = p_start_month,
    deduction_start_year = p_start_year
  where id = p_id;

  v_total := ceil(p_amount / p_deduction_per_month);
  for i in 0 .. v_total - 1 loop
    v_month := ((p_start_month - 1 + i) % 12) + 1;
    v_year := p_start_year + ((p_start_month - 1 + i) / 12);
    insert into kasbon_deductions (kasbon_request_id, employee_id, deduction_month, deduction_year, amount, status)
    values (
      p_id, v_req.employee_id, v_month, v_year,
      case when i = v_total - 1 then p_amount - p_deduction_per_month * (v_total - 1) else p_deduction_per_month end,
      'pending'
    );
  end loop;

  return v_total;
end;
$$;

create or replace function public.reject_kasbon_request(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if get_my_role() not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang bisa menolak kasbon.';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Alasan penolakan wajib diisi.';
  end if;
  update kasbon_requests set status = 'rejected', rejection_reason = trim(p_reason)
  where id = p_id and status in ('pending', 'finance_reviewed');
  if not found then
    raise exception 'Pengajuan ini sudah diproses. Silakan refresh.';
  end if;
end;
$$;

grant execute on function public.approve_kasbon_request(uuid, numeric, numeric, int, int) to authenticated;
grant execute on function public.reject_kasbon_request(uuid, text) to authenticated;

-- ── Kasbon driver & kenek ────────────────────────────────────────────────────────────────────
alter table public.driver_kasbon add column if not exists original_amount numeric;
alter table public.helper_kasbon add column if not exists original_amount numeric;

-- Signature lama (1 argumen) di-drop dulu, kalau tidak panggilan rpc dengan 1 argumen jadi ambigu.
drop function if exists public.approve_driver_kasbon(uuid);
drop function if exists public.approve_helper_kasbon(uuid);

create or replace function public.approve_driver_kasbon(p_kasbon_id uuid, p_amount numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if get_my_role() not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang bisa menyetujui kasbon driver.';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'Nominal cair harus lebih dari 0.';
  end if;
  -- total_amount ikut diubah di UPDATE yang sama dengan status, jadi trigger
  -- fin_autopost_driver_kasbon mencatat Kas Keluar sebesar nominal cair.
  update driver_kasbon set
    original_amount = coalesce(original_amount, total_amount),
    total_amount = coalesce(p_amount, total_amount),
    remaining_amount = coalesce(p_amount, total_amount),
    status = 'active',
    updated_at = now()
  where id = p_kasbon_id and status = 'pending_approval';
  if not found then
    raise exception 'Kasbon ini sudah diproses. Silakan refresh.';
  end if;
end;
$$;

create or replace function public.approve_helper_kasbon(p_kasbon_id uuid, p_amount numeric default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if get_my_role() not in ('owner', 'hr', 'finance') then
    raise exception 'Hanya Owner/HR/Finance yang bisa menyetujui kasbon kenek.';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'Nominal cair harus lebih dari 0.';
  end if;
  update helper_kasbon set
    original_amount = coalesce(original_amount, total_amount),
    total_amount = coalesce(p_amount, total_amount),
    remaining_amount = coalesce(p_amount, total_amount),
    status = 'active',
    updated_at = now()
  where id = p_kasbon_id and status = 'pending_approval';
  if not found then
    raise exception 'Kasbon ini sudah diproses. Silakan refresh.';
  end if;
end;
$$;

grant execute on function public.approve_driver_kasbon(uuid, numeric) to authenticated;
grant execute on function public.approve_helper_kasbon(uuid, numeric) to authenticated;
