using System.Text.Json;
using Microsoft.IdentityModel.Tokens;

namespace Vsvk.Bff.Auth;

public static class KeycloakAccessTokenClaims
{
  public const string ApplicationAccessRole = "default-roles-vsvk";

  public static IReadOnlyList<string> GetRealmRoles(string? accessToken)
  {
    if (string.IsNullOrWhiteSpace(accessToken))
    {
      return Array.Empty<string>();
    }

    var tokenParts = accessToken.Split('.');
    if (tokenParts.Length != 3)
    {
      return Array.Empty<string>();
    }

    try
    {
      using var payload = JsonDocument.Parse(Base64UrlEncoder.DecodeBytes(tokenParts[1]));
      if (!payload.RootElement.TryGetProperty("realm_access", out var realmAccess)
          || !realmAccess.TryGetProperty("roles", out var roles)
          || roles.ValueKind != JsonValueKind.Array)
      {
        return Array.Empty<string>();
      }

      return roles.EnumerateArray()
        .Where(role => role.ValueKind == JsonValueKind.String)
        .Select(role => role.GetString())
        .Where(role => !string.IsNullOrWhiteSpace(role))
        .Select(role => role!)
        .Distinct(StringComparer.Ordinal)
        .ToArray();
    }
    catch (FormatException)
    {
      return Array.Empty<string>();
    }
    catch (JsonException)
    {
      return Array.Empty<string>();
    }
  }

  public static bool HasApplicationAccess(string? accessToken) =>
    GetRealmRoles(accessToken).Contains(ApplicationAccessRole, StringComparer.Ordinal);
}
