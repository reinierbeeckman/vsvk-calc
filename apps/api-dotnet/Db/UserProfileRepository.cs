using Npgsql;
using NpgsqlTypes;
using Vsvk.Api.Services;

namespace Vsvk.Api.Db;

public sealed class UserProfileRepository(NpgsqlDataSource dataSource) : IUserProfileRepository
{
  public async Task<UserProfileRecord> GetOrCreateAsync(Guid subject, CancellationToken cancellationToken)
  {
    await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

    await using (var insert = new NpgsqlCommand("""
      insert into user_information (keycloak_sub)
      values ($1)
      on conflict (keycloak_sub) do nothing
      """, connection))
    {
      insert.Parameters.AddWithValue(NpgsqlDbType.Uuid, subject);
      await insert.ExecuteNonQueryAsync(cancellationToken);
    }

    await using var select = new NpgsqlCommand("""
      select keycloak_sub, phone_number, alternative_email,
             digital_signature is not null, digital_signature_media_type,
             version, created_at, updated_at
      from user_information
      where keycloak_sub = $1
      """, connection);
    select.Parameters.AddWithValue(NpgsqlDbType.Uuid, subject);

    await using var reader = await select.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      throw new InvalidOperationException("The user profile could not be created or loaded.");
    }

    return new UserProfileRecord(
      reader.GetGuid(0),
      reader.IsDBNull(1) ? null : reader.GetString(1),
      reader.IsDBNull(2) ? null : reader.GetString(2),
      reader.GetBoolean(3),
      reader.IsDBNull(4) ? null : reader.GetString(4),
      reader.GetInt64(5),
      reader.GetFieldValue<DateTimeOffset>(6),
      reader.GetFieldValue<DateTimeOffset>(7));
  }

  public async Task<UserProfileRecord?> UpdateAsync(
    Guid subject,
    string phoneNumber,
    string alternativeEmail,
    ProfileSignature? signature,
    bool removeSignature,
    long expectedVersion,
    CancellationToken cancellationToken)
  {
    await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
    await using var command = new NpgsqlCommand("""
      update user_information
      set phone_number = $2,
          alternative_email = $3,
          digital_signature = case
            when $4 then null
            when $5 is not null then $5
            else digital_signature
          end,
          digital_signature_media_type = case
            when $4 then null
            when $6 is not null then $6
            else digital_signature_media_type
          end,
          version = version + 1,
          updated_at = now()
      where keycloak_sub = $1 and version = $7
      returning keycloak_sub, phone_number, alternative_email,
                digital_signature is not null, digital_signature_media_type,
                version, created_at, updated_at
      """, connection);

    command.Parameters.AddWithValue(NpgsqlDbType.Uuid, subject);
    command.Parameters.AddWithValue(NpgsqlDbType.Varchar, phoneNumber);
    command.Parameters.AddWithValue(NpgsqlDbType.Varchar, alternativeEmail);
    command.Parameters.AddWithValue(NpgsqlDbType.Boolean, removeSignature);
    command.Parameters.AddWithValue(NpgsqlDbType.Bytea, (object?)signature?.Content ?? DBNull.Value);
    command.Parameters.AddWithValue(NpgsqlDbType.Varchar, (object?)signature?.ContentType ?? DBNull.Value);
    command.Parameters.AddWithValue(NpgsqlDbType.Bigint, expectedVersion);

    await using var reader = await command.ExecuteReaderAsync(cancellationToken);
    if (!await reader.ReadAsync(cancellationToken))
    {
      return null;
    }

    return new UserProfileRecord(
      reader.GetGuid(0),
      reader.IsDBNull(1) ? null : reader.GetString(1),
      reader.IsDBNull(2) ? null : reader.GetString(2),
      reader.GetBoolean(3),
      reader.IsDBNull(4) ? null : reader.GetString(4),
      reader.GetInt64(5),
      reader.GetFieldValue<DateTimeOffset>(6),
      reader.GetFieldValue<DateTimeOffset>(7));
  }
}
