using Vsvk.Api.Http;
using System.Text.Json.Serialization;

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

public sealed record PlanningSupplierListDto(
  int Id, bool Actief, string Crediteurnummer, string Bedrijfsnaam, string? Telefoon, string? Plaats);

public sealed record PlanningSupplierWriteDto(
  string? Crediteurnummer, string? Bedrijfsnaam, bool Actief = true, string? KvkNummer = null,
  string? BtwNummer = null, string? Website = null, string? Telefoon = null, string? Email = null,
  string? Straat = null, string? Huisnummer = null, string? Toevoeging = null, string? Postcode = null,
  string? Plaats = null, string? Land = "Nederland", string? FactuurEmail = null,
  bool AfwijkendFactuuradres = false, string? VasteReferentie = null, string? Iban = null,
  decimal? GRekeningPercentage = null, string? FacturerenPer = null, bool BtwVerlegd = false,
  bool MandagenregisterMeesturen = false, string? Opmerkingen = null);

public sealed record PlanningSupplierDetailDto(
  int Id, bool Actief, string Crediteurnummer, string Bedrijfsnaam, string? KvkNummer,
  string? BtwNummer, string? Website, string? Telefoon, string? Email, string? Straat,
  string? Huisnummer, string? Toevoeging, string? Postcode, string? Plaats, string? Land,
  string? FactuurEmail, bool AfwijkendFactuuradres, string? VasteReferentie, string? Iban,
  decimal? GRekeningPercentage, string? FacturerenPer, bool BtwVerlegd,
  bool MandagenregisterMeesturen, string? Opmerkingen, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

/// <summary>De verplichte gegevens voor het aanmaken van een klant.</summary>
public sealed record CreatePlanningCustomerRequest(string? Debiteurnummer, string? Bedrijfsnaam);

public sealed record PlanningCustomerContactDto(
  [property: JsonRequired] int Id, [property: JsonRequired] string Naam, [property: JsonRequired] string? Functie,
  [property: JsonRequired] string? Telefoon, [property: JsonRequired] string? Email, [property: JsonRequired] bool IsStandaardBesteller);

public sealed record PlanningCustomerBillingDto(
  [property: JsonRequired] string? BtwNummer, [property: JsonRequired] string? Iban, [property: JsonRequired] string? FactuurEmail,
  [property: JsonRequired] bool AfwijkendFactuuradres, [property: JsonRequired] string? VasteReferentie,
  [property: JsonRequired] decimal? GRekeningPercentage, [property: JsonRequired] string? FacturerenPer,
  [property: JsonRequired] bool BtwVerlegd, [property: JsonRequired] bool MandagenregisterMeesturen);

public sealed record PlanningCustomerDetailDto(
  [property: JsonRequired] int Id, [property: JsonRequired] bool Actief, [property: JsonRequired] string Debiteurnummer,
  [property: JsonRequired] string Bedrijfsnaam, [property: JsonRequired] string? KvkNummer,
  [property: JsonRequired] string? Website, [property: JsonRequired] string? Telefoon, [property: JsonRequired] string? Email,
  [property: JsonRequired] string? Straat, [property: JsonRequired] string? Huisnummer,
  [property: JsonRequired] string? Toevoeging, [property: JsonRequired] string? Postcode, [property: JsonRequired] string? Plaats,
  [property: JsonRequired] string? Land, [property: JsonRequired] string? Opmerkingen,
  [property: JsonRequired] List<PlanningCustomerContactDto> Contactpersonen, [property: JsonRequired] PlanningCustomerBillingDto Facturatie, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningStandardRateDto(
  int FunctieId, string Functie, bool Actief, string? Toelichting,
  int StandaardTariefId, decimal Prijs, string Eenheid, DateOnly GeldigVanaf);

public sealed record PlanningStandardPriceDto(decimal Prijs, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningStandardPriceRequest(decimal? Prijs);

public sealed record PlanningCustomerRateDto(int FunctieId, string Omschrijving, decimal Tarief, string? Eenheid);

public sealed record PlanningHistoricalRateDto(string Omschrijving, decimal Tarief, string? Eenheid);

public sealed record PlanningCustomerRatesDto(long Version, List<PlanningCustomerRateDto> Afwijkingen,
  List<PlanningHistoricalRateDto> HistorischeTarieven)
{
  public string ETag => StrongEtag.Format(Version);
}

public sealed record PlanningRateOverrideRequest(int FunctieId, decimal? Tarief);
public sealed record PlanningCustomerRatesRequest(List<PlanningRateOverrideRequest>? Afwijkingen);
public sealed record PlanningRatesUpdateResult(PlanningCustomerRatesDto? Rates, bool Invalid);
