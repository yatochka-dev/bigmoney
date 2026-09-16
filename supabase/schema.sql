-- Big Money Ledger — Supabase schema
-- Run this once in the Supabase SQL Editor for your project.

create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expected_salary_default numeric(14,2) not null default 15500,
  currency text not null default 'ILS',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

create table if not exists public.months (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  expected_salary numeric(14,2) not null default 15500,
  actual_salary numeric(14,2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, month_key)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('need','want','saving')),
  default_budget numeric(14,2) not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  issuer text,
  last4 text,
  billing_day int not null default 10 check (billing_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_date date not null,
  description text not null,
  amount numeric(14,2) not null check (amount >= 0),
  category_id uuid not null references public.categories(id),
  payment_method text not null check (payment_method in ('cash','debit','bank_transfer','credit_card')),
  card_id uuid references public.cards(id) on delete set null,
  installments_count int not null default 1 check (installments_count between 1 and 120),
  first_debit_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  installment_number int not null check (installment_number >= 1),
  due_date date not null,
  amount numeric(14,2) not null check (amount >= 0),
  cleared boolean not null default false,
  created_at timestamptz not null default now(),
  unique(transaction_id, installment_number)
);

create table if not exists public.month_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  month_key text not null check (month_key ~ '^[0-9]{4}-[0-9]{2}$'),
  category_id uuid not null references public.categories(id) on delete cascade,
  amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, month_key, category_id)
);

create index if not exists months_user_month_idx on public.months(user_id, month_key);
create index if not exists tx_user_purchase_idx on public.transactions(user_id, purchase_date);
create index if not exists installments_user_due_idx on public.installments(user_id, due_date);
create index if not exists installments_tx_idx on public.installments(transaction_id);
create index if not exists budgets_user_month_idx on public.month_budgets(user_id, month_key);

alter table public.app_settings enable row level security;
alter table public.months enable row level security;
alter table public.categories enable row level security;
alter table public.cards enable row level security;
alter table public.transactions enable row level security;
alter table public.installments enable row level security;
alter table public.month_budgets enable row level security;

do $$
declare t text;
begin
  foreach t in array array['app_settings','months','categories','cards','transactions','installments','month_budgets'] loop
    execute format('drop policy if exists "owner_all" on public.%I', t);
    execute format('create policy "owner_all" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;
grant select, insert, update, delete on public.months to authenticated;
grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.cards to authenticated;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.installments to authenticated;
grant select, insert, update, delete on public.month_budgets to authenticated;
