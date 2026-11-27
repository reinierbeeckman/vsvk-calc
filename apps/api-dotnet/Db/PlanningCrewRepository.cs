using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

/// <summary>
/// Ploegen voor het planbord. Een ploeg (naam, leden, materieel) is één aggregate:
/// elke wijziging controleert de versie en vervangt de onderdelen in dezelfde transactie.
/// </summary>
public sealed class PlanningCrewRepository(VsvkDbContext context)
{
  /// <param name="branchId">Vestiging van de gebruiker; <c>null</c> = alle vestigingen.</param>
  public Task<List<PlanningCrewDto>> ListAsync(Guid? branchId, CancellationToken cancellationToken) =>
    Project(context.Ploegen.AsNoTracking()
        .Where(crew => branchId == null || crew.VestigingId == null || crew.VestigingId == branchId)
        .OrderBy(crew => crew.Naam).ThenBy(crew => crew.Id))
      .ToListAsync(cancellationToken);

  public Task<PlanningCrewDto?> GetAsync(Guid id, CancellationToken cancellationToken) =>
    Project(context.Ploegen.AsNoTracking().Where(crew => crew.Id == id)).SingleOrDefaultAsync(cancellationToken);

  /// <summary>Mag een gebruiker van <paramref name="branchId"/> deze ploeg wijzigen? (eigen vestiging of gedeeld)</summary>
  public Task<bool> IsVisibleAsync(Guid id, Guid branchId, CancellationToken cancellationToken) =>
    context.Ploegen.AsNoTracking()
      .AnyAsync(crew => crew.Id == id && (crew.VestigingId == null || crew.VestigingId == branchId), cancellationToken);

  public async Task<PlanningCrewSaveResult> CreateAsync(
    PlanningCrewWriteDto request, CancellationToken cancellationToken)
  {
    if (!await ReferencesExistAsync(request, cancellationToken)) return new(PlanningBoardSaveStatus.Invalid, null);
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var crew = new Ploeg { Id = Guid.NewGuid(), Naam = request.Naam!.Trim(), VestigingId = request.VestigingId, Version = 1 };
    context.Ploegen.Add(crew);
    AddChildren(crew.Id, request);
    await context.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, await GetAsync(crew.Id, cancellationToken));
  }

  public async Task<PlanningCrewSaveResult> SaveAsync(
    Guid id, long version, PlanningCrewWriteDto request, CancellationToken cancellationToken)
  {
    if (!await ReferencesExistAsync(request, cancellationToken)) return new(PlanningBoardSaveStatus.Invalid, null);
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var naam = request.Naam!.Trim();
    var updated = await context.Ploegen.Where(crew => crew.Id == id && crew.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(crew => crew.Version, crew => crew.Version + 1)
        .SetProperty(crew => crew.Naam, naam), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.Ploegen.AsNoTracking().AnyAsync(crew => crew.Id == id, cancellationToken);
      return new(exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound, null);
    }
    await context.PloegLeden.Where(item => item.PloegId == id).ExecuteDeleteAsync(cancellationToken);
    await context.PloegMaterieelItems.Where(item => item.PloegId == id).ExecuteDeleteAsync(cancellationToken);
    AddChildren(id, request);
    await context.SaveChangesAsync(cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, await GetAsync(id, cancellationToken));
  }

  public async Task<PlanningBoardSaveStatus> DeleteAsync(Guid id, long version, CancellationToken cancellationToken)
  {
    var deleted = await context.Ploegen.Where(crew => crew.Id == id && crew.Version == version)
      .ExecuteDeleteAsync(cancellationToken);
    if (deleted > 0) return PlanningBoardSaveStatus.Saved;
    var exists = await context.Ploegen.AsNoTracking().AnyAsync(crew => crew.Id == id, cancellationToken);
    return exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound;
  }

  private void AddChildren(Guid crewId, PlanningCrewWriteDto request)
  {
    var members = request.Leden ?? [];
    for (var index = 0; index < members.Count; index++)
      context.PloegLeden.Add(new PloegLid { PloegId = crewId, MedewerkerId = members[index], Sorteervolgorde = index });
    var equipment = request.Materieel ?? [];
    for (var index = 0; index < equipment.Count; index++)
      context.PloegMaterieelItems.Add(new PloegMaterieel
      {
        PloegId = crewId, MaterieelId = equipment[index].MaterieelId,
        MedewerkerId = equipment[index].MedewerkerId, Sorteervolgorde = index
      });
  }

  private async Task<bool> ReferencesExistAsync(PlanningCrewWriteDto request, CancellationToken cancellationToken)
  {
    var members = (request.Leden ?? []).Distinct().ToList();
    var equipment = (request.Materieel ?? []).Select(item => item.MaterieelId).Distinct().ToList();
    if (members.Count > 0 && await context.UserInformation.AsNoTracking()
          .CountAsync(item => members.Contains(item.KeycloakSubject), cancellationToken) != members.Count)
      return false;
    if (equipment.Count > 0 && await context.MaterieelItems.AsNoTracking()
          .CountAsync(item => equipment.Contains(item.Id), cancellationToken) != equipment.Count)
      return false;
    return request.VestigingId is not { } branchId ||
      await context.Vestigingen.AsNoTracking().AnyAsync(item => item.Id == branchId, cancellationToken);
  }

  private static IQueryable<PlanningCrewDto> Project(IQueryable<Ploeg> query) =>
    query.Select(crew => new PlanningCrewDto(
      crew.Id, crew.Naam, crew.VestigingId,
      crew.Leden.OrderBy(item => item.Sorteervolgorde).Select(item => item.MedewerkerId).ToList(),
      crew.Materieel.OrderBy(item => item.Sorteervolgorde)
        .Select(item => new PlanningCrewEquipmentDto(item.MaterieelId, item.MedewerkerId)).ToList(),
      crew.Version));
}
