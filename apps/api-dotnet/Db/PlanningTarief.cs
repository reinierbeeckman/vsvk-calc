namespace Vsvk.Api.Db;

public sealed class PlanningFunctie
{
  public int Id { get; set; }
  public bool Aan { get; set; }
  public string Naam { get; set; } = "";
  public string? Toelichting { get; set; }
}

public sealed class PlanningStandaardTarief
{
  public int Id { get; set; }
  public int FunctieId { get; set; }
  public PlanningFunctie Functie { get; set; } = null!;
  public decimal Prijs { get; set; }
  public long Version { get; set; }
  public string Eenheid { get; set; } = "";
  public DateOnly GeldigVanaf { get; set; }
}

public sealed class PlanningKlantTarief
{
  public int Id { get; set; }
  public int KlantId { get; set; }
  public int? FunctieId { get; set; }
  public string Omschrijving { get; set; } = "";
  public decimal Tarief { get; set; }
  public string? Eenheid { get; set; }
}
