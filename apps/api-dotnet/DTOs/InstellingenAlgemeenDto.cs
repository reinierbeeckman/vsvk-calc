using System.Text.Json.Serialization;

namespace Vsvk.Api.DTOs;

/// <summary>General application settings visible to the authenticated user.</summary>
public sealed record InstellingenAlgemeenDto(
    [property: JsonPropertyName("id")] int Id,
    [property: JsonPropertyName("systeemNaam")] string SysteemNaam,
    [property: JsonPropertyName("version")] long Version,
    [property: JsonPropertyName("vestigingen")] IEnumerable<VestigingDto> Vestigingen);
