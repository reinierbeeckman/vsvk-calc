using System.Security.Claims;
using System.Text.Json;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class InstellingenProjectionTests
{
  private static Vestiging CreateVestiging() => new()
  {
    Id = Guid.Parse("11111111-1111-1111-1111-111111111111"),
    Naam = "VSVK Pijnacker BV",
    Adres = "Schouwweg 4",
    Postcode = "2642 AK",
    Plaats = "Pijnacker",
    Telefoon = "085-0491729",
    Email = "administratie@pijnacker.vsvk.nl",
    KvkNummer = "55442579",
    BtwNummer = "NL851714365B01",
    Iban = "NL86 INGB 0006 8116 55"
  };

  private static ClaimsPrincipal CreateUser(string? role = null)
  {
    IEnumerable<Claim> claims = role is null
      ? Array.Empty<Claim>()
      : [new Claim(ClaimTypes.Role, role)];
    return new ClaimsPrincipal(new ClaimsIdentity(claims, "test"));
  }

  [Fact]
  public void ManagerProjection_IncludesSensitiveVestigingFields()
  {
    var entity = new InstellingenAlgemeen
    {
      Id = 1,
      SysteemNaam = "VSVK",
      Version = 4,
      Vestigingen = [CreateVestiging()]
    };

    var result = InstellingenProjections.GetProjectionForUser(CreateUser("manager")).Compile()(entity);

    var vestiging = Assert.IsType<ManagerVestigingDto>(Assert.Single(result.Vestigingen));
    Assert.Equal("NL851714365B01", vestiging.BtwNummer);
    Assert.Equal("NL86 INGB 0006 8116 55", vestiging.Iban);
    Assert.Equal(4, result.Version);
  }

  [Theory]
  [InlineData("employee")]
  [InlineData("unknown")]
  public void NonManagerProjection_ExcludesSensitiveVestigingFields(string role)
  {
    var entity = new InstellingenAlgemeen
    {
      Id = 1,
      SysteemNaam = "VSVK",
      Vestigingen = [CreateVestiging()]
    };

    var result = InstellingenProjections.GetProjectionForUser(CreateUser(role)).Compile()(entity);
    var vestiging = Assert.IsType<VestigingDto>(Assert.Single(result.Vestigingen));

    Assert.IsNotType<ManagerVestigingDto>(vestiging);
    var json = JsonSerializer.Serialize(result);
    Assert.DoesNotContain("NL851714365B01", json);
    Assert.DoesNotContain("NL86 INGB 0006 8116 55", json);
  }
}
