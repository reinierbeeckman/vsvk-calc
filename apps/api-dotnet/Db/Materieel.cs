namespace Vsvk.Api.Db;

public sealed class Materieel
{
  public Guid Id { get; set; }
  public string? Kenteken { get; set; }
  public string? Omschrijving { get; set; }
  public Guid? StandplaatsId { get; set; }
  public Vestiging? Standplaats { get; set; }
  public string? Merk { get; set; }
  public string? Zoeknaam { get; set; }
  public string? Serienummer { get; set; }
  public Guid? MaterieelGroepId { get; set; }
  public MaterieelGroep? MaterieelGroep { get; set; }
  public long Version { get; set; } = 1;
}
