using System.Text.Json;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public class VestigingDtoTests
{
  [Fact]
  public void ManagerVestigingDto_InheritsBaseFields()
  {
    var dto = new ManagerVestigingDto(
      Guid.Parse("11111111-1111-1111-1111-111111111111"),
      "VSVK Pijnacker BV",
      "Schouwweg 4",
      "2642 AK",
      "Pijnacker",
      "085-0491729",
      "administratie@pijnacker.vsvk.nl",
      "55442579",
      "NL851714365B01",
      "NL86 INGB 0006 8116 55");

    VestigingDto asBase = dto;

    Assert.Equal(dto.Id, asBase.Id);
    Assert.Equal(dto.Naam, asBase.Naam);
    Assert.Equal(dto.KvkNummer, asBase.KvkNummer);
  }

  [Fact]
  public void VestigingDto_SerializesWithLegacyFieldNames_AndNoSensitiveFields()
  {
    var dto = new VestigingDto(
      Guid.Parse("22222222-2222-2222-2222-222222222222"),
      "VSVK Rilland BV",
      "Poort 69",
      "4411 PB",
      "Rilland",
      "085-0491729",
      "administratie@rilland.vsvk.nl",
      "20127088");

    var json = JsonSerializer.Serialize(dto);

    Assert.Contains("\"id\"", json);
    Assert.Contains("\"naam\"", json);
    Assert.Contains("\"adres\"", json);
    Assert.Contains("\"pc\"", json);
    Assert.Contains("\"plaats\"", json);
    Assert.Contains("\"tel\"", json);
    Assert.Contains("\"email\"", json);
    Assert.Contains("\"kvk\"", json);
    Assert.DoesNotContain("\"btw\"", json);
    Assert.DoesNotContain("\"iban\"", json);
  }

  [Fact]
  public void ManagerVestigingDto_SerializesWithSensitiveFields()
  {
    var dto = new ManagerVestigingDto(
      Guid.Parse("33333333-3333-3333-3333-333333333333"),
      "VSVK Wamel BV",
      "Sterkeburg 1",
      "6659 AM",
      "Wamel",
      "085-0491729",
      "administratie@wamel.vsvk.nl",
      "52611930",
      "NL850520836B01",
      "NL08 INGB 0793 9988 08");

    var json = JsonSerializer.Serialize(dto);

    Assert.Contains("\"btw\"", json);
    Assert.Contains("\"iban\"", json);
    Assert.Contains("\"kvk\"", json);
  }
}
