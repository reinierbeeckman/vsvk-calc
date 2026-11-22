using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;

namespace Vsvk.Api.Db;

public sealed class PlanningWorkOrderNumberAllocator(VsvkDbContext context)
{
  public async Task<string> AllocateAsync(CancellationToken cancellationToken)
  {
    var connection = (NpgsqlConnection)context.Database.GetDbConnection();
    var openedHere = connection.State != System.Data.ConnectionState.Open;
    if (openedHere) await connection.OpenAsync(cancellationToken);
    try
    {
      var transaction = context.Database.CurrentTransaction?.GetDbTransaction()
        ?? await connection.BeginTransactionAsync(cancellationToken);
      await using var command = connection.CreateCommand();
      command.Transaction = (NpgsqlTransaction)transaction;
      command.CommandText = """
        insert into werkopdracht_teller(id, last_seq) values (1, 0)
        on conflict (id) do nothing;

        with existing as (
          select coalesce(max((regexp_match(nummer, '^WO-(?:[0-9]{2}|[0-9]{4})-([0-9]+)$'))[1]::integer), 0) as seq
          from werkopdrachten
        )
        update werkopdracht_teller
        set last_seq = greatest(last_seq, (select seq from existing)) + 1
        where id = 1
        returning last_seq;
        """;
      var value = Convert.ToInt32(await command.ExecuteScalarAsync(cancellationToken));
      var zone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam");
      var year = TimeZoneInfo.ConvertTime(DateTimeOffset.UtcNow, zone).ToString("yy");
      return $"WO-{year}-{value:D4}";
    }
    finally
    {
      if (openedHere) await connection.CloseAsync();
    }
  }
}
