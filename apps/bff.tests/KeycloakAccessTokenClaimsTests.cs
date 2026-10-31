using System.Text;
using Vsvk.Bff.Auth;
using Xunit;

namespace Vsvk.Bff.Tests;

public sealed class KeycloakAccessTokenClaimsTests
{
  [Fact]
  public void GetRealmRoles_returns_roles_from_access_token()
  {
    var token = CreateToken("""{"realm_access":{"roles":["default-roles-vsvk","development"]}}""");

    var roles = KeycloakAccessTokenClaims.GetRealmRoles(token);

    Assert.Equal(new[] { "default-roles-vsvk", "development" }, roles);
  }

  [Fact]
  public void HasApplicationAccess_returns_true_when_default_realm_role_is_present()
  {
    var token = CreateToken("""{"realm_access":{"roles":["default-roles-vsvk","development"]}}""");

    Assert.True(KeycloakAccessTokenClaims.HasApplicationAccess(token));
  }

  [Theory]
  [InlineData("""{"realm_access":{"roles":["development"]}}""")]
  [InlineData("""{"realm_access":{"roles":[]}}""")]
  public void HasApplicationAccess_returns_false_without_default_realm_role(string payload)
  {
    Assert.False(KeycloakAccessTokenClaims.HasApplicationAccess(CreateToken(payload)));
  }

  [Theory]
  [InlineData(null)]
  [InlineData("")]
  [InlineData("not-a-token")]
  [InlineData("header.%%%.signature")]
  public void GetRealmRoles_returns_empty_for_missing_or_malformed_tokens(string? token)
  {
    Assert.Empty(KeycloakAccessTokenClaims.GetRealmRoles(token));
  }

  private static string CreateToken(string payload)
  {
    var encodedPayload = Convert.ToBase64String(Encoding.UTF8.GetBytes(payload))
      .TrimEnd('=')
      .Replace('+', '-')
      .Replace('/', '_');

    return $"header.{encodedPayload}.signature";
  }
}
