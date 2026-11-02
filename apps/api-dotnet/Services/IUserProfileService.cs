using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public interface IUserProfileService
{
  Task<UserProfileRecord> GetOrCreateAsync(Guid subject, CancellationToken cancellationToken);

  Task<UserProfileRecord?> UpdateAsync(
    Guid subject,
    UpdateUserProfileRequest request,
    ProfileSignature? signature,
    bool removeSignature,
    long expectedVersion,
    CancellationToken cancellationToken);
}
