using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Db;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningMigrationTests
{
  [Fact]
  public async Task Customer_tables_are_created_and_existing_data_is_preserved()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await using (var existing = source.CreateCommand("""
      create table klanten (
        id serial primary key, aan boolean not null default true,
        debiteurnummer varchar(50) unique not null, bedrijfsnaam varchar(255) not null,
        kvk_nummer varchar(20), btw_nummer varchar(30), website varchar(255),
        telefoon_algemeen varchar(50), email_algemeen varchar(255), straat varchar(255),
        huisnummer varchar(20), toevoeging varchar(20), postcode varchar(10), plaats varchar(100),
        land varchar(100) default 'Nederland', factuur_email varchar(255),
        afwijkend_factuuradres boolean not null default false, vaste_referentie varchar(100),
        g_rekening_percentage numeric(5,2) default 0.00, factureren_per varchar(50),
        btw_verlegd boolean not null default false, mandagenregister_meesturen boolean not null default false,
        opmerkingen text, aangemaakt_op timestamptz default current_timestamp);
      insert into klanten(debiteurnummer, bedrijfsnaam) values ('K1', 'Bestaande klant');
      create table klant_contactpersonen (
        id serial primary key, klant_id integer not null references klanten(id) on delete cascade,
        is_standaard_besteller boolean not null default false, naam varchar(255) not null,
        functie varchar(100), telefoon varchar(50), email varchar(255),
        aangemaakt_op timestamptz default current_timestamp);
      create unique index idx_unieke_standaard_besteller on klant_contactpersonen(klant_id)
        where is_standaard_besteller = true;
      create table klant_afwijkende_tarieven (
        id serial primary key, klant_id integer not null references klanten(id) on delete cascade,
        omschrijving varchar(255) not null, tarief numeric(10,2) not null, eenheid varchar(50),
        aangemaakt_op timestamptz default current_timestamp);
      insert into klant_contactpersonen(klant_id, naam, is_standaard_besteller) values (1, 'Bestaande contactpersoon', true);
      insert into klant_afwijkende_tarieven(klant_id, omschrijving, tarief) values (1, 'Bestaand tarief', 75.00);
      """)) await existing.ExecuteNonQueryAsync();

    var migrator = new DatabaseMigrator(source);
    await migrator.MigrateAsync();
    await migrator.MigrateAsync();
    await using var query = source.CreateCommand("""
      select (select count(*) from klanten where debiteurnummer = 'K1'),
             to_regclass('klant_contactpersonen') is not null,
             to_regclass('klant_afwijkende_tarieven') is not null,
             to_regclass('idx_unieke_standaard_besteller') is not null,
             (select count(*) from klant_contactpersonen where naam = 'Bestaande contactpersoon'),
             (select count(*) from klant_afwijkende_tarieven where omschrijving = 'Bestaand tarief'),
             (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'klanten' and column_name = 'iban' and character_maximum_length = 50)
      """);
    await using var reader = await query.ExecuteReaderAsync();
    Assert.True(await reader.ReadAsync());
    Assert.Equal(1, reader.GetInt64(0));
    Assert.True(reader.GetBoolean(1));
    Assert.True(reader.GetBoolean(2));
    Assert.True(reader.GetBoolean(3));
    Assert.Equal(1, reader.GetInt64(4));
    Assert.Equal(1, reader.GetInt64(5));
    Assert.Equal(1, reader.GetInt64(6));
  }

  [Fact]
  public async Task Customer_iban_migration_preserves_existing_values()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    var migrator = new DatabaseMigrator(source);
    await migrator.MigrateAsync();
    await using (var insert = source.CreateCommand("insert into klanten (debiteurnummer, bedrijfsnaam, iban) values ('K1', 'Klant', 'NL91ABNA0417164300')"))
      await insert.ExecuteNonQueryAsync();
    await migrator.MigrateAsync();
    await using var query = source.CreateCommand("select iban from klanten where debiteurnummer = 'K1'");
    Assert.Equal("NL91ABNA0417164300", await query.ExecuteScalarAsync());
  }

  [Fact]
  public async Task Employee_active_migration_is_repeatable_and_preserves_new_status()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    var migrator = new DatabaseMigrator(source);
    await migrator.MigrateAsync();
    var subject = Guid.NewGuid();
    await using (var insert = source.CreateCommand("insert into user_information(keycloak_sub, is_active) values ($1, false)"))
    {
      insert.Parameters.AddWithValue(subject);
      await insert.ExecuteNonQueryAsync();
    }
    await using (var marker = source.CreateCommand("delete from vsvk_schema_migrations where migration_id = '20261115_planning_employee_active_v1'"))
    {
      await marker.ExecuteNonQueryAsync();
    }
    await migrator.MigrateAsync();
    await migrator.MigrateAsync();
    await using var query = source.CreateCommand("select is_active from user_information where keycloak_sub = $1");
    query.Parameters.AddWithValue(subject);
    Assert.Equal(false, await query.ExecuteScalarAsync());
  }
}
