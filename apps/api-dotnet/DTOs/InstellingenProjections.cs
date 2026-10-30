using System.Linq.Expressions;
using System.Security.Claims;
using Vsvk.Api.Db;

namespace Vsvk.Api.DTOs;

public static class InstellingenProjections
{
  public static Expression<Func<InstellingenAlgemeen, InstellingenAlgemeenDto>> GetProjectionForUser(ClaimsPrincipal user)
  {
    if (user.IsInRole("manager"))
    {
      return instellingen => new InstellingenAlgemeenDto(
        instellingen.Id,
        instellingen.SysteemNaam,
        instellingen.Version,
        instellingen.Vestigingen
          .OrderBy(vestiging => vestiging.Naam)
          .Select(vestiging => (VestigingDto)new ManagerVestigingDto(
            vestiging.Id,
            vestiging.Naam,
            vestiging.Adres,
            vestiging.Postcode,
            vestiging.Plaats,
            vestiging.Telefoon,
            vestiging.Email,
            vestiging.KvkNummer,
            vestiging.BtwNummer,
            vestiging.Iban))
          .ToList());
    }

    return instellingen => new InstellingenAlgemeenDto(
      instellingen.Id,
      instellingen.SysteemNaam,
      instellingen.Version,
      instellingen.Vestigingen
        .OrderBy(vestiging => vestiging.Naam)
        .Select(vestiging => (VestigingDto)new VestigingDto(
          vestiging.Id,
          vestiging.Naam,
          vestiging.Adres,
          vestiging.Postcode,
          vestiging.Plaats,
          vestiging.Telefoon,
          vestiging.Email,
          vestiging.KvkNummer))
        .ToList());
  }
}
