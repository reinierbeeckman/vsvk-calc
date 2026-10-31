using System.Security.Claims;
using Vsvk.Api.Auth;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class VsvkRolesTests
{
  private static ClaimsPrincipal CreateUser(params string[] roles) => new(
    new ClaimsIdentity(roles.Select(role => new Claim(ClaimTypes.Role, role)), "test"));

  [Theory]
  [InlineData("development")]
  [InlineData("directie")]
  [InlineData("finance")]
  [InlineData("operationeel")]
  [InlineData("planning")]
  public void CurrentBusinessRolesCanAccessTheApplication(string role)
  {
    Assert.True(VsvkRoles.IsApplicationUser(CreateUser(VsvkRoles.Default, role)));
  }

  [Fact]
  public void DefaultRoleAloneGrantsApplicationAccess()
  {
    Assert.True(VsvkRoles.IsApplicationUser(CreateUser(VsvkRoles.Default)));
  }

  [Theory]
  [InlineData("development")]
  [InlineData("directie")]
  [InlineData("finance")]
  [InlineData("operationeel")]
  [InlineData("planning")]
  public void BusinessRoleWithoutInheritedDefaultRoleIsDenied(string role)
  {
    Assert.False(VsvkRoles.IsApplicationUser(CreateUser(role)));
  }

  [Theory]
  [InlineData("employee")]
  [InlineData("manager")]
  [InlineData("accountant")]
  [InlineData("unknown")]
  public void RetiredOrUnknownRolesDoNotAccessTheApplication(string role)
  {
    Assert.False(VsvkRoles.IsApplicationUser(CreateUser(role)));
  }

  [Theory]
  [InlineData("directie", true)]
  [InlineData("finance", false)]
  [InlineData("development", false)]
  [InlineData("operationeel", false)]
  [InlineData("planning", false)]
  [InlineData("manager", false)]
  public void OnlyDirectieHasOrganizationWideAccess(string role, bool expected)
  {
    Assert.Equal(expected, VsvkRoles.HasOrganizationWideAccess(CreateUser(role)));
  }

  [Theory]
  [InlineData("directie", true)]
  [InlineData("finance", true)]
  [InlineData("development", false)]
  [InlineData("operationeel", false)]
  [InlineData("planning", false)]
  [InlineData("manager", false)]
  public void FinancialVestigingFieldsAreLimitedToFinanceAndDirectie(string role, bool expected)
  {
    Assert.Equal(expected, VsvkRoles.CanViewFinancialVestigingData(CreateUser(role)));
  }

  [Theory]
  [InlineData("directie", true)]
  [InlineData("finance", false)]
  [InlineData("development", false)]
  [InlineData("operationeel", false)]
  [InlineData("planning", false)]
  public void VestigingScopeIsRequiredUnlessUserHasOrganizationWideAccess(string role, bool expected)
  {
    Assert.Equal(expected, VsvkRoles.HasRequiredVestigingScope(CreateUser(role)));
  }

  [Fact]
  public void BranchClaimProvidesVestigingScope()
  {
    var user = new ClaimsPrincipal(new ClaimsIdentity(
    [
      new Claim(ClaimTypes.Role, VsvkRoles.Default),
      new Claim(ClaimTypes.Role, "operationeel"),
      new Claim("vestiging", "VSVK Pijnacker BV")
    ], "test"));

    Assert.True(VsvkRoles.HasRequiredVestigingScope(user));
    Assert.Equal("VSVK Pijnacker BV", VsvkRoles.GetVestiging(user));
  }
}
