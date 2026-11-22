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
  List<PlanningBoardAssignmentDto> Inzetten, List<PlanningJobNeedDto>? Behoeften = null,
  DateOnly? Datum = null, TimeSpan? ReisHeen = null, TimeSpan? ReisTerug = null);

public sealed record PlanningJobNeedDto(
  int Aantal, string? Rol, string? Skill, Guid? MaterieelId = null, bool LosseVerhuur = false,
  Guid? MaterieelGroepId = null, string Soort = "mens");

public sealed record PlanningBoardWorkOrderDto(
  Guid Id, string Nummer, int KlantId, string Klant, string Omschrijving,
  DateOnly StartDatum, DateOnly EindDatum, bool IsOptie, string Kleur, string Status,
  long Version, List<PlanningBoardJobDto> Klussen, Guid? VestigingId = null, DateOnly? OptieTot = null,
  string Soort = "regie", string? InternProjectnummer = null, int? BestellerId = null,
  string? BestellerNaam = null, string? BestellerTelefoon = null, string? BestellerEmail = null,
  string? OptieReden = null, bool WeekendOverslaan = true, List<DateOnly>? VrijeDagen = null,
  bool Werkvoorraad = false, int? GeschatteUren = null, DateOnly? UiterlijkKlaar = null,
  string Prioriteit = "normaal", string? KorteWerkomschrijving = null, string? WerkInhoud = null,
  string? Instructies = null, string? Werkadres = null, string? WerkPostcode = null, string? WerkPlaats = null,
  string? GpsLocatie = null, string? ContactLocatieNaam = null, string? ContactLocatieTelefoon = null,
  TimeOnly? StartOpLocatie = null, TimeOnly? EindOpLocatie = null, int PauzeMinuten = 30,
  bool MeerdereDiensten = false, List<string>? Ordernummers = null,
  List<PlanningJobNeedDto>? Behoeften = null, List<PlanningJobNeedDto>? Materieel = null,
  List<PlanningWorkMaterialWriteDto>? Materialen = null)
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
  List<PlanningBoardSupplierLookupDto> Leveranciers,
  List<PlanningBoardLookupDto> Vestigingen);

public sealed record PlanningBoardWorkSlipWriteDto(
  string? Nummer, string? Status, bool GewijzigdNaUitgifte = false,
  DateTimeOffset? UitgereiktOp = null, DateTimeOffset? BinnenOp = null);

public sealed record PlanningBoardAssignmentWriteDto(
  DateOnly Datum, Guid? MedewerkerId, Guid? InhuurmedewerkerId,
  TimeOnly? StartTijd, TimeOnly? EindTijd, PlanningBoardWorkSlipWriteDto? Werkbon);

public sealed record PlanningBoardJobWriteDto(
  string? Omschrijving, DateOnly StartDatum, DateOnly EindDatum, int BenodigdeMedewerkers,
  TimeOnly? StartTijd, TimeOnly? EindTijd, int Sorteervolgorde,
  List<PlanningBoardAssignmentWriteDto>? Inzetten, List<PlanningJobNeedWriteDto>? Behoeften = null,
  DateOnly? Datum = null, TimeSpan? ReisHeen = null, TimeSpan? ReisTerug = null);

public sealed record PlanningBoardWorkOrderWriteDto(
  string? Nummer, int KlantId, string? Omschrijving, DateOnly StartDatum, DateOnly EindDatum,
  bool IsOptie, string? Kleur, List<PlanningBoardJobWriteDto>? Klussen,
  Guid? VestigingId = null, DateOnly? OptieTot = null, string Soort = "regie",
  string? InternProjectnummer = null, int? BestellerId = null, string? BestellerNaam = null,
  string? BestellerTelefoon = null, string? BestellerEmail = null, string? OptieReden = null,
  bool WeekendOverslaan = true, List<DateOnly>? VrijeDagen = null, bool Werkvoorraad = false,
  int? GeschatteUren = null, DateOnly? UiterlijkKlaar = null, string Prioriteit = "normaal",
  string? KorteWerkomschrijving = null, string? WerkInhoud = null, string? Instructies = null,
  string? Werkadres = null, string? WerkPostcode = null, string? WerkPlaats = null, string? GpsLocatie = null,
  string? ContactLocatieNaam = null, string? ContactLocatieTelefoon = null,
  TimeOnly? StartOpLocatie = null, TimeOnly? EindOpLocatie = null, int PauzeMinuten = 30,
  bool MeerdereDiensten = false, List<string>? Ordernummers = null,
  List<PlanningJobNeedWriteDto>? Behoeften = null,
  List<PlanningMaterialNeedWriteDto>? Materieel = null,
  List<PlanningWorkMaterialWriteDto>? Materialen = null,
  PlanningInlineCustomerWriteDto? NieuweKlant = null,
  PlanningInlineContactWriteDto? NieuweBesteller = null,
  List<PlanningServiceWriteDto>? Diensten = null);

