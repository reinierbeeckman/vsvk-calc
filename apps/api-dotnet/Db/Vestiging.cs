namespace Vsvk.Api.Db;

public sealed class Vestiging
{
  public Guid Id { get; set; }
  public int InstellingenAlgemeenId { get; set; }
  public InstellingenAlgemeen InstellingenAlgemeen { get; set; } = null!;
  public string Naam { get; set; } = string.Empty;
  public string Adres { get; set; } = string.Empty;
  public string Postcode { get; set; } = string.Empty;
  public string Plaats { get; set; } = string.Empty;
  public string Telefoon { get; set; } = string.Empty;
  public string Email { get; set; } = string.Empty;
  public string KvkNummer { get; set; } = string.Empty;
  public string BtwNummer { get; set; } = string.Empty;
  public string Iban { get; set; } = string.Empty;
}
