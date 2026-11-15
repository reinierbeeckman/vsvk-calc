using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Db;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningMigrationTests
{
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
