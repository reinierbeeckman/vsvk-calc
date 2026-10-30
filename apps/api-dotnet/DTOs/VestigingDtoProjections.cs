using System.Linq.Expressions;
using System.Security.Claims;
using Vsvk.Api.Db;

namespace Vsvk.Api.DTOs;

public static class VestigingDtoProjections
{
    public static Expression<Func<Vestiging, VestigingDto>> GetProjectionForUser(ClaimsPrincipal user)
    {
        bool isManager = user.IsInRole("manager");
        bool isAccountant = user.IsInRole("accountant");

        // Evaluatie vindt plaats in C#, EF vertaalt alleen de gekozen expressie naar SQL
        /*
        if (isAccountant)
        {
            return vestiging => new VestigingDto(
                vestiging.Id, vestiging.Naam, vestiging.Adres, vestiging.Postcode, vestiging.Plaats, vestiging.Telefoon, vestiging.Email, vestiging.KvkNummer,
                vestiging.BtwNummer,
                vestiging.Iban,
                vestiging.AccountantCode // Specifiek veld voor accountant
            );
        }
        */

        if (isManager)
        {
            return vestiging => new VestigingDto(
                vestiging.Id, vestiging.Naam, vestiging.Adres, vestiging.Postcode, vestiging.Plaats, vestiging.Telefoon, vestiging.Email, vestiging.KvkNummer,
                vestiging.BtwNummer,
                vestiging.Iban
            );
        }

        // Default: Gewone medewerker / basis permissies
        return vestiging => new VestigingDto(
            vestiging.Id, vestiging.Naam, vestiging.Adres, vestiging.Postcode, vestiging.Plaats, vestiging.Telefoon, vestiging.Email, vestiging.KvkNummer,
            null,
            null
        );
    }
}
