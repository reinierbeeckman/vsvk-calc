using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public enum PlanningEmployeeUpdateStatus { Saved, NotFound, Conflict, Invalid }

public sealed record PlanningEmployeeUpdateResult(PlanningEmployeeDto? Employee, PlanningEmployeeUpdateStatus Status);

public interface IPlanningEmployeeDevelopmentRepository
{
  Task<PlanningEmployeeUpdateResult> SaveAsync(Guid id, long expectedVersion, PlanningEmployeeUpdateRequest request, CancellationToken cancellationToken);
  Task<List<PlanningEmployeeLookupDto>> ListSkillsAsync(CancellationToken cancellationToken);
  Task<List<PlanningEmployeeLookupDto>> ListBranchesAsync(CancellationToken cancellationToken);
}
