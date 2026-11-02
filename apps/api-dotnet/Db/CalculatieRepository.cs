using Npgsql;
using NpgsqlTypes;

namespace Vsvk.Api.Db;

public sealed record CalculatieTotals(
  decimal Subtotaal,
  decimal BtwTarief,
  decimal BtwBedrag,
  decimal Totaal
);

public sealed record CalculationArticleSelection(
  string? LineId,
  string ArtikelNaam,
  string? Categorie,
  decimal? Aantal,
  decimal? Dagen,
  decimal? Uren,
  decimal? Toeslag,
  decimal? Eenheidsprijs,
  decimal? RegelTotaal
);

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
  DateTimeOffset Bijgewerkt,
  CalculatieTotals Totals
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
  nummer, jaar, seq, projectnaam, klant, datum, door, vestiging, status, bedrag_snapshot,
  subtotal_snapshot, btw_rate_snapshot, btw_amount_snapshot, total_snapshot,
  data, created_by_sub, updated_by_sub
) values (
  $1, $2, $3, '', '', null, '', $4, 'Concept', 0,
  0, 0, 0, 0,
  '{}'::jsonb, $5, $5
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
  subtotal_snapshot,
  btw_rate_snapshot,
  btw_amount_snapshot,
  total_snapshot,
  data::text,
  version,
  updated_at
from calculaties
where is_deleted = false
  and ($1 is null or vestiging = $1)
order by jaar desc, seq desc;
";

    await using var cmd = _dataSource.CreateCommand(sql);
    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)vestigingFilter ?? DBNull.Value);

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
  subtotal_snapshot,
  btw_rate_snapshot,
  btw_amount_snapshot,
  total_snapshot,
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
    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)vestigingFilter ?? DBNull.Value);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return ReadRecord(reader);
  }

  public async Task<CalculatieRecord?> UpsertAsync(
    CalculatieRecord record,
    CalculatieTotals totals,
    IReadOnlyList<CalculationArticleSelection> selectedArticles,
    long expectedVersion,
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
  subtotal_snapshot = $9,
  btw_rate_snapshot = $10,
  btw_amount_snapshot = $11,
  total_snapshot = $12,
  data = $13,
  version = version + 1,
  updated_at = now(),
  updated_by_sub = $14
where nummer = $1
  and is_deleted = false
  and ($15 is null or vestiging = $15)
  and version = $16
returning
  nummer,
  projectnaam,
  klant,
  datum,
  door,
  vestiging,
  status,
  bedrag_snapshot,
  subtotal_snapshot,
  btw_rate_snapshot,
  btw_amount_snapshot,
  total_snapshot,
  data::text,
  version,
  updated_at;
";

    await using var conn = await _dataSource.OpenConnectionAsync(cancellationToken);
    await using var tx = await conn.BeginTransactionAsync(cancellationToken);

    CalculatieRecord? updated;

    await using (var cmd = new NpgsqlCommand(sqlWithCheck, conn, tx))
    {
      cmd.Parameters.AddWithValue(record.Nummer);
      cmd.Parameters.AddWithValue(record.Projectnaam ?? "");
      cmd.Parameters.AddWithValue(record.Klant ?? "");
      cmd.Parameters.AddWithValue((object?)record.Datum ?? DBNull.Value);
      cmd.Parameters.AddWithValue(record.Door ?? "");
      cmd.Parameters.AddWithValue(record.Vestiging ?? "");
      cmd.Parameters.AddWithValue(record.Status ?? "Concept");
      cmd.Parameters.AddWithValue(record.Bedrag);
      cmd.Parameters.AddWithValue(totals.Subtotaal);
      cmd.Parameters.AddWithValue(totals.BtwTarief);
      cmd.Parameters.AddWithValue(totals.BtwBedrag);
      cmd.Parameters.AddWithValue(totals.Totaal);
      cmd.Parameters.AddWithValue(NpgsqlDbType.Jsonb, record.DataJson ?? "{}");
      cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);
      cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)vestigingFilter ?? DBNull.Value);

      cmd.Parameters.AddWithValue(expectedVersion);

      await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
      {
        updated = await reader.ReadAsync(cancellationToken) ? ReadRecord(reader) : null;
      }
    }

    if (updated is null)
    {
      await tx.RollbackAsync(cancellationToken);
      return null;
    }

    await ReplaceArticlesAsync(conn, tx, record.Nummer, selectedArticles, cancellationToken);
    await tx.CommitAsync(cancellationToken);

    return updated;
  }

  public async Task<CalculatieRecord?> SetStatusAsync(string nummer, string status, long expectedVersion, string? vestigingFilter, string? updatedBySub, CancellationToken cancellationToken)
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
  subtotal_snapshot,
  btw_rate_snapshot,
  btw_amount_snapshot,
  total_snapshot,
  data::text,
  version,
  updated_at;
