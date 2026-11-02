-- 118: Satu pintu angka potongan & lembur staff (menu Penggajian → Setup Gaji & Tarif →
-- Potongan & Lembur). Satu baris = satu set aturan yang berlaku MULAI periode effective_from
-- (tanggal 26) sampai ada set berikutnya. Dibaca lib/payrollRules.ts → fetchPayrollRules().
--
-- Menggantikan: salary_defaults.late_penalty_per_minute & overtime_rate_per_hour, serta
-- salary_components.overtime_rate_per_hour per karyawan (kolom lama dibiarkan untuk histori,
-- tidak dibaca lagi untuk hitungan).

create table if not exists public.payroll_rules (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique check (extract(day from effective_from) = 26),
  overtime_rate_per_hour numeric not null default 10000 check (overtime_rate_per_hour >= 0),
  late_penalty_per_minute numeric not null default 1000 check (late_penalty_per_minute >= 0),
  izin_start numeric not null default 1.5 check (izin_start >= 0),
  izin_step numeric not null default 0.2 check (izin_step >= 0),
  izin_max numeric not null default 2 check (izin_max >= 0),
  sudden_start numeric not null default 1.5 check (sudden_start >= 0),
  sudden_step numeric not null default 0.2 check (sudden_step >= 0),
  sudden_max numeric not null default 2 check (sudden_max >= 0),
  alpha_start numeric not null default 1.5 check (alpha_start >= 0),
  alpha_step numeric not null default 0.2 check (alpha_step >= 0),
  alpha_max numeric not null default 2 check (alpha_max >= 0),
  sick_doc_day1 numeric not null default 0 check (sick_doc_day1 >= 0),
  sick_doc_day2_3 numeric not null default 0.5 check (sick_doc_day2_3 >= 0),
  sick_doc_day4_plus numeric not null default 1 check (sick_doc_day4_plus >= 0),
  training_multiplier numeric not null default 1 check (training_multiplier >= 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.payroll_rules enable row level security;

-- Semua user login boleh baca (Portal, Panduan, Aturan Potongan karyawan butuh angkanya).
drop policy if exists payroll_rules_read on public.payroll_rules;
create policy payroll_rules_read on public.payroll_rules for select to authenticated using (true);

drop policy if exists payroll_rules_write on public.payroll_rules;
create policy payroll_rules_write on public.payroll_rules for all to authenticated
  using (get_my_role() in ('owner', 'hr', 'finance'))
  with check (get_my_role() in ('owner', 'hr', 'finance'));

-- Periode sebelum Oktober 2026: tarif lama (lembur Rp7.500, telat sesuai Gaji Standar). Pengali
-- tidak dipakai di periode ini (selalu flat 1x, lihat NEW_RULES_CUTOFF_DATE).
insert into public.payroll_rules (effective_from, overtime_rate_per_hour, late_penalty_per_minute,
  izin_start, izin_step, izin_max, sudden_start, sudden_step, sudden_max, alpha_start, alpha_step, alpha_max)
select '2000-01-26', 7500, coalesce((select late_penalty_per_minute from salary_defaults limit 1), 1000),
  1, 0.25, 2, 1.25, 0.25, 2, 1.5, 0.5, 3
on conflict (effective_from) do nothing;

-- Mulai periode Oktober 2026 (26 Sep – 25 Okt): keputusan Owner November 2026.
insert into public.payroll_rules (effective_from, overtime_rate_per_hour, late_penalty_per_minute)
select '2026-09-26', 10000, coalesce((select late_penalty_per_minute from salary_defaults limit 1), 1000)
on conflict (effective_from) do nothing;