public sealed record PlanningServiceWriteDto(string Naam, TimeOnly Start, TimeOnly Eind);

public sealed record PlanningJobNeedWriteDto(int Aantal, string? Rol, string? Skill, Guid? MaterieelId = null,
  bool LosseVerhuur = false, Guid? MaterieelGroepId = null, string Soort = "mens");
public sealed record PlanningMaterialNeedWriteDto(int Aantal, Guid? MaterieelGroepId, Guid? MaterieelId, string? Type, bool LosseVerhuur = false);
public sealed record PlanningWorkMaterialWriteDto(decimal Aantal, Guid? ArtikelId, string? Omschrijving, string? Eenheid);
public sealed record PlanningInlineCustomerWriteDto(
  string? Bedrijfsnaam, string? Straat, string? Postcode, string? Plaats, string? Telefoon, string? Email);
public sealed record PlanningInlineContactWriteDto(string? Naam, string? Telefoon, string? Email);

public sealed record PlanningWorkOrderCapacityDto(
  List<PlanningCapacityItemDto> Mensen, List<PlanningCapacityItemDto> Materieel,
  DateOnly? DruksteDag, int MensenGevraagd, int MensenBeschikbaar,
  int MaterieelGevraagd, int MaterieelBeschikbaar);
public sealed record PlanningWorkOrderCapacityRequest(
  DateOnly Van, DateOnly Tot, List<string> VrijeDagen, List<PlanningJobNeedWriteDto>? Mensen,
  List<PlanningMaterialNeedWriteDto>? Materieel);

public sealed record PlanningCapacityItemDto(
  string Naam, int Gevraagd, int Beschikbaar, string Label, DateOnly? DruksteDag);

public sealed record PlanningWorkOrderFormReferencesDto(
  List<PlanningCustomerReferenceDto> Klanten,
  List<PlanningBoardLookupDto> Vestigingen,
  List<string> Functies,
  List<PlanningMaterialLookupDto> MaterieelTypes, List<PlanningEquipmentLookupDto> Materieel,
  List<PlanningArticleLookupDto> Artikelen);
public sealed record PlanningMaterialLookupDto(Guid Id, string Naam);
public sealed record PlanningEquipmentLookupDto(Guid Id, string Naam, Guid? GroepId);
public sealed record PlanningArticleLookupDto(Guid Id, string Naam, string Categorie, string Eenheid);

public sealed record PlanningCustomerReferenceDto(
  int Id, string Naam, string Debiteurnummer, string? Straat, string? Postcode, string? Plaats,
  string? Telefoon, string? Email, List<PlanningBoardLookupContactDto> Contacten,
  List<PlanningBoardWorkOrderDto> RecenteOpdrachten);
public sealed record PlanningBoardLookupContactDto(
  int Id, string Naam, string? Telefoon, string? Email, bool IsStandaardBesteller);
public sealed record PlanningRecentWorkOrderDto(
  Guid Id, string Nummer, string Omschrijving, string? KorteWerkomschrijving, string? Werkadres,
  string? WerkPlaats, string? WerkPostcode, TimeOnly? StartOpLocatie, TimeOnly? EindOpLocatie,
  int? BenodigdeMedewerkers, List<PlanningJobNeedDto> Behoeften, List<PlanningJobNeedDto> Materieel);

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

public sealed record TimelinePeriodDto(DateOnly Van, DateOnly Tot, DateOnly Vandaag, string Zoom, string Titel);
public sealed record TimelineDayDto(DateOnly Datum, string Kort, int Nr, bool Weekend, bool Vandaag);
public sealed record TimelineDayCellDto(
  List<Guid> KlusIds, int Nodig, int Bezet, int Open, string Bezetting, int TeDoen,
  string BonSamenvatting, string Vertrek, TimeOnly? EindTijd);
public sealed record TimelinePersonDayDto(
  string Status, Guid? BonId, string? Nummer, string? OudNummer, Guid KlusId);
public sealed record TimelinePersonDto(
  Guid Id, string Naam, string? Functie, bool Extern, Dictionary<DateOnly, TimelinePersonDayDto?> Dagen);
public sealed record TimelineWorkOrderDto(
  Guid Id, string Nummer, string KlantNaam, string Kop, DateOnly StartDatum, DateOnly EindDatum,
  string Kleur, bool Optie,
  int OpenPlekken, int BonnenTeDoen, string Groep,
  Dictionary<DateOnly, TimelineDayCellDto> Dagen, List<TimelinePersonDto> Mensen);
public sealed record TimelineGroupDto(string Key, string Label, List<TimelineWorkOrderDto> Werkopdrachten);
public sealed record TimelineTotalDto(int Werkopdrachten);
public sealed record TimelineViewModel(
  TimelinePeriodDto Periode, List<TimelineDayDto> Dagen,
  List<TimelineGroupDto> Groepen, TimelineTotalDto Totaal);
