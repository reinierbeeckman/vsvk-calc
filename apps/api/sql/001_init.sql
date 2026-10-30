create extension if not exists pgcrypto;

create schema if not exists core;
create schema if not exists catalogus;
create schema if not exists relatie;
create schema if not exists resource;
create schema if not exists prijs;
create schema if not exists sales;
create schema if not exists integratie;
create schema if not exists audit;

create table if not exists core.bedrijf (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  naam text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists core.vestiging (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references core.bedrijf(id),
  code text not null,
  naam text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (bedrijf_id, code)
);

create table if not exists core.bronidentiteit (
  id uuid primary key default gen_random_uuid(),
  bron text not null,
  entiteittype text not null,
  bronscope text not null,
  broncode text not null,
  doel_id uuid not null,
  created_at timestamptz not null default now(),
  unique (bron, entiteittype, bronscope, broncode)
);

create table if not exists catalogus.eenheid (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists catalogus.grootheid (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists catalogus.kostensoort (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists catalogus.artikelgroep (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists catalogus.artikel (
  id uuid primary key default gen_random_uuid(),
  artikelnummer text not null,
  omschrijving text not null,
  korte_omschrijving text,
  selecteerbaar boolean not null default true,
  gebruikseenheid_id uuid references catalogus.eenheid(id),
  prijseenheid_id uuid references catalogus.eenheid(id),
  grootheid_id uuid references catalogus.grootheid(id),
  kostensoort_id uuid references catalogus.kostensoort(id),
  artikelgroep_id uuid references catalogus.artikelgroep(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (artikelnummer)
);

create table if not exists catalogus.artikel_vestiging (
  artikel_id uuid not null references catalogus.artikel(id),
  vestiging_id uuid not null references core.vestiging(id),
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (artikel_id, vestiging_id)
);

create table if not exists resource.materieelobject (
  id uuid primary key default gen_random_uuid(),
  objectcode text not null unique,
  omschrijving text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists resource.materieel_artikel (
  object_id uuid not null references resource.materieelobject(id),
  artikel_id uuid not null references catalogus.artikel(id),
  geldig_van date not null,
  geldig_tot date,
  created_at timestamptz not null default now(),
  primary key (object_id, artikel_id, geldig_van),
  check (geldig_tot is null or geldig_tot >= geldig_van)
);

create table if not exists relatie.organisatie (
  id uuid primary key default gen_random_uuid(),
  naam text not null,
  btw_nummer text,
  handelsregister_nummer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists relatie.prijssoort (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists relatie.debiteur (
  id uuid primary key default gen_random_uuid(),
  organisatie_id uuid not null references relatie.organisatie(id),
  debiteurnummer text not null unique,
  naam text not null,
  straat text,
  postcode text,
  plaats text,
  emailadres text,
  betaaltermijn_dagen integer,
  prijssoort_id uuid references relatie.prijssoort(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists relatie.debiteur_vestiging (
  debiteur_id uuid not null references relatie.debiteur(id),
  vestiging_id uuid not null references core.vestiging(id),
  actief boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (debiteur_id, vestiging_id)
);

create table if not exists resource.medewerker (
  id uuid primary key default gen_random_uuid(),
  medewerkercode text not null unique,
  weergavenaam text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists resource.dienstverband (
  id uuid primary key default gen_random_uuid(),
  medewerker_id uuid not null references resource.medewerker(id),
  vestiging_id uuid not null references core.vestiging(id),
  functie text,
  type text not null,
  fte numeric(9,4),
  geldig_van date not null,
  geldig_tot date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  check (geldig_tot is null or geldig_tot >= geldig_van)
);

create table if not exists resource.kwalificatie (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null
);

create table if not exists resource.medewerker_kwalificatie (
  medewerker_id uuid not null references resource.medewerker(id),
  kwalificatie_id uuid not null references resource.kwalificatie(id),
  geldig_van date not null,
  geldig_tot date,
  bewijs_ref text,
  created_at timestamptz not null default now(),
  primary key (medewerker_id, kwalificatie_id, geldig_van),
  check (geldig_tot is null or geldig_tot >= geldig_van)
);

create table if not exists prijs.prijslijst (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  omschrijving text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists prijs.tariefregel (
  id uuid primary key default gen_random_uuid(),
  prijslijst_id uuid not null references prijs.prijslijst(id),
  artikel_id uuid not null references catalogus.artikel(id),
  bedrijf_id uuid not null references core.bedrijf(id),
  vestiging_id uuid references core.vestiging(id),
  debiteur_id uuid references relatie.debiteur(id),
  tarieftype text not null,
  eenheid_id uuid references catalogus.eenheid(id),
  hoeveelheid_basis numeric(19,6) not null default 1,
  bedrag numeric(19,4) not null,
  valuta char(3) not null default 'EUR',
  geldig_van date not null,
  geldig_tot date,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1,
  check (geldig_tot is null or geldig_tot >= geldig_van)
);

create table if not exists sales.calculatie (
  id uuid primary key default gen_random_uuid(),
  bedrijf_id uuid not null references core.bedrijf(id),
  vestiging_id uuid not null references core.vestiging(id),
  debiteur_id uuid not null references relatie.debiteur(id),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1
);

create table if not exists sales.calculatie_versie (
  id uuid primary key default gen_random_uuid(),
  calculatie_id uuid not null references sales.calculatie(id),
  versienummer integer not null,
  rekenregelversie text not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (calculatie_id, versienummer)
);

create table if not exists sales.calculatieregel (
  id uuid primary key default gen_random_uuid(),
  calculatieversie_id uuid not null references sales.calculatie_versie(id),
  artikel_id uuid not null references catalogus.artikel(id),
  hoeveelheid numeric(19,6) not null,
  eenheid_id uuid references catalogus.eenheid(id),
  tariefregel_id uuid references prijs.tariefregel(id),
  tariefsnapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists sales.offerteversie (
  id uuid primary key default gen_random_uuid(),
  calculatieversie_id uuid not null references sales.calculatie_versie(id),
  offertenummer text not null,
  versienummer integer not null,
  status text not null,
  totaal_excl numeric(19,4) not null,
  totaal_incl numeric(19,4) not null,
  document_id text,
  document_hash text,
  created_at timestamptz not null default now(),
  unique (offertenummer, versienummer)
);

create table if not exists integratie.import_batch (
  id uuid primary key default gen_random_uuid(),
  bron text not null,
  bestand_hash text not null,
  mappingversie text not null,
  status text not null,
  controles jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists integratie.outbox (
  event_id uuid primary key default gen_random_uuid(),
  object_id uuid not null,
  type text not null,
  versie bigint not null,
  payload jsonb not null,
  afleverstatus text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit.gebeurtenis (
  id uuid primary key default gen_random_uuid(),
  tijdstip timestamptz not null default now(),
  actor_id text not null,
  app_id text not null,
  actie text not null,
  object_id text,
  scope jsonb not null,
  resultaat text not null,
  trace_id text not null,
  details jsonb
);

create index if not exists idx_artikel_vestiging_scope on catalogus.artikel_vestiging (vestiging_id, artikel_id);
create index if not exists idx_debiteur_vestiging_scope on relatie.debiteur_vestiging (vestiging_id, debiteur_id);
create index if not exists idx_dienstverband_scope on resource.dienstverband (vestiging_id, medewerker_id);
create index if not exists idx_tariefregel_scope on prijs.tariefregel (bedrijf_id, vestiging_id, artikel_id, geldig_van);
create index if not exists idx_calculatie_scope on sales.calculatie (bedrijf_id, vestiging_id, debiteur_id);

create or replace function core.scope_allows_vestiging(target_vestiging_id uuid)
returns boolean
language sql
stable
as $$
  with branch_ids as (
    select coalesce(
      array_agg(value::uuid),
      array[]::uuid[]
    ) as ids
    from jsonb_array_elements_text(
      coalesce(nullif(current_setting('app.branch_ids', true), '')::jsonb, '[]'::jsonb)
    )
  )
  select target_vestiging_id = any((select ids from branch_ids));
$$;

create or replace function core.scope_allows_bedrijf(target_bedrijf_id uuid)
returns boolean
language sql
stable
as $$
  select target_bedrijf_id::text = nullif(current_setting('app.company_id', true), '');
$$;

alter table core.vestiging enable row level security;
create policy vestiging_scope_policy on core.vestiging
  using (core.scope_allows_bedrijf(bedrijf_id));

alter table catalogus.artikel_vestiging enable row level security;
create policy artikel_vestiging_scope_policy on catalogus.artikel_vestiging
  using (core.scope_allows_vestiging(vestiging_id));

alter table relatie.debiteur_vestiging enable row level security;
create policy debiteur_vestiging_scope_policy on relatie.debiteur_vestiging
  using (core.scope_allows_vestiging(vestiging_id));

alter table resource.dienstverband enable row level security;
create policy dienstverband_scope_policy on resource.dienstverband
  using (core.scope_allows_vestiging(vestiging_id));

alter table prijs.tariefregel enable row level security;
create policy tariefregel_scope_policy on prijs.tariefregel
  using (
    core.scope_allows_bedrijf(bedrijf_id)
    and (vestiging_id is null or core.scope_allows_vestiging(vestiging_id))
  );

alter table sales.calculatie enable row level security;
create policy calculatie_scope_policy on sales.calculatie
  using (
    core.scope_allows_bedrijf(bedrijf_id)
    and core.scope_allows_vestiging(vestiging_id)
  );

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'vsvk_api_runtime') then
    create role vsvk_api_runtime noinherit login;
  end if;
end
$$;

revoke all on schema public from public;
revoke all on schema core, catalogus, relatie, resource, prijs, sales, integratie, audit from public;
revoke all on all tables in schema core, catalogus, relatie, resource, prijs, sales, integratie, audit from public;

grant usage on schema core, catalogus, relatie, resource, prijs, sales, integratie, audit to vsvk_api_runtime;
grant select, insert, update, delete on all tables in schema core, catalogus, relatie, resource, prijs, sales, integratie, audit to vsvk_api_runtime;

alter role vsvk_api_runtime set row_security = on;
