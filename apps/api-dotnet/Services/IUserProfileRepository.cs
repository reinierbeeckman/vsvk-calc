using Vsvk.Api.Db;

namespace Vsvk.Api.Services;

public interface IUserProfileRepository
{
  Task<UserProfileRecord> GetOrCreateAsync(Guid subject, CancellationToken cancellationToken);

  Task<UserProfileRecord?> UpdateAsync(
    Guid subject,
    string phoneNumber,
    string alternativeEmail,
    ProfileSignature? signature,
    bool removeSignature,
    long expectedVersion,
    CancellationToken cancellationToken);
}

public sealed record UserProfileRecord(
  Guid Subject,
  string? PhoneNumber,
  string? AlternativeEmail,
  bool HasSignature,
  string? SignatureContentType,
  long Version,
  DateTimeOffset CreatedAt,
  DateTimeOffset UpdatedAt);

public sealed record ProfileSignature(byte[] Content, string ContentType);
