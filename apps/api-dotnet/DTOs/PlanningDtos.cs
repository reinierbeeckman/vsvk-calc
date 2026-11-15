using Vsvk.Api.Http;

namespace Vsvk.Api.DTOs;

public sealed record PlanningSkillDto(string Naam, DateOnly? DiplomaOp, DateOnly? GeldigTot);

public sealed record PlanningEmployeeDto(
  Guid Id, string? Personeelsnummer, string? Naam, string? Functie, string? Telefoon,
  string? Email, string? Vestiging, bool Actief, long Version, List<PlanningSkillDto> Skills)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningMaterieelDto(
  Guid Id, string? Omschrijving, string? Kenteken, string? Merk, string? Zoeknaam,
  string? Serienummer, string? Standplaats, string? Materieelgroep, long Version);

public sealed record PlanningActiveRequest(bool? Actief);
