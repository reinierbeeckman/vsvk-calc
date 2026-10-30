using System.Text.Json.Serialization;

namespace Vsvk.Api.DTOs;

[JsonDerivedType(typeof(ManagerVestigingDto))]
public record VestigingDto(
    [property: JsonPropertyName("id")] Guid Id,
    [property: JsonPropertyName("naam")] string Naam,
    [property: JsonPropertyName("adres")] string Adres,
    [property: JsonPropertyName("pc")] string Postcode,
    [property: JsonPropertyName("plaats")] string Plaats,
    [property: JsonPropertyName("tel")] string Telefoon,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("kvk")] string KvkNummer
);

public record ManagerVestigingDto(
    Guid Id,
    string Naam,
    string Adres,
    string Postcode,
    string Plaats,
    string Telefoon,
    string Email,
    string KvkNummer,
    [property: JsonPropertyName("btw")] string BtwNummer,
    [property: JsonPropertyName("iban")] string Iban
) : VestigingDto(Id, Naam, Adres, Postcode, Plaats, Telefoon, Email, KvkNummer);
