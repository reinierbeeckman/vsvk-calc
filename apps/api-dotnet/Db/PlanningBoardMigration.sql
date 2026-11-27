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
create table if not exists werkopdracht_teller (
  id smallint primary key default 1 check (id = 1),
  last_seq integer not null default 0
);
insert into werkopdracht_teller(id, last_seq) values (1, 0) on conflict (id) do nothing;
alter table werkopdrachten add column if not exists optie_tot date;
alter table werkopdrachten add column if not exists vestiging_id uuid references vestigingen(id) on delete restrict;
alter table werkopdrachten add column if not exists geannuleerd boolean not null default false;
alter table werkopdrachten add column if not exists voorraad boolean not null default false;
alter table werkopdrachten add column if not exists soort varchar(20) not null default 'regie';
alter table werkopdrachten add column if not exists intern_projectnummer varchar(100);
alter table werkopdrachten add column if not exists besteller_id integer references klant_contactpersonen(id) on delete set null;
alter table werkopdrachten add column if not exists besteller_naam varchar(255);
alter table werkopdrachten add column if not exists besteller_telefoon varchar(50);
alter table werkopdrachten add column if not exists besteller_email varchar(255);
alter table werkopdrachten add column if not exists optie_reden text;
alter table werkopdrachten add column if not exists weekend_overslaan boolean not null default true;
alter table werkopdrachten add column if not exists geschatte_uren integer;
alter table werkopdrachten add column if not exists uiterlijk_klaar date;
alter table werkopdrachten add column if not exists prioriteit varchar(20) not null default 'normaal';
alter table werkopdrachten add column if not exists korte_werkomschrijving varchar(500);
alter table werkopdrachten add column if not exists werk_inhoud text;
alter table werkopdrachten add column if not exists instructies text;
alter table werkopdrachten add column if not exists werkadres varchar(500);
alter table werkopdrachten add column if not exists werk_postcode varchar(10);
alter table werkopdrachten add column if not exists werk_plaats varchar(100);
alter table werkopdrachten add column if not exists gps_locatie varchar(500);
alter table werkopdrachten add column if not exists contact_locatie_naam varchar(255);
alter table werkopdrachten add column if not exists contact_locatie_telefoon varchar(50);
alter table werkopdrachten add column if not exists start_op_locatie time;
alter table werkopdrachten add column if not exists eind_op_locatie time;
alter table werkopdrachten add column if not exists pauze_minuten integer not null default 30;
alter table werkopdrachten add column if not exists meerdere_diensten boolean not null default false;
do $$ begin
  alter table werkopdrachten add constraint ck_werkopdrachten_soort check (soort in ('regie','aangenomen'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table werkopdrachten add constraint ck_werkopdrachten_prioriteit check (prioriteit in ('hoog','normaal','laag'));
exception when duplicate_object then null;
end $$;
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
alter table klussen add column if not exists pauze_minuten integer not null default 30;
alter table klussen add column if not exists dienst_naam varchar(200);

create table if not exists klus_behoeften (
  id uuid primary key default gen_random_uuid(),
  klus_id uuid not null references klussen(id) on delete cascade,
  aantal integer not null,
  rol varchar(200),
  skill varchar(200),
  constraint ck_klus_behoeften_aantal check (aantal > 0)
);
alter table klus_behoeften add column if not exists materieel_id uuid references materieel(id) on delete restrict;
alter table klus_behoeften add column if not exists materieelgroep_id uuid references materieelgroep(id) on delete restrict;
alter table klus_behoeften add column if not exists losse_verhuur boolean not null default false;
alter table klus_behoeften add column if not exists soort varchar(20) not null default 'mens';
update klus_behoeften
set soort = 'materieel'
where materieel_id is not null or materieelgroep_id is not null;
update klus_behoeften kb
set soort = 'materieel',
    materieelgroep_id = coalesce(kb.materieelgroep_id, mg.id)
from materieelgroep mg
where lower(mg.omschrijving) = lower(kb.rol)
  and (kb.materieel_id is null and kb.materieelgroep_id is null);
with duplicate_needs as (
  select id, row_number() over (
    partition by klus_id, soort, rol, skill, materieel_id, materieelgroep_id, losse_verhuur
    order by aantal desc, id
  ) as position
  from klus_behoeften
)
delete from klus_behoeften kb
using duplicate_needs duplicate
where kb.id = duplicate.id and duplicate.position > 1;
update klussen k
set benodigde_medewerkers = coalesce((
  select sum(kb.aantal) from klus_behoeften kb
  where kb.klus_id = k.id and kb.soort = 'mens'
), 0)
where exists(select 1 from klus_behoeften kb where kb.klus_id = k.id);
do $$ begin
  alter table klus_behoeften add constraint ck_klus_behoeften_soort check (soort in ('mens','materieel'));
exception when duplicate_object then null;
end $$;
create index if not exists ix_klus_behoeften_klus_id on klus_behoeften(klus_id);

create table if not exists werkopdracht_ordernummers (
  id uuid primary key default gen_random_uuid(),
  werkopdracht_id uuid not null references werkopdrachten(id) on delete cascade,
  nummer varchar(100) not null,
  sorteervolgorde integer not null default 0
);
create index if not exists ix_werkopdracht_ordernummers_wo on werkopdracht_ordernummers(werkopdracht_id);

create table if not exists werkopdracht_vrije_dagen (
  werkopdracht_id uuid not null references werkopdrachten(id) on delete cascade,
  datum date not null,
  primary key (werkopdracht_id, datum)
);

create table if not exists werkopdracht_materialen (
  id uuid primary key default gen_random_uuid(),
  werkopdracht_id uuid not null references werkopdrachten(id) on delete cascade,
  aantal numeric(12,2) not null,
  artikel_id uuid references artikelen(id) on delete restrict,
  omschrijving varchar(500),
  eenheid varchar(50),
  constraint ck_werkopdracht_materialen_aantal check (aantal > 0)
);
create index if not exists ix_werkopdracht_materialen_wo on werkopdracht_materialen(werkopdracht_id);

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

create table if not exists klus_materieelinzet (
  id uuid primary key default gen_random_uuid(),
  klus_id uuid not null references klussen(id) on delete cascade,
  datum date not null,
  materieel_id uuid not null references materieel(id) on delete restrict
);
create unique index if not exists ux_klus_materieelinzet on klus_materieelinzet(klus_id, datum, materieel_id);
create index if not exists ix_klus_materieelinzet_materieel_datum on klus_materieelinzet(materieel_id, datum);
alter table klus_materieelinzet add column if not exists medewerker_id uuid
  references user_information(keycloak_sub) on delete set null;

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
