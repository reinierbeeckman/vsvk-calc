namespace Vsvk.Api.Db;

public sealed class Leverancier
{
  public int Id { get; set; }
  public bool Aan { get; set; }
  public required string Debiteurnummer { get; set; }
  public required string Bedrijfsnaam { get; set; }
  public string? KvkNummer { get; set; }
  public string? BtwNummer { get; set; }
  public string? Website { get; set; }
  public string? TelefoonAlgemeen { get; set; }
  public string? EmailAlgemeen { get; set; }
  public string? Straat { get; set; }
  public string? Huisnummer { get; set; }
  public string? Toevoeging { get; set; }
  public string? Postcode { get; set; }
  public string? Plaats { get; set; }
  public string? Land { get; set; }
  public string? Iban { get; set; }
  public string? FactuurEmail { get; set; }
  public bool AfwijkendFactuuradres { get; set; }
  public string? VasteReferentie { get; set; }
  public decimal? GRekeningPercentage { get; set; }
  public string? FacturerenPer { get; set; }
  public bool BtwVerlegd { get; set; }
  public bool MandagenregisterMeesturen { get; set; }
  public string? Opmerkingen { get; set; }
  public long Version { get; set; }
}
