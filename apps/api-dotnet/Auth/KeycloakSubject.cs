using System.Security.Claims;

namespace Vsvk.Api.Auth;

public static class KeycloakSubject
{
  public static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
  {
    var subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
    return Guid.TryParse(subject, out userId);
  }
}
