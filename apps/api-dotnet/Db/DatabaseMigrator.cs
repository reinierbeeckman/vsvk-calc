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
    const string sql = @"
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

create table if not exists instellingen_algemeen (
  id int primary key,
  data jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now(),
  updated_by_sub text null
);

insert into instellingen_algemeen(id, data) values (1, '{}'::jsonb)
on conflict (id) do nothing;
";

    await using var cmd = _dataSource.CreateCommand(sql);
    await cmd.ExecuteNonQueryAsync(cancellationToken);
  }
}
