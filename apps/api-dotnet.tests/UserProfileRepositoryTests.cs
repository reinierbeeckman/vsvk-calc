using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Db;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class UserProfileRepositoryTests : IAsyncLifetime
{
  private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
    .WithImage("postgres:16-alpine")
    .Build();
  private NpgsqlDataSource _dataSource = null!;
  private UserProfileRepository _repository = null!;

  public async Task InitializeAsync()
  {
    await _postgres.StartAsync();
    _dataSource = NpgsqlDataSource.Create(_postgres.GetConnectionString());
    _repository = new UserProfileRepository(_dataSource);

    await using var command = _dataSource.CreateCommand("""
      create table user_information (
        keycloak_sub uuid primary key,
        phone_number varchar(32) null,
        alternative_email varchar(254) null,
        digital_signature bytea null,
        digital_signature_media_type varchar(32) null,
        version bigint not null default 1,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        check (digital_signature is null or octet_length(digital_signature) <= 1048576),
        check ((digital_signature is null) = (digital_signature_media_type is null))
      );
      """);
    await command.ExecuteNonQueryAsync();
  }

  public async Task DisposeAsync()
  {
    await _dataSource.DisposeAsync();
    await _postgres.DisposeAsync();
  }

  [Fact]
  public async Task Get_or_create_is_idempotent_and_initializes_version_one()
  {
    var subject = Guid.NewGuid();

    var first = await _repository.GetOrCreateAsync(subject, CancellationToken.None);
    var second = await _repository.GetOrCreateAsync(subject, CancellationToken.None);

    Assert.Equal(subject, first.Subject);
    Assert.Equal(1, first.Version);
    Assert.Null(first.PhoneNumber);
    Assert.Null(first.AlternativeEmail);
    Assert.False(first.HasSignature);
    Assert.Equal(first, second);
  }

  [Fact]
  public async Task Concurrent_first_profile_reads_create_only_one_row()
  {
    var subject = Guid.NewGuid();

    var profiles = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ =>
      _repository.GetOrCreateAsync(subject, CancellationToken.None)));

    Assert.All(profiles, profile => Assert.Equal(1, profile.Version));
    await using var command = _dataSource.CreateCommand("select count(*) from user_information where keycloak_sub = $1");
    command.Parameters.AddWithValue(subject);
    Assert.Equal(1L, (long)(await command.ExecuteScalarAsync())!);
  }

  [Fact]
  public async Task Stale_update_does_not_replace_the_newer_profile()
  {
    var subject = Guid.NewGuid();
    var initial = await _repository.GetOrCreateAsync(subject, CancellationToken.None);

    var first = await _repository.UpdateAsync(subject, "+31 6 12345678", "first@example.nl", null, false, initial.Version, CancellationToken.None);
    var stale = await _repository.UpdateAsync(subject, "+31 6 87654321", "stale@example.nl", null, false, initial.Version, CancellationToken.None);
    var persisted = await _repository.GetOrCreateAsync(subject, CancellationToken.None);

    Assert.NotNull(first);
    Assert.Equal(initial.Version + 1, first.Version);
    Assert.Null(stale);
    Assert.Equal("+31 6 12345678", persisted.PhoneNumber);
    Assert.Equal("first@example.nl", persisted.AlternativeEmail);
    Assert.Equal(first.Version, persisted.Version);
  }

  [Fact]
  public async Task Signature_and_profile_fields_are_saved_atomically()
  {
    var subject = Guid.NewGuid();
    var initial = await _repository.GetOrCreateAsync(subject, CancellationToken.None);
    var pngHeader = new byte[] { 137, 80, 78, 71, 13, 10, 26, 10, 0 };

    var updated = await _repository.UpdateAsync(
      subject,
      "+31 6 12345678",
      "contact@example.nl",
      new ProfileSignature(pngHeader, "image/png"),
      removeSignature: false,
      initial.Version,
      CancellationToken.None);

    Assert.NotNull(updated);
    Assert.True(updated.HasSignature);
    Assert.Equal("image/png", updated.SignatureContentType);
    Assert.Equal(initial.Version + 1, updated.Version);
  }
}
