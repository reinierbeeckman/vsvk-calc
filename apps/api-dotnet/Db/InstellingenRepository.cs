using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Vsvk.Api.Db;

public sealed record InstellingenAlgemeen(long Version, JsonElement Data, DateTimeOffset UpdatedAt);

public sealed class InstellingenRepository
{
  private readonly NpgsqlDataSource _dataSource;

  public InstellingenRepository(NpgsqlDataSource dataSource)
  {
    _dataSource = dataSource;
  }

  public async Task<InstellingenAlgemeen?> GetAsync(CancellationToken cancellationToken)
  {
    const string sql = @"
select data::text, version, updated_at
from instellingen_algemeen
where id = 1;
";

    await using var cmd = _dataSource.CreateCommand(sql);
    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    var json = reader.GetString(0);
    var version = reader.GetInt64(1);
    var updatedAt = reader.GetFieldValue<DateTimeOffset>(2);

    using var doc = JsonDocument.Parse(json);
    return new InstellingenAlgemeen(version, doc.RootElement.Clone(), updatedAt);
  }

  public async Task<InstellingenAlgemeen?> PutAsync(JsonElement data, long? expectedVersion, string? updatedBySub, CancellationToken cancellationToken)
  {
    const string sqlWithCheck = @"
update instellingen_algemeen
set
  data = $1,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $2
where id = 1
  and version = $3
returning data::text, version, updated_at;
";

    const string sqlNoCheck = @"
update instellingen_algemeen
set
  data = $1,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $2
where id = 1
returning data::text, version, updated_at;
";

    await using var cmd = _dataSource.CreateCommand(expectedVersion is null ? sqlNoCheck : sqlWithCheck);

    var json = JsonSerializer.Serialize(data);
    cmd.Parameters.AddWithValue(NpgsqlDbType.Jsonb, json);
    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)updatedBySub ?? DBNull.Value);
    if (expectedVersion is not null)
    {
      cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, expectedVersion.Value);
    }

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    var newJson = reader.GetString(0);
    var version = reader.GetInt64(1);
    var updatedAt = reader.GetFieldValue<DateTimeOffset>(2);

    using var doc = JsonDocument.Parse(newJson);
    return new InstellingenAlgemeen(version, doc.RootElement.Clone(), updatedAt);
  }
}
