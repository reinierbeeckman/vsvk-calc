using Npgsql;

namespace Vsvk.Api.Db;

public sealed record StamdataItem(string Code, string Name);

public sealed class StamdataRepository
{
  private readonly NpgsqlDataSource _dataSource;

  public StamdataRepository(NpgsqlDataSource dataSource)
  {
    _dataSource = dataSource;
  }

  public async Task<IReadOnlyList<StamdataItem>> ListAsync(CancellationToken cancellationToken = default)
  {
    const string sql = "select code, name from stamdata order by code";

    await using var cmd = _dataSource.CreateCommand(sql);
    await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

    var result = new List<StamdataItem>();
    while (await reader.ReadAsync(cancellationToken))
    {
      var code = reader.GetString(0);
      var name = reader.GetString(1);
      result.Add(new StamdataItem(code, name));
    }

    return result;
  }
}
