using Vsvk.Api.Http;

namespace Vsvk.Api.DTOs;

public sealed record PlanningBoardWorkSlipDto(
  Guid Id, string Nummer, string Status, bool GewijzigdNaUitgifte,
  DateTimeOffset? UitgereiktOp, DateTimeOffset? BinnenOp);

public sealed record PlanningBoardAssignmentDto(
  Guid Id, DateOnly Datum, Guid? MedewerkerId, string? Medewerker,
  string? Functie, Guid? InhuurmedewerkerId, string? Inhuurmedewerker,
  string? Leverancier, TimeOnly? StartTijd, TimeOnly? EindTijd,
  PlanningBoardWorkSlipDto? Werkbon);

public sealed record PlanningBoardJobDto(
  Guid Id, string Omschrijving, DateOnly StartDatum, DateOnly EindDatum,
  int BenodigdeMedewerkers, TimeOnly? StartTijd, TimeOnly? EindTijd, int Sorteervolgorde,
  List<PlanningBoardAssignmentDto> Inzetten);

public sealed record PlanningBoardWorkOrderDto(
  Guid Id, string Nummer, int KlantId, string Klant, string Omschrijving,
  DateOnly StartDatum, DateOnly EindDatum, bool IsOptie, string Kleur, string Status,
  long Version, List<PlanningBoardJobDto> Klussen)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningBoardLookupDto(Guid Id, string Naam);
public sealed record PlanningBoardCustomerLookupDto(int Id, string Naam);
public sealed record PlanningBoardSubcontractorLookupDto(Guid Id, string Naam, string? Functie, int LeverancierId, string Leverancier);
public sealed record PlanningBoardSupplierLookupDto(int Id, string Naam);
public sealed record PlanningBoardReferencesDto(
  List<PlanningBoardCustomerLookupDto> Klanten,
  List<PlanningBoardLookupDto> Medewerkers,
  List<PlanningBoardSubcontractorLookupDto> Inhuurmedewerkers,
  List<PlanningBoardSupplierLookupDto> Leveranciers);

public sealed record PlanningBoardWorkSlipWriteDto(
  string? Nummer, string? Status, bool GewijzigdNaUitgifte = false,
  DateTimeOffset? UitgereiktOp = null, DateTimeOffset? BinnenOp = null);

public sealed record PlanningBoardAssignmentWriteDto(
  DateOnly Datum, Guid? MedewerkerId, Guid? InhuurmedewerkerId,
  TimeOnly? StartTijd, TimeOnly? EindTijd, PlanningBoardWorkSlipWriteDto? Werkbon);

public sealed record PlanningBoardJobWriteDto(
  string? Omschrijving, DateOnly StartDatum, DateOnly EindDatum, int BenodigdeMedewerkers,
  TimeOnly? StartTijd, TimeOnly? EindTijd, int Sorteervolgorde,
  List<PlanningBoardAssignmentWriteDto>? Inzetten);

public sealed record PlanningBoardWorkOrderWriteDto(
  string? Nummer, int KlantId, string? Omschrijving, DateOnly StartDatum, DateOnly EindDatum,
  bool IsOptie, string? Kleur, List<PlanningBoardJobWriteDto>? Klussen);

public sealed record PlanningSubcontractorListDto(
  Guid Id, int LeverancierId, string Leverancier, string Naam, string? Functie,
  string? Telefoon, string? Email, bool Actief, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningSubcontractorWriteDto(
  int LeverancierId, string? Naam, string? Functie, string? Telefoon, string? Email, bool Actief = true);

public enum PlanningBoardSaveStatus { Saved, NotFound, Conflict, Invalid }
public sealed record PlanningBoardSaveResult(PlanningBoardSaveStatus Status, PlanningBoardWorkOrderDto? WorkOrder);
public sealed record PlanningSubcontractorSaveResult(
  PlanningBoardSaveStatus Status, PlanningSubcontractorListDto? Subcontractor);
