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

public sealed record PlanningCustomerListDto(
  int Id, bool Actief, string Debiteurnummer, string Bedrijfsnaam, string? Telefoon,
  string? Plaats, string? StandaardBesteller);

public sealed record PlanningCustomerContactDto(
  int Id, string Naam, string? Functie, string? Telefoon, string? Email, bool IsStandaardBesteller);

public sealed record PlanningCustomerBillingDto(
  string? BtwNummer, string? Iban, string? FactuurEmail, bool AfwijkendFactuuradres, string? VasteReferentie,
  decimal? GRekeningPercentage, string? FacturerenPer, bool BtwVerlegd, bool MandagenregisterMeesturen);

public sealed record PlanningCustomerDetailDto(
  int Id, bool Actief, string Debiteurnummer, string Bedrijfsnaam, string? KvkNummer,
  string? Website, string? Telefoon, string? Email, string? Straat, string? Huisnummer,
  string? Toevoeging, string? Postcode, string? Plaats, string? Land, string? Opmerkingen,
  List<PlanningCustomerContactDto> Contactpersonen, PlanningCustomerBillingDto Facturatie);
