using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public interface IPlanningCustomerService
{
  Task<List<PlanningCustomerListDto>> ListAsync(CancellationToken cancellationToken);
  Task<PlanningCustomerDetailDto?> GetAsync(int id, CancellationToken cancellationToken);
  Task<PlanningCustomerDetailDto?> SaveAsync(int id, long version, PlanningCustomerDetailDto customer, CancellationToken cancellationToken);
  Task<List<PlanningStandardRateDto>> ListRatesAsync(CancellationToken cancellationToken);
  Task<PlanningCustomerRatesDto?> GetRatesAsync(int id, CancellationToken cancellationToken);
  Task<PlanningRatesUpdateResult> SaveRatesAsync(int id, long version, List<PlanningRateOverrideRequest> overrides, CancellationToken cancellationToken);
}
