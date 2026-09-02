-- ============================================================
-- Golden Yat Turu Operasyon – Supabase Şeması
-- Supabase Dashboard → SQL Editor'da bu dosyayı çalıştırın.
-- ============================================================

-- ── 1. profiles (personel bilgisi) ──────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  role        text not null default 'operator',
  created_at  timestamptz not null default now()
);

-- Yeni kullanıcı kayıt olunca otomatik profil oluştur
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2. tours (tur seansları) ─────────────────────────────────
create table if not exists public.tours (
  id              uuid primary key default gen_random_uuid(),
  tour_date       date not null,
  code            text not null,           -- T1, T2, …
  departure_time  time,
  notes           text default '',
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  unique (tour_date, code)
);

-- ── 3. bookings (rezervasyonlar) ────────────────────────────
create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  tour_id         uuid not null references public.tours(id) on delete cascade,
  yacht           text default '',
  name            text not null default '',
  pax             int not null default 1,
  baby            int not null default 0,
  phone           text default '',
  source          text default '',
  tour_guide      text default '',
  payment         text default '',
  staff           text default '',
  remarks         text default '',
  transfer        boolean not null default false,
  checked_in      boolean not null default false,
  checked_in_at   timestamptz,
  checked_in_by   uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);

-- updated_at otomatik güncelle
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_updated_at on public.bookings;
create trigger bookings_updated_at
  before update on public.bookings
  for each row execute procedure public.set_updated_at();

-- ── 4. RLS politikaları ──────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.tours    enable row level security;
alter table public.bookings enable row level security;

-- profiles: herkes okuyabilir (check-in yapanın adını göstermek için)
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- tours: oturum açmış herkes CRUD
create policy "tours_select" on public.tours for select using (auth.role() = 'authenticated');
create policy "tours_insert" on public.tours for insert with check (auth.role() = 'authenticated');
create policy "tours_update" on public.tours for update using (auth.role() = 'authenticated');
create policy "tours_delete" on public.tours for delete using (auth.role() = 'authenticated');

-- bookings: oturum açmış herkes CRUD
create policy "bookings_select" on public.bookings for select using (auth.role() = 'authenticated');
create policy "bookings_insert" on public.bookings for insert with check (auth.role() = 'authenticated');
create policy "bookings_update" on public.bookings for update using (auth.role() = 'authenticated');
create policy "bookings_delete" on public.bookings for delete using (auth.role() = 'authenticated');

-- ── 5. Realtime ──────────────────────────────────────────────
-- Supabase Dashboard → Database → Replication bölümünden
-- aşağıdaki tabloları 'supabase_realtime' publication'a ekleyin:
--   public.bookings
--   public.tours
-- Veya SQL ile:
alter publication supabase_realtime add table public.bookings;
alter publication supabase_realtime add table public.tours;
alter publication supabase_realtime add table public.yacht_crews;

-- ── 6. Yat Ekibi ─────────────────────────────────────────────
-- Her tur+yat kombinasyonu için tek rehber + tek personel
create table if not exists public.yacht_crews (
  id          uuid primary key default gen_random_uuid(),
  tour_id     uuid not null references public.tours(id) on delete cascade,
  yacht       text not null,
  tour_guide  text not null default '',
  staff       text not null default '',
  created_at  timestamptz not null default now(),
  constraint  yacht_crews_tour_yacht_unique unique (tour_id, yacht)
);
alter table public.yacht_crews enable row level security;
create policy "yc_select" on public.yacht_crews for select using (auth.role()='authenticated');
create policy "yc_insert" on public.yacht_crews for insert with check (auth.role()='authenticated');
create policy "yc_update" on public.yacht_crews for update using (auth.role()='authenticated');
create policy "yc_delete" on public.yacht_crews for delete using (auth.role()='authenticated');

-- ── 7. Migrasyon: agency kolonu kaldırıldı (2026-06) ─────────
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings drop column if exists agency;

-- ── 8. Kullanıcı adı ile giriş (2026-06) ─────────────────────
-- Giriş ekranı kullanıcı adı + şifre ister; kullanıcı adını
-- e-postaya bu fonksiyon çevirir. SQL Editor'da bir kez çalıştırın.
alter table public.profiles add column if not exists username text unique;

create or replace function public.email_for_username(p_username text)
returns text language sql security definer set search_path = public as $$
  select u.email from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;
grant execute on function public.email_for_username(text) to anon, authenticated;

-- ── 9. Migrasyon: transfer_note (2026-06) ────────────────────
-- Transfer işaretli rezervasyonlara serbest metin açıklama.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists transfer_note text not null default '';

