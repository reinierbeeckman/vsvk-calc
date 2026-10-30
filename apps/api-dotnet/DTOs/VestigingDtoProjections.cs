using System.Linq.Expressions;
using System.Security.Claims;
using Vsvk.Api.Db; // Bevat de 'Vestiging' database entiteit

namespace Vsvk.Api.DTOs;

public static class VestigingDtoProjections
{
    public static Expression<Func<Vestiging, VestigingDto>> GetProjectionForUser(ClaimsPrincipal user)
    {
        // 1. Toekomstige rol: bijvoorbeeld Auditor (ziet alles behalve bankgegevens)
        if (user.IsInRole("auditor"))
        {
            // return auditor specifieke expressie...
        }

        // 2. Rol: Manager (Volledige financiële data)
        if (user.IsInRole("manager"))
        {
            return v => new ManagerVestigingDto(
                v.Id, v.Naam, v.Adres, v.Postcode, v.Plaats, v.Telefoon, v.Email, v.KvkNummer, v.BtwNummer, v.Iban
            );
        }

        // 3. Default Fallback: Reguliere medewerker / Onbekende rol (Meest restrictief)
        return v => new VestigingDto(
            v.Id, v.Naam, v.Adres, v.Postcode, v.Plaats, v.Telefoon, v.Email, v.KvkNummer
        );
    }
}
