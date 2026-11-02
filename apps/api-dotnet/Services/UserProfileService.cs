using System.ComponentModel.DataAnnotations;
using Vsvk.Api.DTOs;
using Vsvk.Api.Db;

namespace Vsvk.Api.Services;

public sealed class UserProfileService(IUserProfileRepository repository) : IUserProfileService
{
  public const int MaximumSignatureBytes = 1_048_576;

  public Task<UserProfileRecord> GetOrCreateAsync(Guid subject, CancellationToken cancellationToken)
    => repository.GetOrCreateAsync(subject, cancellationToken);

  public async Task<UserProfileRecord?> UpdateAsync(
    Guid subject,
    UpdateUserProfileRequest request,
    ProfileSignature? signature,
    bool removeSignature,
    long expectedVersion,
    CancellationToken cancellationToken)
  {
    var normalized = request with
    {
      PhoneNumber = request.PhoneNumber?.Trim() ?? string.Empty,
      AlternativeEmail = request.AlternativeEmail?.Trim() ?? string.Empty
    };

    ValidateRequest(normalized, signature, removeSignature);

    await repository.GetOrCreateAsync(subject, cancellationToken);
    return await repository.UpdateAsync(
      subject,
      normalized.PhoneNumber,
      normalized.AlternativeEmail,
      signature,
      removeSignature,
      expectedVersion,
      cancellationToken);
  }

  private static void ValidateRequest(
    UpdateUserProfileRequest request,
    ProfileSignature? signature,
    bool removeSignature)
  {
    var validationResults = new List<ValidationResult>();
    if (!Validator.TryValidateObject(request, new ValidationContext(request), validationResults, validateAllProperties: true))
    {
      throw UserProfileValidationException.From(validationResults);
    }

    if (signature is not null && removeSignature)
    {
      throw UserProfileValidationException.For("signature", "Upload een handtekening of verwijder de bestaande handtekening, niet allebei.");
    }

    if (signature is null)
    {
      return;
    }

    if (signature.Content.Length is 0 or > MaximumSignatureBytes)
    {
      throw UserProfileValidationException.For("signature", "De handtekening mag maximaal 1 MB groot zijn.");
    }

    var contentType = signature.ContentType.ToLowerInvariant();
    var validPng = contentType == "image/png"
      && signature.Content.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
    var validJpeg = contentType == "image/jpeg"
      && signature.Content.Length >= 3
      && signature.Content[0] == 0xFF
      && signature.Content[1] == 0xD8
      && signature.Content[2] == 0xFF;

    if (!validPng && !validJpeg)
    {
      throw UserProfileValidationException.For("signature", "Upload een geldige PNG- of JPEG-afbeelding.");
    }
  }
}

public static class UserProfileRules
{
  public static bool IsComplete(string? phoneNumber, string? alternativeEmail)
    => !string.IsNullOrWhiteSpace(phoneNumber)
      && !string.IsNullOrWhiteSpace(alternativeEmail);
}

public sealed class UserProfileValidationException(IReadOnlyDictionary<string, string[]> errors) : Exception("The profile request is invalid.")
{
  public IReadOnlyDictionary<string, string[]> Errors { get; } = errors;

  public static UserProfileValidationException From(IEnumerable<ValidationResult> results)
  {
    var errors = results
      .SelectMany(result => (result.MemberNames.Any() ? result.MemberNames : ["profile"])
        .Select(member => (Member: member, Message: result.ErrorMessage ?? "De waarde is ongeldig.")))
      .GroupBy(item => item.Member)
      .ToDictionary(group => group.Key, group => group.Select(item => item.Message).Distinct().ToArray());

    return new UserProfileValidationException(errors);
  }

  public static UserProfileValidationException For(string field, string message)
    => new(new Dictionary<string, string[]> { [field] = [message] });
}
