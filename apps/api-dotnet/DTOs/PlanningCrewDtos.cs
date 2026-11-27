using Vsvk.Api.Http;

namespace Vsvk.Api.DTOs;

public sealed record PlanningCrewEquipmentDto(Guid MaterieelId, Guid? MedewerkerId = null);

public sealed record PlanningCrewDto(
  Guid Id, string Naam, Guid? VestigingId, List<Guid> Leden,
  List<PlanningCrewEquipmentDto> Materieel, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

/// <summary>Volledige ploeg: naam, leden en materieel worden samen en atomair vervangen.</summary>
public sealed record PlanningCrewWriteDto(
  string? Naam, List<Guid>? Leden, List<PlanningCrewEquipmentDto>? Materieel, Guid? VestigingId = null);

public sealed record PlanningCrewSaveResult(PlanningBoardSaveStatus Status, PlanningCrewDto? Crew);