";

    await using var cmd = _dataSource.CreateCommand(sqlWithCheck);
    cmd.Parameters.AddWithValue(nummer);
    cmd.Parameters.AddWithValue(status);
    cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);
    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)vestigingFilter ?? DBNull.Value);
    cmd.Parameters.AddWithValue(expectedVersion);

    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return ReadRecord(reader);
  }

  public async Task<long?> SoftDeleteAsync(string nummer, long expectedVersion, string? vestigingFilter, string? updatedBySub, CancellationToken cancellationToken)
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
  and ($2 is null or vestiging = $2)
  and version = $4
returning version;
";

    await using var cmd = _dataSource.CreateCommand(sql);
    cmd.Parameters.AddWithValue(nummer);
    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)vestigingFilter ?? DBNull.Value);
    cmd.Parameters.AddWithValue((object?)updatedBySub ?? DBNull.Value);
    cmd.Parameters.AddWithValue(expectedVersion);

    var obj = await cmd.ExecuteScalarAsync(cancellationToken);
    return obj is null or DBNull ? null : Convert.ToInt64(obj);
  }

  private static async Task ReplaceArticlesAsync(
    NpgsqlConnection conn,
    NpgsqlTransaction tx,
    string nummer,
    IReadOnlyList<CalculationArticleSelection> selectedArticles,
    CancellationToken cancellationToken)
  {
    await using (var del = new NpgsqlCommand("delete from calculatie_artikelen where calculatie_nummer = $1", conn, tx))
    {
      del.Parameters.AddWithValue(nummer);
      await del.ExecuteNonQueryAsync(cancellationToken);
    }

    if (selectedArticles.Count == 0)
    {
      return;
    }

    const string insertSql = @"
insert into calculatie_artikelen(
  calculatie_nummer,
  line_id,
  artikel_naam,
  categorie,
  aantal,
  dagen,
  uren,
  toeslag,
  eenheidsprijs,
  regel_totaal
) values (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
);
";

    foreach (var article in selectedArticles)
    {
      if (string.IsNullOrWhiteSpace(article.ArtikelNaam))
      {
        continue;
      }

      await using var ins = new NpgsqlCommand(insertSql, conn, tx);
      ins.Parameters.AddWithValue(nummer);
      ins.Parameters.AddWithValue((object?)article.LineId ?? DBNull.Value);
      ins.Parameters.AddWithValue(article.ArtikelNaam.Trim());
      ins.Parameters.AddWithValue((object?)article.Categorie ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.Aantal ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.Dagen ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.Uren ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.Toeslag ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.Eenheidsprijs ?? DBNull.Value);
      ins.Parameters.AddWithValue((object?)article.RegelTotaal ?? DBNull.Value);
      await ins.ExecuteNonQueryAsync(cancellationToken);
    }
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
    var subtotal = reader.GetDecimal(8);
    var btwRate = reader.GetDecimal(9);
    var btwAmount = reader.GetDecimal(10);
    var total = reader.GetDecimal(11);
    var dataJson = reader.GetString(12);
    var version = reader.GetInt64(13);
    var bijgewerkt = reader.GetFieldValue<DateTimeOffset>(14);

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
      bijgewerkt,
      new CalculatieTotals(subtotal, btwRate, btwAmount, total)
    );
  }
}
