using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Hosting;

namespace Vsvk.Api.Auth;

/// <summary>
/// Keycloak puts realm roles in the nested claim: realm_access.roles[].
/// ASP.NET expects role claims to be flattened to ClaimTypes.Role.
/// </summary>
public sealed class KeycloakRealmRoleClaimsTransformation(IHostEnvironment environment, IConfiguration configuration) : IClaimsTransformation
{
  public Task<ClaimsPrincipal> TransformAsync(ClaimsPrincipal principal)
  {
    var identity = principal.Identity as ClaimsIdentity;
    if (identity is null || identity.IsAuthenticated != true)
    {
      return Task.FromResult(principal);
    }

    var realmAccess = principal.FindFirst("realm_access")?.Value;
    if (!string.IsNullOrWhiteSpace(realmAccess))
    {
      try
      {
        using var doc = JsonDocument.Parse(realmAccess);
        if (doc.RootElement.ValueKind == JsonValueKind.Object
            && doc.RootElement.TryGetProperty("roles", out var rolesElement) && rolesElement.ValueKind == JsonValueKind.Array)
        {
          foreach (var roleEl in rolesElement.EnumerateArray())
          {
            if (roleEl.ValueKind != JsonValueKind.String) continue;
            var role = roleEl.GetString();
            if (!string.IsNullOrWhiteSpace(role) && !principal.IsInRole(role))
            {
              identity.AddClaim(new Claim(ClaimTypes.Role, role));
            }
          }
        }
      }
      catch (JsonException)
      {
      }
    }

    if (environment.IsDevelopment() && configuration.GetValue<bool>("DevelopmentAccess:Enabled")
        && principal.IsInRole(VsvkRoles.Development)
        && VsvkRoles.IsApplicationUser(principal) && !principal.IsInRole(VsvkRoles.Directie))
    {
      identity.AddClaim(new Claim(ClaimTypes.Role, VsvkRoles.Directie, ClaimValueTypes.String, "vsvk-development"));
    }

    return Task.FromResult(principal);
  }
}
