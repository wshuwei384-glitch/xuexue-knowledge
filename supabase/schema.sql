create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_by_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  title text default '',
  content text not null,
  category_id uuid references public.categories(id) on delete set null,
  category_name text not null,
  tags text[] not null default '{}',
  importance text not null default '普通' check (importance in ('普通', '重要', '必背')),
  source_scene text not null default '其他' check (source_scene in ('上课', '门诊', '病房', '组会', '聊天', '文献', '其他')),
  personal_note text default '',
  status text not null default '未复习' check (status in ('未复习', '待复习', '已复习', '已掌握', '需要问老师')),
  created_by_user_id uuid not null references public.users(id) on delete cascade,
  created_by_username text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_edited_by_user_id uuid references public.users(id) on delete set null,
  last_edited_by_username text
);

create table if not exists public.summaries (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete set null,
  category_name text not null unique,
  summary_text text not null default '',
  key_points text[] not null default '{}',
  important_items text[] not null default '{}',
  must_remember_items text[] not null default '{}',
  questions_for_teacher text[] not null default '{}',
  tags text[] not null default '{}',
  item_count integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references public.users(id) on delete set null,
  updated_by_username text
);

insert into public.categories (name)
values ('心内科'), ('中医'), ('科研'), ('论文'), ('CRF'), ('临床经验'), ('药物'), ('检查'), ('杂项')
on conflict (name) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_categories_updated_at on public.categories;
create trigger touch_categories_updated_at
before update on public.categories
for each row execute function public.touch_updated_at();

drop trigger if exists touch_knowledge_items_updated_at on public.knowledge_items;
create trigger touch_knowledge_items_updated_at
before update on public.knowledge_items
for each row execute function public.touch_updated_at();

drop trigger if exists touch_summaries_updated_at on public.summaries;
create trigger touch_summaries_updated_at
before update on public.summaries
for each row execute function public.touch_updated_at();

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(select 1 from public.users where id = uid and role = 'admin');
$$;

alter table public.users enable row level security;
alter table public.categories enable row level security;
alter table public.knowledge_items enable row level security;
alter table public.summaries enable row level security;

drop policy if exists "users can read users" on public.users;
create policy "users can read users" on public.users
for select to authenticated
using (true);

drop policy if exists "users can insert own profile" on public.users;
create policy "users can insert own profile" on public.users
for insert to authenticated
with check (auth.uid() = id);

drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile" on public.users
for update to authenticated
using (auth.uid() = id or public.is_admin(auth.uid()))
with check (auth.uid() = id or public.is_admin(auth.uid()));

drop policy if exists "authenticated can read categories" on public.categories;
create policy "authenticated can read categories" on public.categories
for select to authenticated
using (true);

drop policy if exists "authenticated can create categories" on public.categories;
create policy "authenticated can create categories" on public.categories
for insert to authenticated
with check (true);

drop policy if exists "owners and admins update categories" on public.categories;
create policy "owners and admins update categories" on public.categories
for update to authenticated
using (created_by_user_id = auth.uid() or public.is_admin(auth.uid()))
with check (created_by_user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "admins delete categories" on public.categories;
create policy "admins delete categories" on public.categories
for delete to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists "authenticated can read knowledge" on public.knowledge_items;
create policy "authenticated can read knowledge" on public.knowledge_items
for select to authenticated
using (true);

drop policy if exists "authenticated can create knowledge" on public.knowledge_items;
create policy "authenticated can create knowledge" on public.knowledge_items
for insert to authenticated
with check (created_by_user_id = auth.uid());

drop policy if exists "owners and admins update knowledge" on public.knowledge_items;
create policy "owners and admins update knowledge" on public.knowledge_items
for update to authenticated
using (created_by_user_id = auth.uid() or public.is_admin(auth.uid()))
with check (created_by_user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "owners and admins delete knowledge" on public.knowledge_items;
create policy "owners and admins delete knowledge" on public.knowledge_items
for delete to authenticated
using (created_by_user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "authenticated can read summaries" on public.summaries;
create policy "authenticated can read summaries" on public.summaries
for select to authenticated
using (true);

drop policy if exists "authenticated can create summaries" on public.summaries;
create policy "authenticated can create summaries" on public.summaries
for insert to authenticated
with check (updated_by_user_id = auth.uid());

drop policy if exists "authenticated can update summaries" on public.summaries;
create policy "authenticated can update summaries" on public.summaries
for update to authenticated
using (true)
with check (updated_by_user_id = auth.uid());
