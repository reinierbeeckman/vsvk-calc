namespace Vsvk.Api.DTOs;

/// <summary>Volledige wijziging van de bestaande planningsgegevens en vaardigheden van een medewerker.</summary>
public sealed record PlanningEmployeeUpdateRequest(
  string? Personeelsnummer, string? Naam, string? Functie, string? Telefoon, string? Email,
  string? Vestiging, bool? Actief, List<PlanningSkillDto>? Skills);

/// <summary>Naam van een bestaande vestiging of vaardigheid.</summary>
public sealed record PlanningEmployeeLookupDto(string Naam);
