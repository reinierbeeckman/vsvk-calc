using System.ComponentModel.DataAnnotations;

namespace Vsvk.Api.DTOs;

/// <summary>Profiel en beperkte identiteitsgegevens van de ingelogde Keycloak-gebruiker.</summary>
public sealed record UserProfileResponse(
  Guid Subject,
  string? DisplayName,
  string? UserName,
  string? PrimaryEmail,
  string? PhoneNumber,
  string? AlternativeEmail,
  bool HasSignature,
  string? SignatureContentType,
  bool IsComplete,
  long Version,
  DateTimeOffset CreatedAt,
  DateTimeOffset UpdatedAt);

/// <summary>Contactgegevens die de ingelogde gebruiker voor het eigen profiel opslaat.</summary>
public sealed record UpdateUserProfileRequest
{
  [Required, Phone, StringLength(32)]
  public required string PhoneNumber { get; init; }

  [Required, EmailAddress, StringLength(254)]
  public required string AlternativeEmail { get; init; }
}
