using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public interface IPlanningMaterieelMutationRepository
{
  Task<PlanningMaterieelEditDto?> GetAsync(Guid id, CancellationToken cancellationToken);
  Task<PlanningMaterieelReferencesDto> GetReferencesAsync(CancellationToken cancellationToken);
  Task<PlanningMaterieelSaveResult> CreateAsync(PlanningMaterieelUpdateRequest request, CancellationToken cancellationToken);
  Task<PlanningMaterieelSaveResult> SaveAsync(Guid id, long version, PlanningMaterieelUpdateRequest request, CancellationToken cancellationToken);
}

public sealed class PlanningMaterieelMutationRepository(VsvkDbContext context) : IPlanningMaterieelMutationRepository
{
  public Task<PlanningMaterieelEditDto?> GetAsync(Guid id, CancellationToken cancellationToken) =>
    context.MaterieelItems.AsNoTracking().Where(item => item.Id == id)
      .Select(item => new PlanningMaterieelEditDto(item.Id, item.Omschrijving, item.Kenteken, item.Merk,
        item.Zoeknaam, item.Serienummer, item.StandplaatsId, item.MaterieelGroepId, item.Version))
      .FirstOrDefaultAsync(cancellationToken);

  public async Task<PlanningMaterieelReferencesDto> GetReferencesAsync(CancellationToken cancellationToken)
  {
    var groups = await context.MaterieelGroepen.AsNoTracking().OrderBy(group => group.Omschrijving).ThenBy(group => group.Id)
      .Select(group => new PlanningMaterieelReferenceDto(group.Id, group.Omschrijving)).ToListAsync(cancellationToken);
    var branches = await context.Vestigingen.AsNoTracking().OrderBy(branch => branch.Naam).ThenBy(branch => branch.Id)
      .Select(branch => new PlanningMaterieelReferenceDto(branch.Id, branch.Naam)).ToListAsync(cancellationToken);
    return new PlanningMaterieelReferencesDto(groups, branches);
  }

  public async Task<PlanningMaterieelSaveResult> CreateAsync(PlanningMaterieelUpdateRequest request, CancellationToken cancellationToken)
  {
    if ((request.StandplaatsId is Guid branch && !await context.Vestigingen.AnyAsync(item => item.Id == branch, cancellationToken)) ||
        (request.MaterieelGroepId is Guid group && !await context.MaterieelGroepen.AnyAsync(item => item.Id == group, cancellationToken)))
      return new PlanningMaterieelSaveResult(null, true);

    var item = new Materieel
    {
      Id = Guid.NewGuid(), Omschrijving = request.Omschrijving, Kenteken = request.Kenteken, Merk = request.Merk,
      Zoeknaam = request.Zoeknaam, Serienummer = request.Serienummer, StandplaatsId = request.StandplaatsId,
      MaterieelGroepId = request.MaterieelGroepId, Version = 1
    };
    context.MaterieelItems.Add(item);
    try
    {
      await context.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.ForeignKeyViolation })
    {
      return new PlanningMaterieelSaveResult(null, true);
    }
    return new PlanningMaterieelSaveResult(await GetAsync(item.Id, cancellationToken), false);
  }

  public async Task<PlanningMaterieelSaveResult> SaveAsync(Guid id, long version, PlanningMaterieelUpdateRequest request, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    try
    {
      var updated = await context.MaterieelItems.Where(item => item.Id == id && item.Version == version
          && (request.StandplaatsId == null || context.Vestigingen.Any(branch => branch.Id == request.StandplaatsId))
          && (request.MaterieelGroepId == null || context.MaterieelGroepen.Any(group => group.Id == request.MaterieelGroepId)))
        .ExecuteUpdateAsync(setters => setters
          .SetProperty(item => item.Omschrijving, request.Omschrijving)
          .SetProperty(item => item.Kenteken, request.Kenteken)
          .SetProperty(item => item.Merk, request.Merk)
          .SetProperty(item => item.Zoeknaam, request.Zoeknaam)
          .SetProperty(item => item.Serienummer, request.Serienummer)
          .SetProperty(item => item.StandplaatsId, request.StandplaatsId)
          .SetProperty(item => item.MaterieelGroepId, request.MaterieelGroepId)
          .SetProperty(item => item.Version, item => item.Version + 1), cancellationToken);
      if (updated == 0)
      {
        var current = await GetAsync(id, cancellationToken);
        return new PlanningMaterieelSaveResult(null, current?.Version == version);
      }
      var result = await GetAsync(id, cancellationToken);
      await transaction.CommitAsync(cancellationToken);
      return new PlanningMaterieelSaveResult(result, false);
    }
    catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.ForeignKeyViolation)
    {
      await transaction.RollbackAsync(cancellationToken);
      return new PlanningMaterieelSaveResult(null, true);
    }
  }
}
