using Vsvk.Api.DTOs;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class UserProfileServiceTests
{
  [Theory]
  [InlineData("", "contact@example.nl")]
  [InlineData("   ", "contact@example.nl")]
  [InlineData("+31 6 12345678", "")]
  [InlineData("+31 6 12345678", "not-an-email")]
  public async Task Update_rejects_missing_or_invalid_required_contact_fields(string phone, string email)
  {
    var repository = new FakeUserProfileRepository();
    var service = new UserProfileService(repository);

    await Assert.ThrowsAsync<UserProfileValidationException>(() => service.UpdateAsync(
      Guid.NewGuid(),
      new UpdateUserProfileRequest { PhoneNumber = phone, AlternativeEmail = email },
      null,
      removeSignature: false,
      expectedVersion: 1,
      CancellationToken.None));

    Assert.False(repository.UpdateCalled);
  }

  [Fact]
  public async Task Get_or_create_returns_an_incomplete_empty_profile_for_first_login()
  {
    var service = new UserProfileService(new FakeUserProfileRepository());

    var profile = await service.GetOrCreateAsync(Guid.NewGuid(), CancellationToken.None);

    Assert.Null(profile.PhoneNumber);
    Assert.Null(profile.AlternativeEmail);
    Assert.False(profile.HasSignature);
    Assert.False(UserProfileRules.IsComplete(profile.PhoneNumber, profile.AlternativeEmail));
  }

  [Fact]
  public async Task Update_allows_a_profile_without_a_digital_signature()
  {
    var repository = new FakeUserProfileRepository();
    var service = new UserProfileService(repository);

    var updated = await service.UpdateAsync(
      Guid.NewGuid(),
      new UpdateUserProfileRequest { PhoneNumber = "+31 6 12345678", AlternativeEmail = "contact@example.nl" },
      null,
      removeSignature: false,
      expectedVersion: 1,
      CancellationToken.None);

    Assert.NotNull(updated);
    Assert.False(updated.HasSignature);
    Assert.True(UserProfileRules.IsComplete(updated.PhoneNumber, updated.AlternativeEmail));
  }

  [Fact]
  public async Task Update_rejects_non_image_signature_data()
  {
    var service = new UserProfileService(new FakeUserProfileRepository());

    await Assert.ThrowsAsync<UserProfileValidationException>(() => service.UpdateAsync(
      Guid.NewGuid(),
      new UpdateUserProfileRequest { PhoneNumber = "+31 6 12345678", AlternativeEmail = "contact@example.nl" },
      new ProfileSignature([1, 2, 3], "image/png"),
      removeSignature: false,
      expectedVersion: 1,
      CancellationToken.None));
  }

  private sealed class FakeUserProfileRepository : IUserProfileRepository
  {
    private readonly Guid _subject = Guid.NewGuid();
    private UserProfileRecord _profile;

    public FakeUserProfileRepository()
    {
      _profile = new UserProfileRecord(_subject, null, null, false, null, 1, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
    }

    public bool UpdateCalled { get; private set; }

    public Task<UserProfileRecord> GetOrCreateAsync(Guid subject, CancellationToken cancellationToken)
      => Task.FromResult(_profile with { Subject = subject });

    public Task<UserProfileRecord?> UpdateAsync(
      Guid subject,
      string phoneNumber,
      string alternativeEmail,
      ProfileSignature? signature,
      bool removeSignature,
      long expectedVersion,
      CancellationToken cancellationToken)
    {
      UpdateCalled = true;
      if (expectedVersion != _profile.Version)
      {
        return Task.FromResult<UserProfileRecord?>(null);
      }

      _profile = _profile with
      {
        Subject = subject,
        PhoneNumber = phoneNumber,
        AlternativeEmail = alternativeEmail,
        SignatureContentType = removeSignature ? null : signature?.ContentType ?? _profile.SignatureContentType,
        HasSignature = !removeSignature && (signature is not null || _profile.HasSignature),
        Version = _profile.Version + 1,
        UpdatedAt = DateTimeOffset.UtcNow
      };

      return Task.FromResult<UserProfileRecord?>(_profile);
    }
  }
}
