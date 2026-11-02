-- 119: Tutup sementara pengajuan kasbon.
-- Semua pengajuan baru (kasbon staff, driver, kenek) ditolak di level database,
-- jadi tidak bisa ditembus walau lewat API langsung. Kasbon lama & potongannya tetap berjalan.
-- Untuk membuka kembali: jalankan bagian "BUKA KEMBALI" di bawah, lalu set KASBON_DITUTUP = false
-- di app/(dashboard)/kasbon/page.tsx.

create or replace function public.tolak_pengajuan_kasbon()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Kasbon tidak bisa diajukan bulan ini';
end;
$$;

drop trigger if exists trg_tolak_pengajuan_kasbon on public.kasbon_requests;
create trigger trg_tolak_pengajuan_kasbon
  before insert on public.kasbon_requests
  for each row execute function public.tolak_pengajuan_kasbon();

drop trigger if exists trg_tolak_pengajuan_kasbon on public.driver_kasbon;
create trigger trg_tolak_pengajuan_kasbon
  before insert on public.driver_kasbon
  for each row execute function public.tolak_pengajuan_kasbon();

drop trigger if exists trg_tolak_pengajuan_kasbon on public.helper_kasbon;
create trigger trg_tolak_pengajuan_kasbon
  before insert on public.helper_kasbon
  for each row execute function public.tolak_pengajuan_kasbon();

-- BUKA KEMBALI:
-- drop trigger if exists trg_tolak_pengajuan_kasbon on public.kasbon_requests;
-- drop trigger if exists trg_tolak_pengajuan_kasbon on public.driver_kasbon;
-- drop trigger if exists trg_tolak_pengajuan_kasbon on public.helper_kasbon;
-- drop function if exists public.tolak_pengajuan_kasbon();
