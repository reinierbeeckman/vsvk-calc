using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace Vsvk.Api.Db;

public sealed record CalculatieRecord(
  string Nummer,
  string Projectnaam,
  string Klant,
  DateOnly? Datum,
  string Door,
  string Vestiging,
  string Status,
  decimal Bedrag,
  string DataJson,
  long Version,
  DateTimeOffset Bijgewerkt
);

public sealed record CalculatieCreateResult(string Nummer, long Version);

public sealed class CalculatieRepository
{
  private readonly NpgsqlDataSource _dataSource;

  public CalculatieRepository(NpgsqlDataSource dataSource)
  {
    _dataSource = dataSource;
  }

  public async Task<CalculatieCreateResult> CreateAsync(string? vestiging, string? createdBySub, CancellationToken cancellationToken)
  {
    var jaar = DateTime.UtcNow.Year;

    await using var conn = await _dataSource.OpenConnectionAsync(cancellationToken);
    await using var tx = await conn.BeginTransactionAsync(cancellationToken);

    // Ensure counter row exists
    await using (var ensure = new NpgsqlCommand("insert into calc_counters(jaar, last_seq) values ($1, 0) on conflict (jaar) do nothing", conn, tx))
    {
      ensure.Parameters.AddWithValue(jaar);
      await ensure.ExecuteNonQueryAsync(cancellationToken);
    }

    int seq;
    await using (var bump = new NpgsqlCommand("update calc_counters set last_seq = last_seq + 1 where jaar = $1 returning last_seq", conn, tx))
    {
      bump.Parameters.AddWithValue(jaar);
      var obj = await bump.ExecuteScalarAsync(cancellationToken);
      seq = Convert.ToInt32(obj);
    }

    var nummer = $"{jaar}-{seq:D3}";

    const string insertSql = @"
insert into calculaties(
  nummer, jaar, seq, projectnaam, klant, datum, door, vestiging, status, bedrag_snapshot, data, created_by_sub, updated_by_sub
) values (
  $1, $2, $3, '', '', null, '', $4, 'Concept', 0, '{}'::jsonb, $5, $5
)
returning version;
";

    long version;
    await using (var ins = new NpgsqlCommand(insertSql, conn, tx))
    {
      ins.Parameters.AddWithValue(nummer);
      ins.Parameters.AddWithValue(jaar);
      ins.Parameters.AddWithValue(seq);
      ins.Parameters.AddWithValue(vestiging ?? "");
      ins.Parameters.AddWithValue((object?)createdBySub ?? DBNull.Value);
      var obj = await ins.ExecuteScalarAsync(cancellationToken);
      version = Convert.ToInt64(obj);
    }

    await tx.CommitAsync(cancellationToken);

    return new CalculatieCreateResult(nummer, version);
  }

