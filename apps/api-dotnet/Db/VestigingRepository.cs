using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed class VestigingRepository
{
  private readonly VsvkDbContext _context;

  public VestigingRepository(VsvkDbContext context)
  {
    _context = context;
  }

  public async Task<IReadOnlyList<VestigingDto>> ListAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
  {
    var projection = VestigingDtoProjections.GetProjectionForUser(user);

    return await _context.Vestigingen
      .AsNoTracking()
      .OrderBy(v => v.Naam)
      .Select(projection)
      .ToListAsync(cancellationToken);
  }
}
