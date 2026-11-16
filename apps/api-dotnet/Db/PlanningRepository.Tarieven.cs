using System.Data;
using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed partial class PlanningRepository
{
  public Task<List<PlanningStandardRateDto>> ListRatesAsync(CancellationToken cancellationToken)
  {
    var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTime.UtcNow, "Europe/Amsterdam"));
    return context.PlanningStandaardTarieven.AsNoTracking()
      .Where(rate => rate.GeldigVanaf <= today && !context.PlanningStandaardTarieven.Any(other =>
        other.FunctieId == rate.FunctieId && other.GeldigVanaf <= today &&
        (other.GeldigVanaf > rate.GeldigVanaf || (other.GeldigVanaf == rate.GeldigVanaf && other.Id > rate.Id))))
      .OrderBy(rate => rate.Functie.Naam).ThenBy(rate => rate.FunctieId)
      .Select(rate => new PlanningStandardRateDto(rate.FunctieId, rate.Functie.Naam, rate.Functie.Aan,
        rate.Functie.Toelichting, rate.Id, rate.Prijs, rate.Eenheid, rate.GeldigVanaf))
      .ToListAsync(cancellationToken);
  }

  public Task<PlanningStandardPriceDto?> GetStandardPriceAsync(int id, CancellationToken cancellationToken) =>
    context.PlanningStandaardTarieven.AsNoTracking().Where(rate => rate.Id == id)
      .Select(rate => new PlanningStandardPriceDto(rate.Prijs, rate.Version)).FirstOrDefaultAsync(cancellationToken);

  public async Task<PlanningStandardPriceDto?> SaveStandardPriceAsync(int id, long version, decimal price, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var updated = await context.PlanningStandaardTarieven.Where(rate => rate.Id == id && rate.Version == version)
      .ExecuteUpdateAsync(setters => setters.SetProperty(rate => rate.Prijs, price)
        .SetProperty(rate => rate.Version, rate => rate.Version + 1), cancellationToken);
    if (updated == 0) return null;
    var result = await GetStandardPriceAsync(id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return result;
  }

  public async Task<PlanningCustomerRatesDto?> GetCustomerRatesAsync(int customerId, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
    var result = await ReadCustomerRatesAsync(customerId, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return result;
  }

  private async Task<PlanningCustomerRatesDto?> ReadCustomerRatesAsync(int customerId, CancellationToken cancellationToken)
  {
    var version = await context.Klanten.AsNoTracking().Where(customer => customer.Id == customerId)
      .Select(customer => (long?)customer.TarievenVersion).FirstOrDefaultAsync(cancellationToken);
    if (version is null) return null;
    var overrides = await context.PlanningKlantTarieven.AsNoTracking().Where(rate => rate.KlantId == customerId)
      .OrderBy(rate => rate.Id)
      .Select(rate => new { rate.FunctieId, rate.Omschrijving, rate.Tarief, rate.Eenheid }).ToListAsync(cancellationToken);
    var rates = overrides.Where(item => item.FunctieId.HasValue)
      .Select(item => new PlanningCustomerRateDto(item.FunctieId!.Value, item.Omschrijving, item.Tarief, item.Eenheid)).ToList();
    var historical = overrides.Where(item => !item.FunctieId.HasValue)
      .Select(item => new PlanningHistoricalRateDto(item.Omschrijving, item.Tarief, item.Eenheid)).ToList();
    return new PlanningCustomerRatesDto(version.Value, rates, historical);
  }

  public async Task<PlanningRatesUpdateResult> SaveCustomerRatesAsync(int customerId, long version,
    List<PlanningRateOverrideRequest> overrides, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var updated = await context.Klanten.Where(customer => customer.Id == customerId && customer.TarievenVersion == version)
      .ExecuteUpdateAsync(setters => setters.SetProperty(customer => customer.TarievenVersion,
        customer => customer.TarievenVersion + 1), cancellationToken);
    if (updated == 0) return new PlanningRatesUpdateResult(null, false);

    var standard = await ListRatesAsync(cancellationToken);
    var existingIds = await context.PlanningKlantTarieven.AsNoTracking()
      .Where(rate => rate.KlantId == customerId && rate.FunctieId != null)
      .Select(rate => rate.FunctieId!.Value).ToListAsync(cancellationToken);
    if (overrides.Any(item => !standard.Any(rate => rate.FunctieId == item.FunctieId && (rate.Actief || existingIds.Contains(rate.FunctieId)))))
      return new PlanningRatesUpdateResult(null, true);

    var standardIds = standard.Select(rate => rate.FunctieId).ToArray();
    await context.PlanningKlantTarieven.Where(rate => rate.KlantId == customerId && rate.FunctieId != null && standardIds.Contains(rate.FunctieId.Value))
      .ExecuteDeleteAsync(cancellationToken);
    foreach (var item in overrides)
    {
      var rate = standard.Single(rate => rate.FunctieId == item.FunctieId);
      context.PlanningKlantTarieven.Add(new PlanningKlantTarief
      {
        KlantId = customerId, FunctieId = item.FunctieId, Omschrijving = rate.Functie,
        Eenheid = rate.Eenheid, Tarief = item.Tarief!.Value
      });
    }
    await context.SaveChangesAsync(cancellationToken);
    var result = await ReadCustomerRatesAsync(customerId, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new PlanningRatesUpdateResult(result, false);
  }
}
