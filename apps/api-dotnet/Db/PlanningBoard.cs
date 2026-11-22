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
  public ICollection<KlusBehoefte> Behoeften { get; set; } = new List<KlusBehoefte>();
  public ICollection<Inzet> Inzetten { get; set; } = new List<Inzet>();
}

public sealed class KlusBehoefte
{
  public Guid Id { get; set; }
  public Guid KlusId { get; set; }
  public Klus Klus { get; set; } = null!;
  public int Aantal { get; set; }
  public string? Rol { get; set; }
  public string? Skill { get; set; }
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
