using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class ArtikelProjectionTests
{
  [Fact]
  public void Projection_UsesLookupNamesAndKeepsSeePriceTariffNull()
  {
    var artikel = new Artikel
    {
      Id = Guid.Parse("22222222-2222-2222-2222-222222222222"),
      Naam = "Afvoer vrijgekomen materialen",
      CategorieId = Guid.Parse("33333333-3333-3333-3333-333333333333"),
      Categorie = new ArtikelCategorie { Id = Guid.Parse("33333333-3333-3333-3333-333333333333"), Code = "overig", Naam = "Overig" },
      EenheidId = Guid.Parse("44444444-4444-4444-4444-444444444444"),
      Eenheid = new ArtikelEenheid { Id = Guid.Parse("44444444-4444-4444-4444-444444444444"), Code = "keer", Naam = "keer" },
      TariefSoort = "zie_prijs",
      Tarief = null,
      Actief = true,
      Version = 9
    };

    var result = ArtikelProjections.Response.Compile()(artikel);

    Assert.Equal("Overig", result.Categorie);
    Assert.Equal("keer", result.Eenheid);
    Assert.Equal("zie_prijs", result.TariefSoort);
    Assert.Null(result.Tarief);
    Assert.Equal(9, result.Version);
    Assert.Equal("\"9\"", result.ETag);
  }
}