-- ── 10. Migrasyon: yacht_crews.staff → text[] (2026-06) ──────
-- Bir yata birden fazla personel atanabilsin diye staff dizi oldu.
-- Rehber/personel artık yat seviyesinde (yacht_crews) tutulur;
-- bookings.tour_guide / bookings.staff kolonları görüntü için
-- kullanılmaz (liste değerleri yatın ekibinden türetilir).
alter table public.yacht_crews
  alter column staff drop default,
  alter column staff type text[] using (
    case when staff is null or btrim(staff)='' then '{}'::text[] else array[staff] end),
  alter column staff set default '{}';

-- ── 11. Migrasyon: unpaid tutar + para birimi (2026-08) ──────
-- Payment "Unpaid" seçilince ne kadar borç kaldığını kaydetmek için.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists unpaid_amount numeric;
alter table public.bookings add column if not exists unpaid_currency text;

-- ── 12. Migrasyon: PRV ekstra hizmetler (2026-08) ────────────
-- Tour=PRV seçilince açılan ekstra hizmet + ücret alanları
-- (Belly Dancer, DJ, Photographer, vb.) tek bir JSONB kolonunda
-- tutulur; ortak bir para birimi de ayrı kolonda saklanır.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists prv_extras jsonb not null default '{}'::jsonb;
alter table public.bookings add column if not exists prv_extras_currency text not null default 'EUR';

-- ── 13. Migrasyon: PRV başlangıç saati + süre (2026-08) ──────
-- Tour=PRV seçilince açılan Time (başlangıç saati) ve Duration
-- (toplam saat) alanları.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists prv_start_time time;
alter table public.bookings add column if not exists prv_duration_hours numeric;

-- ── 14. Migrasyon: PRV'de Baby yerine Pier, Transfer PRV Extras'a taşındı (2026-08) ──
-- Tour=PRV seçilince Baby alanı yerine iskele (Pier) seçimi gösterilir;
-- genel Transfer checkbox'ı PRV'de gizlenir, yerine PRV Extras
-- listesinde fiyatlandırılabilen bir "Transfer" kalemi eklendi
-- (prv_extras jsonb içinde saklanır, ayrı kolon gerekmez).
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists prv_pier text;

-- ── 15. Migrasyon: Noshow / Refunded durumu (2026-08) ────────
-- ⚙ ikonundan işaretlenen kalıcı durum: null (normal) | 'noshow' | 'refunded'.
-- Noshow sadece check'lenmemiş kayıtlarda, Refunded her zaman seçilebilir.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists attendance_status text;

-- ── 16. Migrasyon: Unpaid List sayfası (2026-08) ─────────────
-- Tekne üzerinde tahsilat kaydı: yöntem, zaman, kaydeden kullanıcı,
-- teslim edilen kişi/rol, serbest not.
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
alter table public.bookings add column if not exists paid_method    text;
alter table public.bookings add column if not exists paid_at        timestamptz;
alter table public.bookings add column if not exists paid_by        uuid references public.profiles(id);
alter table public.bookings add column if not exists delivered_to   text;
alter table public.bookings add column if not exists unpaid_remarks text;

-- ── 17. Migrasyon: Alcohol Sales sayfası (2026-09) ───────────
-- Misafir listesinden bağımsız, tekne üzerinde satılan alkol
-- (bardak/şişe) kayıtları. Kalemler (isim/adet/birim fiyat) tek bir
-- JSONB kolonunda tutulur (bookings.prv_extras ile aynı desen);
-- ödeme akışı Unpaid List ile aynı (paid_method/paid_at/paid_by/
-- delivered_to). `sold_by` satışı giren kullanıcıdır — liste
-- görünürlüğü bununla filtrelenir (manager hepsini görür).
-- Mevcut veritabanında SQL Editor'da bir kez çalıştırın:
create table if not exists public.alcohol_sales (
  id            uuid primary key default gen_random_uuid(),
  tour_id       uuid not null references public.tours(id) on delete cascade,
  tour_code     text not null default '',
  yacht         text not null default '',
  items         jsonb not null default '[]'::jsonb,
  currency      text not null default 'TRY',
  amount        numeric not null default 0,
  remarks       text not null default '',
  paid_method   text,
  paid_at       timestamptz,
  paid_by       uuid references public.profiles(id),
  delivered_to  text,
  sold_by       uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
alter table public.alcohol_sales enable row level security;
create policy "as_select" on public.alcohol_sales for select using (auth.role()='authenticated');
create policy "as_insert" on public.alcohol_sales for insert with check (auth.role()='authenticated');
create policy "as_update" on public.alcohol_sales for update using (auth.role()='authenticated');
create policy "as_delete" on public.alcohol_sales for delete using (auth.role()='authenticated');