  public async Task<IReadOnlyList<CalculatieRecord>> ListAsync(string? vestigingFilter, CancellationToken cancellationToken)
  {
    const string sql = @"
select
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at
from calculaties
where is_deleted = false
  and ($1 is null or vestiging = $1)
order by jaar desc, seq desc;
";

    await using var cmd = _dataSource.CreateCommand(sql);
    cmd.Parameters.AddWithValue((object?)vestigingFilter ?? DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

    var result = new List<CalculatieRecord>();
    while (await reader.ReadAsync(cancellationToken))
    {
      result.Add(ReadRecord(reader));
    }

    return result;
  }

  public async Task<CalculatieRecord?> GetAsync(string nummer, string? vestigingFilter, CancellationToken cancellationToken)
  {
    const string sql = @"
select
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at
from calculaties
where nummer = $1
  and is_deleted = false
  and ($2 is null or vestiging = $2);
";

    await using var cmd = _dataSource.CreateCommand(sql);
    cmd.Parameters.AddWithValue(nummer);
    cmd.Parameters.AddWithValue((object?)vestigingFilter ?? DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return ReadRecord(reader);
  }

  public async Task<CalculatieRecord?> UpsertAsync(
    CalculatieRecord record,
    long? expectedVersion,
    string? vestigingFilter,
    string? updatedBySub,
    CancellationToken cancellationToken)
  {
    const string sqlWithCheck = @"
update calculaties
set
  projectnaam = $2,
  klant = $3,
  datum = $4,
  door = $5,
  vestiging = $6,
  status = $7,
  bedrag_snapshot = $8,
  data = $9,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $10
where nummer = $1
  and is_deleted = false
  and ($11 is null or vestiging = $11)
  and version = $12
returning
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at;
";

    const string sqlNoCheck = @"
update calculaties
set
  projectnaam = $2,
  klant = $3,
  datum = $4,
  door = $5,
  vestiging = $6,
  status = $7,
  bedrag_snapshot = $8,
  data = $9,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $10
where nummer = $1
  and is_deleted = false
  and ($11 is null or vestiging = $11)
returning
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at;
";

    await using var cmd = _dataSource.CreateCommand(expectedVersion is null ? sqlNoCheck : sqlWithCheck);

    cmd.Parameters.AddWithValue(record.Nummer);
    cmd.Parameters.AddWithValue(record.Projectnaam ?? "");
    cmd.Parameters.AddWithValue(record.Klant ?? "");
    cmd.Parameters.AddWithValue((object?)record.Datum ?? DBNull.Value);
    cmd.Parameters.AddWithValue(record.Door ?? "");
    cmd.Parameters.AddWithValue(record.Vestiging ?? "");
    cmd.Parameters.AddWithValue(record.Status ?? "Concept");
    cmd.Parameters.AddWithValue(record.Bedrag);

    var dataParam = cmd.Parameters.AddWithValue(record.DataJson ?? "{}", NpgsqlDbType.Jsonb);
    _ = dataParam;

    cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)vestigingFilter ?? DBNull.Value);

    if (expectedVersion is not null)
    {
      cmd.Parameters.AddWithValue(expectedVersion.Value);
    }

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return ReadRecord(reader);
  }

  public async Task<CalculatieRecord?> SetStatusAsync(string nummer, string status, long? expectedVersion, string? vestigingFilter, string? updatedBySub, CancellationToken cancellationToken)
  {
    const string sqlWithCheck = @"
update calculaties
set
  status = $2,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $3
where nummer = $1
  and is_deleted = false
  and ($4 is null or vestiging = $4)
  and version = $5
returning
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at;
";

    const string sqlNoCheck = @"
update calculaties
set
  status = $2,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $3
where nummer = $1
  and is_deleted = false
  and ($4 is null or vestiging = $4)
returning
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  data::text,
  version,
  updated_at;
";

    await using var cmd = _dataSource.CreateCommand(expectedVersion is null ? sqlNoCheck : sqlWithCheck);
    cmd.Parameters.AddWithValue(nummer);
    cmd.Parameters.AddWithValue(status);
    cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)vestigingFilter ?? DBNull.Value);
    if (expectedVersion is not null)
    {
      cmd.Parameters.AddWithValue(expectedVersion.Value);
    }

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return ReadRecord(reader);
  }

  public async Task<bool> SoftDeleteAsync(string nummer, string? vestigingFilter, string? updatedBySub, CancellationToken cancellationToken)
  {
    const string sql = @"
update calculaties
set
  is_deleted = true,
  deleted_at = now(),
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $3
where nummer = $1
  and is_deleted = false
  and ($2 is null or vestiging = $2);
";

    await using var cmd = _dataSource.CreateCommand(sql);
    cmd.Parameters.AddWithValue(nummer);
    cmd.Parameters.AddWithValue((object?)vestigingFilter ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);

    var rows = await cmd.ExecuteNonQueryAsync(cancellationToken);
    return rows > 0;
  }

  private static CalculatieRecord ReadRecord(NpgsqlDataReader reader)
  {
    var nummer = reader.GetString(0);
    var projectnaam = reader.GetString(1);
    var klant = reader.GetString(2);
    DateOnly? datum = reader.IsDBNull(3) ? null : DateOnly.FromDateTime(reader.GetDateTime(3));
    var door = reader.GetString(4);
    var vestiging = reader.GetString(5);
    var status = reader.GetString(6);
    var bedrag = reader.GetDecimal(7);
    var dataJson = reader.GetString(8);
    var version = reader.GetInt64(9);
    var bijgewerkt = reader.GetFieldValue<DateTimeOffset>(10);

    return new CalculatieRecord(
      nummer,
      projectnaam,
      klant,
      datum,
      door,
      vestiging,
      status,
      bedrag,
      dataJson,
      version,
      bijgewerkt
    );
  }
}
