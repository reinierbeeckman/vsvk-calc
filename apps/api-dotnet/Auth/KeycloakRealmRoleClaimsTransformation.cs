using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;

namespace Vsvk.Api.Auth;

/// <summary>
/// Keycloak puts realm roles in the nested claim: realm_access.roles[].
/// ASP.NET expects role claims to be flattened to ClaimTypes.Role.
/// </summary>
public sealed class KeycloakRealmRoleClaimsTransformation : IClaimsTransformation
{
  public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
  {
    var identity = principal.Identity as ClaimsIdentity;
    if (identity is null || identity.IsAuthenticated != true)
    {
      return Task.FromResult(principal);
    }

    var realmAccess = principal.FindFirst("realm_access")?.Value;
    if (string.IsNullOrWhiteSpace(realmAccess))
    {
      return Task.FromResult(principal);
    }

    try
    {
      using var doc = JsonDocument.Parse(realmAccess);
      if (!doc.RootElement.TryGetProperty("roles", out var rolesElement) || rolesElement.ValueKind != JsonValueKind.Array)
      {
        return Task.FromResult(principal);
      }

      foreach (var roleEl in rolesElement.EnumerateArray())
      {
        var role = roleEl.GetString();
        if (string.IsNullOrWhiteSpace(role))
        {
          continue;
        }

        if (!principal.IsInRole(role))
        {
          identity.AddClaim(new Claim(ClaimTypes.Role, role));
        }
      }
    }
    catch
    {
      // Ignore malformed JSON.
    }

    return Task.FromResult(principal);
  }
}
