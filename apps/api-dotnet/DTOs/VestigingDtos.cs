using System.Text.Json.Serialization;

namespace Vsvk.Api.DTOs;

public record VestigingDto(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("naam")] string Naam,
    [property: JsonPropertyName("adres")] string Adres,
    [property: JsonPropertyName("pc")] string Postcode,
    [property: JsonPropertyName("plaats")] string Plaats,
    [property: JsonPropertyName("tel")] string Telefoon,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("kvk")] string KvkNummer,
    [property: JsonPropertyName("btw"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? BtwNummer = null,
    [property: JsonPropertyName("iban"), JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Iban = null
);
