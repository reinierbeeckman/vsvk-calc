create table if not exists werkopdrachten (
  id uuid primary key default gen_random_uuid(),
  nummer varchar(50) not null unique,
  klant_id integer not null references klanten(id) on delete restrict,
  omschrijving varchar(500) not null,
  start_datum date not null,
  eind_datum date not null,
  is_optie boolean not null default false,
  kleur varchar(20) not null default '#2f8a5b',
  version bigint not null default 1,
  constraint ck_werkopdrachten_datum check (eind_datum >= start_datum)
);
create index if not exists ix_werkopdrachten_periode on werkopdrachten(start_datum, eind_datum);
alter table werkopdrachten add column if not exists optie_tot date;
alter table werkopdrachten add column if not exists vestiging_id uuid references vestigingen(id) on delete restrict;
alter table werkopdrachten add column if not exists geannuleerd boolean not null default false;
alter table werkopdrachten add column if not exists voorraad boolean not null default false;
create index if not exists ix_werkopdrachten_vestiging on werkopdrachten(vestiging_id);

create table if not exists klussen (
  id uuid primary key default gen_random_uuid(),
  werkopdracht_id uuid not null references werkopdrachten(id) on delete cascade,
  omschrijving varchar(500) not null,
  start_datum date not null,
  eind_datum date not null,
  benodigde_medewerkers integer not null default 1,
  start_tijd time,
  eind_tijd time,
  sorteervolgorde integer not null default 0,
  constraint ck_klussen_datum check (eind_datum >= start_datum),
  constraint ck_klussen_benodigd check (benodigde_medewerkers > 0)
);
create index if not exists ix_klussen_werkopdracht_sorteer on klussen(werkopdracht_id, sorteervolgorde);
alter table klussen add column if not exists datum date;
alter table klussen add column if not exists reis_heen interval;
alter table klussen add column if not exists reis_terug interval;

create table if not exists klus_behoeften (
  id uuid primary key default gen_random_uuid(),
  klus_id uuid not null references klussen(id) on delete cascade,
  aantal integer not null,
  rol varchar(200),
  skill varchar(200),
  constraint ck_klus_behoeften_aantal check (aantal > 0)
);
create index if not exists ix_klus_behoeften_klus_id on klus_behoeften(klus_id);

create table if not exists inhuurmedewerkers (
  id uuid primary key default gen_random_uuid(),
  leverancier_id integer not null references leveranciers(id) on delete restrict,
  naam varchar(255) not null,
  functie varchar(200),
  telefoon varchar(50),
  email varchar(255),
  actief boolean not null default true,
  version bigint not null default 1,
  constraint ck_inhuurmedewerkers_naam check (btrim(naam) <> '')
);
create index if not exists ix_inhuurmedewerkers_leverancier_naam on inhuurmedewerkers(leverancier_id, naam);

create table if not exists inzet (
  id uuid primary key default gen_random_uuid(),
  klus_id uuid not null references klussen(id) on delete cascade,
  datum date not null,
  medewerker_id uuid references user_information(keycloak_sub) on delete restrict,
  inhuurmedewerker_id uuid references inhuurmedewerkers(id) on delete restrict,
  start_tijd time,
  eind_tijd time,
  constraint ck_inzet_resource check (
    (medewerker_id is not null and inhuurmedewerker_id is null) or
    (medewerker_id is null and inhuurmedewerker_id is not null))
);
create index if not exists ix_inzet_klus_datum on inzet(klus_id, datum);
create index if not exists ix_inzet_medewerker_datum on inzet(medewerker_id, datum);
create index if not exists ix_inzet_inhuurmedewerker_datum on inzet(inhuurmedewerker_id, datum);
create unique index if not exists ux_inzet_intern on inzet(klus_id, datum, medewerker_id)
  where medewerker_id is not null;
create unique index if not exists ux_inzet_inhuur on inzet(klus_id, datum, inhuurmedewerker_id)
  where inhuurmedewerker_id is not null;
drop index if exists ux_inzet_intern_per_dag;
drop index if exists ux_inzet_inhuur_per_dag;

create table if not exists werkbonnen (
  id uuid primary key default gen_random_uuid(),
  inzet_id uuid not null unique references inzet(id) on delete cascade,
  nummer varchar(50) not null unique,
  status varchar(30) not null,
  gewijzigd_na_uitgifte boolean not null default false,
  uitgereikt_op timestamptz,
  binnen_op timestamptz,
  constraint ck_werkbonnen_status check (status in (
    'niet_geprint', 'aangemaakt', 'uitgereikt', 'retour', 'verwerkt', 'vervallen', 'binnen'))
);
alter table werkbonnen add column if not exists oud_nummer varchar(50);
alter table werkbonnen drop constraint if exists ck_werkbonnen_status;
update werkbonnen set status = 'aangemaakt' where status = 'niet_geprint';
alter table werkbonnen add constraint ck_werkbonnen_status check (status in (
  'aangemaakt', 'uitgereikt', 'retour', 'verwerkt', 'vervallen', 'binnen'));
