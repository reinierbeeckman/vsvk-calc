namespace Vsvk.Api.Db;

public sealed class Werkopdracht
{
  public Guid Id { get; set; }
  public string Nummer { get; set; } = "";
  public int KlantId { get; set; }
  public Klant Klant { get; set; } = null!;
  public string Omschrijving { get; set; } = "";
  public DateOnly StartDatum { get; set; }
  public DateOnly EindDatum { get; set; }
  public bool IsOptie { get; set; }
  public DateOnly? OptieTot { get; set; }
  public string Kleur { get; set; } = "#2f8a5b";
  public Guid? VestigingId { get; set; }
  public Vestiging? Vestiging { get; set; }
  public bool Geannuleerd { get; set; }
  public bool Voorraad { get; set; }
  public string Soort { get; set; } = "regie";
  public string? InternProjectnummer { get; set; }
  public int? BestellerId { get; set; }
  public KlantContactpersoon? Besteller { get; set; }
  public string? BestellerNaam { get; set; }
  public string? BestellerTelefoon { get; set; }
  public string? BestellerEmail { get; set; }
  public string? OptieReden { get; set; }
  public bool WeekendOverslaan { get; set; } = true;
  public int? GeschatteUren { get; set; }
  public DateOnly? UiterlijkKlaar { get; set; }
  public string Prioriteit { get; set; } = "normaal";
  public string? KorteWerkomschrijving { get; set; }
  public string? WerkInhoud { get; set; }
  public string? Instructies { get; set; }
  public string? Werkadres { get; set; }
  public string? WerkPostcode { get; set; }
  public string? WerkPlaats { get; set; }
  public string? GpsLocatie { get; set; }
  public string? ContactLocatieNaam { get; set; }
  public string? ContactLocatieTelefoon { get; set; }
  public TimeOnly? StartOpLocatie { get; set; }
  public TimeOnly? EindOpLocatie { get; set; }
  public int PauzeMinuten { get; set; } = 30;
  public bool MeerdereDiensten { get; set; }
  public ICollection<WerkopdrachtOrdernummer> Ordernummers { get; set; } = new List<WerkopdrachtOrdernummer>();
  public ICollection<WerkopdrachtVrijeDag> VrijeDagen { get; set; } = new List<WerkopdrachtVrijeDag>();
  public ICollection<WerkopdrachtMateriaal> Materialen { get; set; } = new List<WerkopdrachtMateriaal>();
  public long Version { get; set; } = 1;
  public ICollection<Klus> Klussen { get; set; } = new List<Klus>();
}

public sealed class Klus
{
  public Guid Id { get; set; }
  public Guid WerkopdrachtId { get; set; }
  public Werkopdracht Werkopdracht { get; set; } = null!;
  public string Omschrijving { get; set; } = "";
  public DateOnly StartDatum { get; set; }
  public DateOnly EindDatum { get; set; }
  public int BenodigdeMedewerkers { get; set; }
  public TimeOnly? StartTijd { get; set; }
  public TimeOnly? EindTijd { get; set; }
  public int Sorteervolgorde { get; set; }
  public DateOnly? Datum { get; set; }
  public TimeSpan? ReisHeen { get; set; }
  public TimeSpan? ReisTerug { get; set; }
  public int PauzeMinuten { get; set; } = 30;
  public string? DienstNaam { get; set; }
  public ICollection<KlusBehoefte> Behoeften { get; set; } = new List<KlusBehoefte>();
  public ICollection<Inzet> Inzetten { get; set; } = new List<Inzet>();
}

public sealed class WerkopdrachtOrdernummer
{
  public Guid Id { get; set; }
  public Guid WerkopdrachtId { get; set; }
  public Werkopdracht Werkopdracht { get; set; } = null!;
  public string Nummer { get; set; } = "";
  public int Sorteervolgorde { get; set; }
}

public sealed class WerkopdrachtVrijeDag
{
  public Guid WerkopdrachtId { get; set; }
  public Werkopdracht Werkopdracht { get; set; } = null!;
  public DateOnly Datum { get; set; }
}

public sealed class WerkopdrachtMateriaal
{
  public Guid Id { get; set; }
  public Guid WerkopdrachtId { get; set; }
  public Werkopdracht Werkopdracht { get; set; } = null!;
  public decimal Aantal { get; set; }
  public Guid? ArtikelId { get; set; }
  public Artikel? Artikel { get; set; }
  public string? Omschrijving { get; set; }
  public string? Eenheid { get; set; }
}

public sealed class KlusBehoefte
{
  public Guid Id { get; set; }
  public Guid KlusId { get; set; }
  public Klus Klus { get; set; } = null!;
  public int Aantal { get; set; }
  public string? Rol { get; set; }
  public string? Skill { get; set; }
  public string Soort { get; set; } = "mens";
  public Guid? MaterieelId { get; set; }
  public Materieel? Materieel { get; set; }
  public Guid? MaterieelGroepId { get; set; }
  public MaterieelGroep? MaterieelGroep { get; set; }
  public bool LosseVerhuur { get; set; }
}

public sealed class Inhuurmedewerker
{
  public Guid Id { get; set; }
  public int LeverancierId { get; set; }
  public Leverancier Leverancier { get; set; } = null!;
  public string Naam { get; set; } = "";
  public string? Functie { get; set; }
  public string? Telefoon { get; set; }
  public string? Email { get; set; }
  public bool Actief { get; set; } = true;
  public long Version { get; set; } = 1;
}

public sealed class Inzet
{
  public Guid Id { get; set; }
  public Guid KlusId { get; set; }
  public Klus Klus { get; set; } = null!;
  public DateOnly Datum { get; set; }
  public Guid? MedewerkerId { get; set; }
  public UserInformation? Medewerker { get; set; }
  public Guid? InhuurmedewerkerId { get; set; }
  public Inhuurmedewerker? Inhuurmedewerker { get; set; }
  public TimeOnly? StartTijd { get; set; }
  public TimeOnly? EindTijd { get; set; }
  public Werkbon? Werkbon { get; set; }
}

public sealed class Werkbon
{
  public Guid Id { get; set; }
  public Guid InzetId { get; set; }
  public Inzet Inzet { get; set; } = null!;
  public string Nummer { get; set; } = "";
  public string? OudNummer { get; set; }
  public string Status { get; set; } = "niet_geprint";
  public bool GewijzigdNaUitgifte { get; set; }
  public DateTimeOffset? UitgereiktOp { get; set; }
  public DateTimeOffset? BinnenOp { get; set; }
}
