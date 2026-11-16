namespace Vsvk.Api.Db;

public sealed class KlantContactpersoon
{
  public int Id { get; set; }
  public int KlantId { get; set; }
  public bool IsStandaardBesteller { get; set; }
  public string Naam { get; set; } = "";
  public string? Functie { get; set; }
  public string? Telefoon { get; set; }
  public string? Email { get; set; }
  public Klant Klant { get; set; } = null!;
}
