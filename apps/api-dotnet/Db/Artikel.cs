namespace Vsvk.Api.Db;

public sealed class Artikel
{
  public Guid Id { get; set; }
  public string Naam { get; set; } = string.Empty;
  public Guid CategorieId { get; set; }
  public ArtikelCategorie Categorie { get; set; } = null!;
  public Guid EenheidId { get; set; }
  public ArtikelEenheid Eenheid { get; set; } = null!;
  public string TariefSoort { get; set; } = "vast";
  public decimal? Tarief { get; set; }
  public bool Actief { get; set; } = true;
  public long Version { get; set; } = 1;
}
