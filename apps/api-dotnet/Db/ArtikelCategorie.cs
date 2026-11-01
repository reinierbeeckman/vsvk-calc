namespace Vsvk.Api.Db;

public sealed class ArtikelCategorie
{
  public Guid Id { get; set; }
  public string Code { get; set; } = string.Empty;
  public string Naam { get; set; } = string.Empty;
  public int Sorteervolgorde { get; set; }
  public bool Actief { get; set; } = true;
  public ICollection<Artikel> Artikelen { get; set; } = new List<Artikel>();
}
