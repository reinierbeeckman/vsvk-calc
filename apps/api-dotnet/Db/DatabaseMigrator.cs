using Npgsql;

namespace Vsvk.Api.Db;

/// <summary>
/// Minimal "migration" runner for local/dev.
/// In staging/production replace this with a proper migration tool (Flyway/liquibase/EF migrations).
/// </summary>
public sealed class DatabaseMigrator
{
  private readonly NpgsqlDataSource _dataSource;

  public DatabaseMigrator(NpgsqlDataSource dataSource)
  {
    _dataSource = dataSource;
  }

  public async Task MigrateAsync(CancellationToken cancellationToken = default)
  {
    const string sql = """
create extension if not exists pgcrypto;

create table if not exists stamdata (
  code text primary key,
  name text not null
);

insert into stamdata(code, name) values
  ('MAT', 'Materialen'),
  ('ARB', 'Arbeid')
on conflict (code) do nothing;

-- === Calculatie opslag (MVP) ===

create table if not exists calc_counters (
  jaar int primary key,
  last_seq int not null
);

create table if not exists calculaties (
  nummer text primary key,
  jaar int not null,
  seq int not null,
  projectnaam text not null,
  klant text not null,
  datum date null,
  door text not null,
  vestiging text not null,
  status text not null,
  bedrag_snapshot numeric(14,2) not null,
  subtotal_snapshot numeric(14,2) not null default 0,
  btw_rate_snapshot numeric(8,4) not null default 0,
  btw_amount_snapshot numeric(14,2) not null default 0,
  total_snapshot numeric(14,2) not null default 0,
  data jsonb not null,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_sub text null,
  updated_by_sub text null,
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  unique(jaar, seq)
);

create index if not exists ix_calculaties_jaar_seq on calculaties(jaar, seq);
create index if not exists ix_calculaties_updated_at on calculaties(updated_at);
create index if not exists ix_calculaties_vestiging on calculaties(vestiging);

alter table calculaties add column if not exists subtotal_snapshot numeric(14,2) not null default 0;
alter table calculaties add column if not exists btw_rate_snapshot numeric(8,4) not null default 0;
alter table calculaties add column if not exists btw_amount_snapshot numeric(14,2) not null default 0;
alter table calculaties add column if not exists total_snapshot numeric(14,2) not null default 0;

create table if not exists calculatie_artikelen (
  id bigserial primary key,
  calculatie_nummer text not null references calculaties(nummer) on delete cascade,
  line_id text null,
  artikel_naam text not null,
  categorie text null,
  aantal numeric(14,4) null,
  dagen numeric(14,4) null,
  uren numeric(14,4) null,
  toeslag numeric(14,4) null,
  eenheidsprijs numeric(14,4) null,
  regel_totaal numeric(14,2) null,
  created_at timestamptz not null default now()
);

create index if not exists ix_calculatie_artikelen_nummer on calculatie_artikelen(calculatie_nummer);
create index if not exists ix_calculatie_artikelen_naam on calculatie_artikelen(artikel_naam);

create table if not exists instellingen_algemeen (
  id int primary key,
  data jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_sub text null
);

alter table instellingen_algemeen
  add column if not exists systeem_naam text not null default '';

insert into instellingen_algemeen(id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;

create table if not exists vestigingen (
  id uuid primary key,
  naam text not null,
  adres text not null,
  postcode text not null,
  plaats text not null,
  telefoon text not null,
  email text not null,
  kvk_nummer text not null,
  btw_nummer text not null,
  iban text not null
);

alter table vestigingen
  add column if not exists instellingen_algemeen_id int not null default 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_vestigingen_instellingen_algemeen'
      and conrelid = 'vestigingen'::regclass
  ) then
    alter table vestigingen
      add constraint fk_vestigingen_instellingen_algemeen
      foreign key (instellingen_algemeen_id)
      references instellingen_algemeen(id)
      on delete cascade;
  end if;
end $$;

create index if not exists ix_vestigingen_instellingen_algemeen_id
  on vestigingen(instellingen_algemeen_id);

insert into vestigingen (
  id,
  naam,
  adres,
  postcode,
  plaats,
  telefoon,
  email,
  kvk_nummer,
  btw_nummer,
  iban
)
select
  coalesce(
    nullif(v->>'id', '')::uuid,
    (
      substr(md5(coalesce(v->>'naam', '') || '|' || coalesce(v->>'adres', '') || '|' || coalesce(v->>'pc', '')), 1, 8)
      || '-'
      || substr(md5(coalesce(v->>'naam', '') || '|' || coalesce(v->>'adres', '') || '|' || coalesce(v->>'pc', '')), 9, 4)
      || '-'
      || substr(md5(coalesce(v->>'naam', '') || '|' || coalesce(v->>'adres', '') || '|' || coalesce(v->>'pc', '')), 13, 4)
      || '-'
      || substr(md5(coalesce(v->>'naam', '') || '|' || coalesce(v->>'adres', '') || '|' || coalesce(v->>'pc', '')), 17, 4)
      || '-'
      || substr(md5(coalesce(v->>'naam', '') || '|' || coalesce(v->>'adres', '') || '|' || coalesce(v->>'pc', '')), 21, 12)
    )::uuid
  ),
  coalesce(v->>'naam', ''),
  coalesce(v->>'adres', ''),
  coalesce(v->>'pc', ''),
  coalesce(v->>'plaats', ''),
  coalesce(v->>'tel', ''),
  coalesce(v->>'email', ''),
  coalesce(v->>'kvk', ''),
  coalesce(v->>'btw', ''),
  coalesce(v->>'iban', '')
from instellingen_algemeen i
cross join lateral jsonb_array_elements(coalesce(i.data->'vestigingen', '[]'::jsonb)) as v
where i.id = 1
  and not exists (select 1 from vestigingen);

with ranked_vestigingen as (
  select
    id,
    row_number() over (
      partition by
        instellingen_algemeen_id,
        naam,
        adres,
        postcode,
        plaats,
        telefoon,
        email,
        kvk_nummer,
        btw_nummer,
        iban
      order by id
    ) as duplicate_number
  from vestigingen
)
delete from vestigingen v
using ranked_vestigingen ranked
where v.id = ranked.id
  and ranked.duplicate_number > 1;

insert into vestigingen (
  id,
  naam,
  adres,
  postcode,
  plaats,
  telefoon,
  email,
  kvk_nummer,
  btw_nummer,
  iban
)
select seed.id, seed.naam, seed.adres, seed.postcode, seed.plaats, seed.telefoon,
       seed.email, seed.kvk_nummer, seed.btw_nummer, seed.iban
from (values
  ('10000000-0000-0000-0000-000000000001'::uuid, 'VSVK Pijnacker BV', 'Schouwweg 4', '2642 AK', 'Pijnacker', '085-0491729', 'administratie@pijnacker.vsvk.nl', '55442579', 'NL851714365B01', 'NL86 INGB 0006 8116 55'),
  ('10000000-0000-0000-0000-000000000002'::uuid, 'VSVK Rilland BV', 'Poort 69', '4411 PB', 'Rilland', '085-0491729', 'administratie@rilland.vsvk.nl', '20127088', 'NL822170425B01', 'NL03 INGB 0008 0954 89'),
  ('10000000-0000-0000-0000-000000000003'::uuid, 'VSVK Wamel BV', 'Sterkeburg 1', '6659 AM', 'Wamel', '085-0491729', 'administratie@wamel.vsvk.nl', '52611930', 'NL850520836B01', 'NL08 INGB 0793 9988 08')
) as seed(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban)
where not exists (
  select 1
  from vestigingen existing
  where existing.instellingen_algemeen_id = 1
    and lower(btrim(existing.kvk_nummer)) = lower(btrim(seed.kvk_nummer))
)
on conflict (id) do nothing;

update instellingen_algemeen
set
  data = coalesce(data, '{}'::jsonb) - 'vestigingen',
  version = version + 1,
  updated_at = now()
where id = 1
  and coalesce(data, '{}'::jsonb) ? 'vestigingen';
""";

    await using var cmd = _dataSource.CreateCommand(sql);
    await cmd.ExecuteNonQueryAsync(cancellationToken);
  }
}
