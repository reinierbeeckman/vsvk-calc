using System.ComponentModel.DataAnnotations;
using Vsvk.Api.Db;

namespace Vsvk.Api.DTOs;

/// <summary>Artikeldata met categorie- en eenheidverwijzingen.</summary>
public sealed record ArtikelDto(
  Guid Id,
  string Naam,
  Guid CategorieId,
  string Categorie,
  Guid EenheidId,
  string Eenheid,
  string TariefSoort,
  decimal? Tarief,
  bool Actief,
  long Version)
{
  public string ETag => Vsvk.Api.Http.StrongEtag.Format(Version);
}

/// <summary>Een actieve artikelcategorie uit de opzoektabel.</summary>
public sealed record ArtikelCategorieDto(Guid Id, string Code, string Naam, int Sorteervolgorde, bool Actief);

/// <summary>Een actieve artikeleenheid uit de opzoektabel.</summary>
public sealed record ArtikelEenheidDto(Guid Id, string Code, string Naam, int Sorteervolgorde, bool Actief);

/// <summary>Payload voor het aanmaken of wijzigen van een artikel.</summary>
public sealed record ArtikelRequest
{
  [Required, StringLength(200, MinimumLength = 1)]
  public required string Naam { get; init; }

  public required Guid CategorieId { get; init; }

  public required Guid EenheidId { get; init; }

  [Required, RegularExpression("^(vast|zie_prijs)$")]
  public required string TariefSoort { get; init; }

  [Range(typeof(decimal), "0", "9999999999.9999")]
  public decimal? Tarief { get; init; }

  public bool Actief { get; init; } = true;
}

public static class ArtikelProjections
{
  public static readonly System.Linq.Expressions.Expression<Func<Artikel, ArtikelDto>> Response = artikel => new ArtikelDto(
    artikel.Id,
    artikel.Naam,
    artikel.CategorieId,
    artikel.Categorie.Naam,
    artikel.EenheidId,
    artikel.Eenheid.Naam,
    artikel.TariefSoort,
    artikel.Tarief,
    artikel.Actief,
    artikel.Version);
}
