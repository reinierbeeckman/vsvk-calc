using System.Security.Claims;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Vsvk.Api.Auth;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class DevelopmentAccessTests
{
  [Theory]
  [InlineData("Development", true)]
  [InlineData("Staging", false)]
  [InlineData("Production", false)]
  public async Task DeveloperGetsEffectiveDirectieRightsOnlyInDevelopment(string environment, bool expected)
  {
    var user = User(true, VsvkRoles.Default, VsvkRoles.Development);
    await Transformation(environment).TransformAsync(user);
    Assert.Equal(expected, user.IsInRole(VsvkRoles.Directie));
    Assert.Equal(expected, VsvkRoles.CanManagePlanning(user));
    Assert.Equal(expected, VsvkRoles.HasOrganizationWideAccess(user));
    Assert.Equal(expected, VsvkRoles.CanViewFinancialVestigingData(user));
  }

  [Theory]
  [InlineData(true, "development")]
  [InlineData(true, "default-roles-vsvk")]
  [InlineData(false, "development", "default-roles-vsvk")]
  public async Task MissingRoleOrAuthenticationNeverGrantsDevelopmentRights(bool authenticated, params string[] roles)
  {
    var user = User(authenticated, roles);
    await Transformation("Development").TransformAsync(user);
    Assert.False(user.IsInRole(VsvkRoles.Directie));
  }

  [Fact]
  public async Task RealmRolesAreFlattenedBeforeDevelopmentRightsAreGranted()
  {
    var user = new ClaimsPrincipal(new ClaimsIdentity(
      [new Claim("realm_access", "{\"roles\":[\"default-roles-vsvk\",\"development\"]}")], "test"));
    var transformation = Transformation("Development");
    await transformation.TransformAsync(user);
    await transformation.TransformAsync(user);
    Assert.True(user.IsInRole(VsvkRoles.Directie));
    Assert.Single(user.FindAll(ClaimTypes.Role).Where(claim => claim.Value == VsvkRoles.Directie));
  }

  [Fact]
  public async Task DeveloperIsNotElevatedWhenTheDevelopmentOverrideIsDisabled()
  {
    var user = User(true, VsvkRoles.Default, VsvkRoles.Development);
    await Transformation("Development", false).TransformAsync(user);
    Assert.False(user.IsInRole(VsvkRoles.Directie));
  }

  private static KeycloakRealmRoleClaimsTransformation Transformation(string environment, bool enabled = true) => new(
    new TestEnvironment(environment),
    new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
    {
      ["DevelopmentAccess:Enabled"] = enabled.ToString()
    }).Build());

  private static ClaimsPrincipal User(bool authenticated, params string[] roles) => new(
    new ClaimsIdentity(roles.Select(role => new Claim(ClaimTypes.Role, role)), authenticated ? "test" : null));

  private sealed class TestEnvironment(string environment) : IHostEnvironment
  {
    public string EnvironmentName { get; set; } = environment;
    public string ApplicationName { get; set; } = "test";
    public string ContentRootPath { get; set; } = ".";
    public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
  }
}
