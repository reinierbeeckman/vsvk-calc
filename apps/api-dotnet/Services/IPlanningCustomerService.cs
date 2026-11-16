using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public interface IPlanningCustomerService
{
  Task<List<PlanningCustomerListDto>> ListAsync(CancellationToken cancellationToken);
  Task<PlanningCustomerDetailDto?> GetAsync(int id, CancellationToken cancellationToken);
}
