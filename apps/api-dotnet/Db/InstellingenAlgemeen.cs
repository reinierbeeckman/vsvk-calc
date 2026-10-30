namespace Vsvk.Api.Db;

public sealed class InstellingenAlgemeen
{
  public int Id { get; set; }
  public string SysteemNaam { get; set; } = string.Empty;
  public long Version { get; set; }
  public ICollection<Vestiging> Vestigingen { get; set; } = new List<Vestiging>();
}
