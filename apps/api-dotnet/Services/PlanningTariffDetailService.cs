using Microsoft.EntityFrameworkCore;
using Vsvk.Api.Db;
using Vsvk.Api.Http;

namespace Vsvk.Api.Services;

/// <summary>Editable fields and current price of one standard rate.</summary>
public sealed record PlanningTariffDetailDto(int Id, int FunctieId, string Functie, bool Actief,
  decimal Prijs, string Eenheid, DateOnly GeldigVanaf, long Version)
{
  public string ETag => StrongEtag.Format(Version);
}

/// <summary>Editable fields of one standard rate.</summary>
public sealed record PlanningTariffDetailRequest(string? Functie, bool? Actief, decimal? Prijs, string? Eenheid, DateOnly? GeldigVanaf);

public interface IPlanningTariffDetailService
{
  Task<PlanningTariffDetailDto?> GetAsync(int id, CancellationToken cancellationToken);
  Task<PlanningTariffDetailDto> CreateAsync(PlanningTariffDetailRequest request, CancellationToken cancellationToken);
  Task<PlanningTariffDetailDto?> SaveAsync(int id, long version, PlanningTariffDetailRequest request, CancellationToken cancellationToken);
}

public sealed class PlanningTariffDetailService(VsvkDbContext context) : IPlanningTariffDetailService
{
  public Task<PlanningTariffDetailDto?> GetAsync(int id, CancellationToken cancellationToken) =>
    context.PlanningStandaardTarieven.AsNoTracking().Where(rate => rate.Id == id)
      .Select(rate => new PlanningTariffDetailDto(rate.Id, rate.FunctieId, rate.Functie.Naam, rate.Functie.Aan,
        rate.Prijs, rate.Eenheid, rate.GeldigVanaf, rate.Version)).FirstOrDefaultAsync(cancellationToken);

  public async Task<PlanningTariffDetailDto> CreateAsync(PlanningTariffDetailRequest request, CancellationToken cancellationToken)
  {
    var rate = new PlanningStandaardTarief
    {
      Functie = new PlanningFunctie { Naam = request.Functie!.Trim(), Aan = request.Actief!.Value },
      Prijs = request.Prijs!.Value, Eenheid = request.Eenheid!.Trim(), GeldigVanaf = request.GeldigVanaf!.Value, Version = 1
    };
    context.PlanningStandaardTarieven.Add(rate);
    await context.SaveChangesAsync(cancellationToken);
    return await GetAsync(rate.Id, cancellationToken)
      ?? throw new InvalidOperationException("Het aangemaakte tarief kon niet worden opgehaald.");
  }

  public async Task<PlanningTariffDetailDto?> SaveAsync(int id, long version, PlanningTariffDetailRequest request, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var functieId = await context.PlanningStandaardTarieven.AsNoTracking().Where(rate => rate.Id == id)
      .Select(rate => (int?)rate.FunctieId).FirstOrDefaultAsync(cancellationToken);
    if (functieId is null) return null;

    await context.Database.ExecuteSqlInterpolatedAsync($"select id from functies where id = {functieId.Value} for update", cancellationToken);
    var changed = await context.PlanningStandaardTarieven
      .Where(rate => rate.Id == id && rate.FunctieId == functieId.Value && rate.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(rate => rate.Prijs, request.Prijs!.Value)
        .SetProperty(rate => rate.Eenheid, request.Eenheid!.Trim())
        .SetProperty(rate => rate.GeldigVanaf, request.GeldigVanaf!.Value)
        .SetProperty(rate => rate.Version, rate => rate.Version + 1), cancellationToken);
    if (changed == 0) return null;

    await context.PlanningFuncties.Where(functie => functie.Id == functieId.Value)
      .ExecuteUpdateAsync(setters => setters.SetProperty(functie => functie.Naam, request.Functie!.Trim())
        .SetProperty(functie => functie.Aan, request.Actief!.Value), cancellationToken);
    var result = await GetAsync(id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return result;
  }
}

