using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed record InstellingenAlgemeenStorageRecord(long Version, JsonElement Data, DateTimeOffset UpdatedAt);

public sealed class InstellingenRepository
{
  private readonly NpgsqlDataSource _dataSource;
  private readonly VsvkDbContext _context;

  public InstellingenRepository(NpgsqlDataSource dataSource, VsvkDbContext context)
  {
    _dataSource = dataSource;
    _context = context;
  }

  public Task<InstellingenAlgemeenDto?> GetAlgemeenAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
  {
    var projection = InstellingenProjections.GetProjectionForUser(user);

    return _context.InstellingenAlgemeen
      .AsNoTracking()
      .Where(instellingen => instellingen.Id == 1)
      .Select(projection)
      .FirstOrDefaultAsync(cancellationToken);
  }

  public async Task<InstellingenAlgemeenStorageRecord?> PutAsync(JsonElement data, long? expectedVersion, string? updatedBySub, CancellationToken cancellationToken)
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
    return new InstellingenAlgemeenStorageRecord(version, doc.RootElement.Clone(), updatedAt);
  }
}
