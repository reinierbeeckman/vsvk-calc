using System.Text.Json.Serialization;
using Vsvk.Api.Http;

namespace Vsvk.Api.DTOs;

/// <summary>De bewerkbare bestaande materieelgegevens en hun versie.</summary>
public sealed record PlanningMaterieelEditDto(Guid Id, string? Omschrijving, string? Kenteken, string? Merk,
  string? Zoeknaam, string? Serienummer, Guid? StandplaatsId, Guid? MaterieelGroepId, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

/// <summary>Volledige vervanging van de bestaande materieelvelden.</summary>
public sealed record PlanningMaterieelUpdateRequest(
  [property: JsonRequired] string? Omschrijving, [property: JsonRequired] string? Kenteken,
  [property: JsonRequired] string? Merk, [property: JsonRequired] string? Zoeknaam,
  [property: JsonRequired] string? Serienummer, [property: JsonRequired] Guid? StandplaatsId,
  [property: JsonRequired] Guid? MaterieelGroepId);

/// <summary>Een bestaande referentie voor de materieelbewerking.</summary>
public sealed record PlanningMaterieelReferenceDto(Guid Id, string Naam);

/// <summary>Beschikbare materieelgroepen en vestigingen.</summary>
public sealed record PlanningMaterieelReferencesDto(List<PlanningMaterieelReferenceDto> Groepen, List<PlanningMaterieelReferenceDto> Vestigingen);

public sealed record PlanningMaterieelSaveResult(PlanningMaterieelEditDto? Materieel, bool Invalid);
