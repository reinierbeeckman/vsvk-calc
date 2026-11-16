using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

// Uses a temporary schema only in a database explicitly supplied for testing; never starts Docker.
public sealed class PlanningEmployeeDevelopmentDatabaseTests
{
  [PlanningDatabaseFact]
  public async Task Aggregate_changes_are_versioned_and_roll_back_together()
  {
    var connectionString = Environment.GetEnvironmentVariable("VSVK_PLANNING_TEST_DB")!;
    var schema = "employee_test_" + Guid.NewGuid().ToString("N");
    await using var admin = new NpgsqlConnection(connectionString);
    await admin.OpenAsync();
    await using (var create = new NpgsqlCommand($"create schema \"{schema}\"", admin)) await create.ExecuteNonQueryAsync();
    try
    {
      var scopedConnection = new NpgsqlConnectionStringBuilder(connectionString) { SearchPath = schema }.ConnectionString;
      await using var connection = new NpgsqlConnection(scopedConnection);
      await connection.OpenAsync();
      await using (var setup = new NpgsqlCommand("""
        create table vestigingen (id uuid primary key, naam text not null);
        create table user_information (keycloak_sub uuid primary key, employee_number text, display_name text, job_title text,
          phone_number text, email_address text, vestiging_id uuid references vestigingen(id), is_active boolean not null default true,
          version bigint not null default 1, updated_at timestamptz not null default now(), created_at timestamptz not null default now());
        create table skills (id uuid primary key, name text not null);
        create table user_skills (keycloak_sub uuid references user_information(keycloak_sub), skill_id uuid references skills(id),
          diploma_on date, valid_until date, primary key(keycloak_sub, skill_id),
          constraint fail_insert_for_test check (diploma_on is distinct from date '2000-01-01'));
        insert into vestigingen values ('22222222-2222-2222-2222-222222222222', 'Noord');
        insert into skills values ('33333333-3333-3333-3333-333333333333', 'VCA');
        insert into user_information(keycloak_sub, display_name) values ('11111111-1111-1111-1111-111111111111', 'Oud');
        """, connection)) await setup.ExecuteNonQueryAsync();
      var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(scopedConnection).Options;
      var id = Guid.Parse("11111111-1111-1111-1111-111111111111");
      await using var firstContext = new VsvkDbContext(options);
      await using var secondContext = new VsvkDbContext(options);
      var first = new PlanningRepository(firstContext);
      var second = new PlanningRepository(secondContext);
      var firstRead = await first.GetEmployeeAsync(id, null, CancellationToken.None);
      var secondRead = await second.GetEmployeeAsync(id, null, CancellationToken.None);
      Assert.Equal(firstRead!.Version, secondRead!.Version);
      var good = new PlanningEmployeeUpdateRequest("42", "Nieuw", "Planner", "123", "a@example.com", "Noord", false, [new("VCA", null, null)]);
      var unknownSkill = await first.SaveAsync(id, 1, good with { Skills = [new("Onbekend", null, null)] }, CancellationToken.None);
      Assert.Equal(PlanningEmployeeUpdateStatus.Invalid, unknownSkill.Status);
      var unknownBranch = await first.SaveAsync(id, 1, good with { Vestiging = "Onbekend" }, CancellationToken.None);
      Assert.Equal(PlanningEmployeeUpdateStatus.Invalid, unknownBranch.Status);
      var saved = await first.SaveAsync(id, firstRead.Version, good, CancellationToken.None);
      Assert.Equal(PlanningEmployeeUpdateStatus.Saved, saved.Status);
      Assert.Equal(2, saved.Employee!.Version);
      Assert.False(saved.Employee.Actief);
      var stale = await second.SaveAsync(id, secondRead.Version, good with { Naam = "Verouderd", Skills = [] }, CancellationToken.None);
      Assert.Equal(PlanningEmployeeUpdateStatus.Conflict, stale.Status);
      var bad = good with { Naam = "Niet opgeslagen", Actief = true, Skills = [new("VCA", new DateOnly(2000, 1, 1), null)] };
      await Assert.ThrowsAsync<DbUpdateException>(() => second.SaveAsync(id, 2, bad, CancellationToken.None));
      await using var verifyContext = new VsvkDbContext(options);
      var persisted = await new PlanningRepository(verifyContext).GetEmployeeAsync(id, null, CancellationToken.None);
      Assert.Equal(2, persisted!.Version);
      Assert.Equal("Nieuw", persisted.Naam);
      Assert.False(persisted.Actief);
      Assert.Equal("VCA", Assert.Single(persisted.Skills).Naam);
      Assert.Null(persisted.Skills[0].DiplomaOp);
    }
    finally
    {
      await using var cleanup = new NpgsqlCommand($"drop schema \"{schema}\" cascade", admin);
      await cleanup.ExecuteNonQueryAsync();
    }
  }
}

public sealed class PlanningDatabaseFactAttribute : FactAttribute
{
  public PlanningDatabaseFactAttribute()
  {
    if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("VSVK_PLANNING_TEST_DB")))
      Skip = "Set VSVK_PLANNING_TEST_DB to a dedicated PostgreSQL test database; Docker is not used.";
  }
}
