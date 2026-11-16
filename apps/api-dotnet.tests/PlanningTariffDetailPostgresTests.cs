using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Db;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningTariffDetailPostgresTests
{
  private static string MigrationPath([System.Runtime.CompilerServices.CallerFilePath] string file = "") =>
    Path.GetFullPath(Path.Combine(Path.GetDirectoryName(file)!, "../api-dotnet/Db/PlanningTariffDetailMigration.sql"));

  [LocalPostgresFact]
  public async Task Shared_function_and_price_updates_conflict_and_rollback_atomically()
  {
    var connection = Environment.GetEnvironmentVariable("VSVK_TARIFF_TEST_POSTGRES")!;
    var schema = "tariff_test_" + Guid.NewGuid().ToString("N");
    await using var admin = new NpgsqlConnection(connection);
    await admin.OpenAsync();
    await using (var create = new NpgsqlCommand($"create schema {schema}", admin)) await create.ExecuteNonQueryAsync();
    try
    {
      var scoped = new NpgsqlConnectionStringBuilder(connection) { SearchPath = schema }.ConnectionString;
      await using var setup = new NpgsqlConnection(scoped);
      await setup.OpenAsync();
      await using (var command = new NpgsqlCommand("""
        create table functies(id integer primary key, naam varchar(255) not null check (naam <> 'Terugrollen'), aan boolean not null, toelichting text);
        create table standaard_tarieven(id integer primary key, functie_id integer not null references functies(id), prijs numeric(10,2) not null, eenheid varchar(50) not null, geldig_vanaf date not null, version bigint not null default 1);
        insert into functies values (1, 'Grondwerker', true, null);
        insert into standaard_tarieven values (1, 1, 50, 'uur', '2025-01-01', 1), (2, 1, 60, 'uur', '2025-01-01', 1);
        """, setup)) await command.ExecuteNonQueryAsync();
      var migration = await File.ReadAllTextAsync(MigrationPath());
      await using (var command = new NpgsqlCommand(migration, setup)) { await command.ExecuteNonQueryAsync(); await command.ExecuteNonQueryAsync(); }
      var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(scoped).Options;
      await using var one = new VsvkDbContext(options);
      await using var two = new VsvkDbContext(options);
      var details = new PlanningTariffDetailService(one);
      var prices = new PlanningRepository(two);
      var initial = (await details.GetAsync(1, default))!;
      var sibling = (await details.GetAsync(2, default))!;
      Assert.Equal(1, initial.Version);
      var saved = await details.SaveAsync(1, initial.Version, new("Machinist", false, 52m, "dag", new DateOnly(2026, 1, 1)), default);
      Assert.NotNull(saved);
      Assert.Equal(52m, saved!.Prijs);
      Assert.Equal(52m, (await prices.GetStandardPriceAsync(1, default))!.Prijs);
      Assert.Null(await prices.SaveStandardPriceAsync(1, initial.Version, 99, default));
      Assert.Null(await prices.SaveStandardPriceAsync(2, sibling.Version, 99, default));
      var siblingAfter = (await details.GetAsync(2, default))!;
      Assert.Equal("Machinist", siblingAfter.Functie);
      Assert.True(siblingAfter.Version > sibling.Version);
      var price = await prices.SaveStandardPriceAsync(1, saved!.Version, 75, default);
      Assert.NotNull(price);
      Assert.Null(await details.SaveAsync(1, saved.Version, new("Verouderd", true, 30m, "uur", new DateOnly(2026, 2, 1)), default));
      var current = (await details.GetAsync(1, default))!;
      Assert.Equal(75, current.Prijs);
      Assert.Equal("Machinist", current.Functie);
      await Assert.ThrowsAnyAsync<Exception>(() => details.SaveAsync(1, current.Version, new("Terugrollen", true, 33m, "dag", new DateOnly(2027, 1, 1)), default));
      var after = (await details.GetAsync(1, default))!;
      Assert.Equal(current, after);
      Assert.Equal(siblingAfter.Version, (await details.GetAsync(2, default))!.Version);
      // Independent contexts represent two clients racing with the same version.
      await using var racingOne = new VsvkDbContext(options);
      await using var racingTwo = new VsvkDbContext(options);
      var startingVersion = after.Version;
      var detailRace = new PlanningTariffDetailService(racingOne).SaveAsync(1, startingVersion,
        new("Machinist", false, 75m, "week", new DateOnly(2026, 3, 1)), default);
      var priceRace = new PlanningRepository(racingTwo).SaveStandardPriceAsync(1, startingVersion, 88, default);
      await Task.WhenAll(detailRace, priceRace);
      Assert.NotEqual(detailRace.Result is null, priceRace.Result is null);
      var raced = (await details.GetAsync(1, default))!;
      Assert.True((raced.Eenheid == "week" && raced.Prijs == 75) || (raced.Eenheid == "dag" && raced.Prijs == 88));
    }
    finally
    {
      await using var drop = new NpgsqlCommand($"drop schema {schema} cascade", admin);
      await drop.ExecuteNonQueryAsync();
    }
  }
}

public sealed class LocalPostgresFactAttribute : FactAttribute
{
  public LocalPostgresFactAttribute()
  {
    if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VSVK_TARIFF_TEST_POSTGRES")))
      Skip = "Set VSVK_TARIFF_TEST_POSTGRES to a disposable local PostgreSQL database; Docker is not used.";
  }
}





