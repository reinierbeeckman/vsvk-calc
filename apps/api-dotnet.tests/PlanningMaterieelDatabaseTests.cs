using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningMaterieelDatabaseTests
{
  [PostgresFact]
  public async Task Concurrent_writes_and_invalid_references_leave_only_one_complete_update()
  {
    var connectionString = Environment.GetEnvironmentVariable("VSVK_TEST_POSTGRES")!;
    var schema = "materieel_test_" + Guid.NewGuid().ToString("N");
    await using var admin = new NpgsqlConnection(connectionString);
    await admin.OpenAsync();
    await using (var setup = new NpgsqlCommand($"create schema {schema}", admin)) await setup.ExecuteNonQueryAsync();
    try
    {
      var scopedConnection = new NpgsqlConnectionStringBuilder(connectionString) { SearchPath = schema }.ConnectionString;
      await using var source = NpgsqlDataSource.Create(scopedConnection);
      var itemId = Guid.NewGuid(); var groupId = Guid.NewGuid(); var branchId = Guid.NewGuid();
      await using (var seed = source.CreateCommand("""
        create table vestigingen (id uuid primary key, naam text not null);
        create table materieelgroep (id uuid primary key, omschrijving text not null, version bigint not null default 1);
        create table materieel (id uuid primary key, omschrijving text, kenteken text, merk text, zoeknaam text,
          serienummer text, standplaats_id uuid references vestigingen(id),
          materieelgroep_id uuid references materieelgroep(id), version bigint not null default 1);
        """)) await seed.ExecuteNonQueryAsync();
      await using (var seed = source.CreateCommand("insert into vestigingen(id, naam) values ($1, 'Vestiging')"))
      { seed.Parameters.AddWithValue(branchId); await seed.ExecuteNonQueryAsync(); }
      await using (var seed = source.CreateCommand("insert into materieelgroep(id, omschrijving) values ($1, 'Groep')"))
      { seed.Parameters.AddWithValue(groupId); await seed.ExecuteNonQueryAsync(); }
      await using (var seed = source.CreateCommand("insert into materieel(id, omschrijving, kenteken, standplaats_id, materieelgroep_id) values ($1, 'Origineel', 'OUD', $2, $3)"))
      { seed.Parameters.AddWithValue(itemId); seed.Parameters.AddWithValue(branchId); seed.Parameters.AddWithValue(groupId); await seed.ExecuteNonQueryAsync(); }
      var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(scopedConnection).Options;
      await using var firstContext = new VsvkDbContext(options);
      await using var secondContext = new VsvkDbContext(options);
      var first = new PlanningMaterieelMutationRepository(firstContext);
      var second = new PlanningMaterieelMutationRepository(secondContext);
      var invalid = await first.SaveAsync(itemId, 1, new("Fout", "FOUT", null, null, null, Guid.NewGuid(), groupId), CancellationToken.None);
      Assert.True(invalid.Invalid);
      var original = await first.GetAsync(itemId, CancellationToken.None);
      Assert.Equal(1, original!.Version); Assert.Equal("Origineel", original.Omschrijving); Assert.Equal("OUD", original.Kenteken);
      var results = await Task.WhenAll(
        first.SaveAsync(itemId, 1, new("Eerste", "EEN", null, null, null, branchId, groupId), CancellationToken.None),
        second.SaveAsync(itemId, 1, new("Tweede", "TWEE", null, null, null, branchId, groupId), CancellationToken.None));
      var winner = Assert.Single(results, result => result.Materieel is not null).Materieel!;
      Assert.Single(results, result => result.Materieel is null && !result.Invalid);
      var current = await first.GetAsync(itemId, CancellationToken.None);
      Assert.Equal(2, current!.Version); Assert.Equal(winner.Omschrijving, current.Omschrijving); Assert.Equal(winner.Kenteken, current.Kenteken);
      Assert.Equal(branchId, current.StandplaatsId); Assert.Equal(groupId, current.MaterieelGroepId);
    }
    finally
    {
      await using var cleanup = new NpgsqlCommand($"drop schema {schema} cascade", admin);
      await cleanup.ExecuteNonQueryAsync();
    }
  }
}

public sealed class PostgresFactAttribute : FactAttribute
{
  public PostgresFactAttribute()
  {
    if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VSVK_TEST_POSTGRES")))
      Skip = "Set VSVK_TEST_POSTGRES to a disposable PostgreSQL database to run this test without Docker.";
  }
}
