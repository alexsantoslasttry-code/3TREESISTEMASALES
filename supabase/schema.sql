-- =====================================================================
-- Sistema V · banco no Supabase (plano gratuito)
-- Cole tudo isto em: Supabase → SQL Editor → New query → Run.
-- Pode rodar de novo sem problema (só cria o que ainda não existe).
-- =====================================================================

-- Registros do sistema (clientes, protocolos, pedidos...). Mesmo formato da prévia.
create table if not exists public.recs (
  id          text primary key,
  tipo        text not null,
  data        jsonb not null,
  atualizado  timestamptz not null default now()
);
create index if not exists recs_tipo_idx on public.recs (tipo);

-- Histórico imutável (trilha de auditoria encadeada por hash).
create table if not exists public.ev (
  id    text primary key,
  ref   text not null,
  n     integer not null,
  em    text not null,
  data  jsonb not null
);
create index if not exists ev_ref_idx on public.ev (ref, n);
create index if not exists ev_em_idx  on public.ev (em desc);

-- Numeração (3TU-2026-000001, CL-000001...).
create table if not exists public.seq (
  chave   text primary key,
  ultimo  integer not null default 0
);

-- Reserva n números de uma vez e devolve o primeiro. Atômico (sem número repetido).
create or replace function public.next_seq(p_chave text, p_n integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  insert into public.seq (chave, ultimo) values (p_chave, p_n)
  on conflict (chave) do update set ultimo = public.seq.ultimo + p_n
  returning ultimo into v;
  return v - p_n + 1;
end $$;

-- Usado só na importação dos dados da prévia: garante que a numeração continue de onde parou.
create or replace function public.ajustar_seq(p_chave text, p_minimo integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v integer;
begin
  insert into public.seq (chave, ultimo) values (p_chave, p_minimo)
  on conflict (chave) do update set ultimo = greatest(public.seq.ultimo, p_minimo)
  returning ultimo into v;
  return v;
end $$;

-- Números de WhatsApp ligados ao sistema (um por linha).
create table if not exists public.wa_numeros (
  phone_number_id  text primary key,          -- "Phone number ID" da Meta
  rotulo           text not null,             -- ex.: "Triuniverse Travel"
  telefone         text,                      -- ex.: +353 89 264 3202
  unidade_id       text,                      -- id da unidade no Sistema V (opcional)
  ativo            boolean not null default true,
  auto_resposta    text                       -- mensagem automática; {protocolo} vira o número
);

-- ---------- Segurança: só usuários logados acessam ----------
alter table public.recs       enable row level security;
alter table public.ev         enable row level security;
alter table public.seq        enable row level security;
alter table public.wa_numeros enable row level security;

drop policy if exists "equipe le e grava recs" on public.recs;
create policy "equipe le e grava recs" on public.recs
  for all to authenticated using (true) with check (true);

drop policy if exists "equipe le e grava ev" on public.ev;
create policy "equipe le e grava ev" on public.ev
  for select to authenticated using (true);
drop policy if exists "equipe acrescenta ev" on public.ev;
create policy "equipe acrescenta ev" on public.ev
  for insert to authenticated with check (true);
-- (sem update/delete no histórico: ele é imutável)

drop policy if exists "equipe le seq" on public.seq;
create policy "equipe le seq" on public.seq
  for select to authenticated using (true);

drop policy if exists "equipe le numeros" on public.wa_numeros;
create policy "equipe le numeros" on public.wa_numeros
  for select to authenticated using (true);

revoke all on function public.next_seq(text, integer) from public, anon;
grant execute on function public.next_seq(text, integer) to authenticated, service_role;
revoke all on function public.ajustar_seq(text, integer) from public, anon;
grant execute on function public.ajustar_seq(text, integer) to authenticated, service_role;

-- Atualização em tempo real (mensagem nova aparece sem recarregar).
do $$ begin
  alter publication supabase_realtime add table public.recs;
exception when duplicate_object then null; end $$;
