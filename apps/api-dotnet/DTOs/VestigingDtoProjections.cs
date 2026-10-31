using System.Linq.Expressions;
using System.Security.Claims;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;

namespace Vsvk.Api.DTOs;

public static class VestigingDtoProjections
{
    public static Expression<Func<Vestiging, VestigingDto>> GetProjectionForUser(ClaimsPrincipal user)
    {
        if (VsvkRoles.CanViewFinancialVestigingData(user))
        {
            return vestiging => new VestigingDto(
                vestiging.Id, vestiging.Naam, vestiging.Adres, vestiging.Postcode, vestiging.Plaats, vestiging.Telefoon, vestiging.Email, vestiging.KvkNummer,
                vestiging.BtwNummer,
                vestiging.Iban
            );
        }

        // Fallback: application roles without financial-data permissions
        return vestiging => new VestigingDto(
            vestiging.Id, vestiging.Naam, vestiging.Adres, vestiging.Postcode, vestiging.Plaats, vestiging.Telefoon, vestiging.Email, vestiging.KvkNummer,
            null,
            null
        );
    }
}
