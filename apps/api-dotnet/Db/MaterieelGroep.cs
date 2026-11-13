namespace Vsvk.Api.Db;

public sealed class MaterieelGroep
{
  public Guid Id { get; set; }
  public string Omschrijving { get; set; } = string.Empty;
  public long Version { get; set; } = 1;
  public ICollection<Materieel> MaterieelItems { get; set; } = new List<Materieel>();
}
