using Vsvk.Api.Db;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public sealed class PlanningCustomerService(PlanningRepository repository) : IPlanningCustomerService
{
  public Task<List<PlanningCustomerListDto>> ListAsync(CancellationToken cancellationToken) =>
    repository.ListCustomersAsync(cancellationToken);

  public Task<PlanningCustomerDetailDto?> GetAsync(int id, CancellationToken cancellationToken) =>
    repository.GetCustomerAsync(id, cancellationToken);

  public Task<PlanningCustomerDetailDto> CreateAsync(CreatePlanningCustomerRequest request, CancellationToken cancellationToken) =>
    repository.CreateCustomerAsync(request, cancellationToken);

  public Task<PlanningCustomerDetailDto?> SaveAsync(int id, long version, PlanningCustomerDetailDto customer, CancellationToken cancellationToken) =>
    repository.SaveCustomerAsync(id, version, customer, cancellationToken);

  public Task<List<PlanningStandardRateDto>> ListRatesAsync(CancellationToken cancellationToken) =>
    repository.ListRatesAsync(cancellationToken);

  public Task<PlanningCustomerRatesDto?> GetRatesAsync(int id, CancellationToken cancellationToken) =>
    repository.GetCustomerRatesAsync(id, cancellationToken);

  public Task<PlanningRatesUpdateResult> SaveRatesAsync(int id, long version, List<PlanningRateOverrideRequest> overrides, CancellationToken cancellationToken) =>
    repository.SaveCustomerRatesAsync(id, version, overrides, cancellationToken);
}
