using System.Security.Claims;
using System.Text.Json;

namespace Vsvk.Api.Auth;

public static class VsvkRoles
{
  public const string Default = "default-roles-vsvk";
  public const string Development = "development";
  public const string Directie = "directie";
  public const string Finance = "finance";
  public const string Operationeel = "operationeel";
  public const string Planning = "planning";

  public static bool IsApplicationUser(ClaimsPrincipal user) =>
    user.IsInRole(Default) || HasDefaultRealmRole(user);

  private static bool HasDefaultRealmRole(ClaimsPrincipal user)
  {
    foreach (var realmAccess in user.FindAll("realm_access"))
    {
      try
      {
        using var document = JsonDocument.Parse(realmAccess.Value);
        if (document.RootElement.TryGetProperty("roles", out var roles)
            && roles.ValueKind == JsonValueKind.Array
            && roles.EnumerateArray().Any(role =>
              role.ValueKind == JsonValueKind.String
              && string.Equals(role.GetString(), Default, StringComparison.Ordinal)))
        {
          return true;
        }
      }
      catch (JsonException)
      {
        // Invalid role claims do not grant application access.
      }
    }

    return false;
  }

  public static bool HasOrganizationWideAccess(ClaimsPrincipal user) =>
    user.IsInRole(Directie);

  public static bool CanViewFinancialVestigingData(ClaimsPrincipal user) =>
    user.IsInRole(Directie) || user.IsInRole(Finance);

  public static string? GetVestiging(ClaimsPrincipal user) =>
    user.FindFirstValue("vestiging")
    ?? user.FindFirstValue("vsvk_vestiging")
    ?? user.FindFirstValue("branch")
    ?? user.FindFirstValue("branch_id");

  public static bool HasRequiredVestigingScope(ClaimsPrincipal user) =>
    HasOrganizationWideAccess(user) || !string.IsNullOrWhiteSpace(GetVestiging(user));
}
