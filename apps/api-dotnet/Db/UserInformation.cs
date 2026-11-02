namespace Vsvk.Api.Db;

public sealed class UserInformation
{
  public Guid KeycloakSubject { get; set; }
  public string? PhoneNumber { get; set; }
  public string? AlternativeEmail { get; set; }
  public byte[]? DigitalSignature { get; set; }
  public string? DigitalSignatureContentType { get; set; }
  public long Version { get; set; } = 1;
  public DateTimeOffset CreatedAt { get; set; }
  public DateTimeOffset UpdatedAt { get; set; }
}
