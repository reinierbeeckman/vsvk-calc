using System.Text.Json;
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public class VestigingDtoTests
{
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
  public void VestigingDto_SerializesSensitiveFieldsWhenProvided()
  {
    var dto = new VestigingDto(
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
