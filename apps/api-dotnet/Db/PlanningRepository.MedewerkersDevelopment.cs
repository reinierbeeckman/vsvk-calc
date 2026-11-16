using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed partial class PlanningRepository : IPlanningEmployeeDevelopmentRepository
{
  public Task<List<PlanningEmployeeLookupDto>> ListSkillsAsync(CancellationToken cancellationToken) =>
    context.Skills.AsNoTracking().OrderBy(skill => skill.Name)
      .Select(skill => new PlanningEmployeeLookupDto(skill.Name)).ToListAsync(cancellationToken);

  public Task<List<PlanningEmployeeLookupDto>> ListBranchesAsync(CancellationToken cancellationToken) =>
    context.Vestigingen.AsNoTracking().OrderBy(branch => branch.Naam)
      .Select(branch => new PlanningEmployeeLookupDto(branch.Naam)).Distinct().ToListAsync(cancellationToken);

  public async Task<PlanningEmployeeUpdateResult> SaveAsync(Guid id, long expectedVersion,
    PlanningEmployeeUpdateRequest request, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    Guid? branchId = null;
    if (request.Vestiging is not null)
    {
      var branches = await context.Vestigingen.AsNoTracking().Where(branch => branch.Naam == request.Vestiging)
        .Select(branch => branch.Id).Take(2).ToListAsync(cancellationToken);
      if (branches.Count != 1) return new(null, PlanningEmployeeUpdateStatus.Invalid);
      branchId = branches[0];
    }
    var names = request.Skills!.Select(skill => skill.Naam).ToList();
    var skills = await context.Skills.AsNoTracking().Where(skill => names.Contains(skill.Name))
      .Select(skill => new { skill.Id, skill.Name }).ToListAsync(cancellationToken);
    if (skills.Count != names.Count) return new(null, PlanningEmployeeUpdateStatus.Invalid);
    var skillIds = skills.ToDictionary(skill => skill.Name, skill => skill.Id, StringComparer.Ordinal);
    if (names.Any(name => !skillIds.ContainsKey(name))) return new(null, PlanningEmployeeUpdateStatus.Invalid);

    var updated = await context.UserInformation.Where(employee => employee.KeycloakSubject == id && employee.Version == expectedVersion)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(employee => employee.EmployeeNumber, request.Personeelsnummer)
        .SetProperty(employee => employee.DisplayName, request.Naam)
        .SetProperty(employee => employee.JobTitle, request.Functie)
        .SetProperty(employee => employee.PhoneNumber, request.Telefoon)
        .SetProperty(employee => employee.EmailAddress, request.Email)
        .SetProperty(employee => employee.VestigingId, branchId)
        .SetProperty(employee => employee.IsActive, request.Actief!.Value)
        .SetProperty(employee => employee.Version, employee => employee.Version + 1)
        .SetProperty(employee => employee.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.UserInformation.AsNoTracking().AnyAsync(employee => employee.KeycloakSubject == id, cancellationToken);
      return new(null, exists ? PlanningEmployeeUpdateStatus.Conflict : PlanningEmployeeUpdateStatus.NotFound);
    }
    await context.Set<UserInformationSkill>().Where(skill => skill.KeycloakSubject == id).ExecuteDeleteAsync(cancellationToken);
    context.Set<UserInformationSkill>().AddRange(request.Skills!.Select(skill => new UserInformationSkill
    {
      KeycloakSubject = id, SkillId = skillIds[skill.Naam], DiplomaOn = skill.DiplomaOp, ValidUntil = skill.GeldigTot
    }));
    await context.SaveChangesAsync(cancellationToken);
    var employee = await GetEmployeeAsync(id, null, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(employee, PlanningEmployeeUpdateStatus.Saved);
  }
}
