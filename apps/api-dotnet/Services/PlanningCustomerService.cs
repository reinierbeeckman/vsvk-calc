using Vsvk.Api.Db;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public sealed class PlanningCustomerService(PlanningRepository repository) : IPlanningCustomerService
{
  public Task<List<PlanningCustomerListDto>> ListAsync(CancellationToken cancellationToken) =>
    repository.ListCustomersAsync(cancellationToken);

  public Task<PlanningCustomerDetailDto?> GetAsync(int id, CancellationToken cancellationToken) =>
    repository.GetCustomerAsync(id, cancellationToken);
}
