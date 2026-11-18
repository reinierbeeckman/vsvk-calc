using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed partial class PlanningRepository
{
  public Task<PlanningSupplierDetailDto?> GetSupplierAsync(int id, CancellationToken cancellationToken) =>
    context.Leveranciers.AsNoTracking().Where(supplier => supplier.Id == id)
      .Select(supplier => new PlanningSupplierDetailDto(
        supplier.Id, supplier.Aan, supplier.Debiteurnummer, supplier.Bedrijfsnaam,
        supplier.KvkNummer, supplier.BtwNummer, supplier.Website, supplier.TelefoonAlgemeen,
        supplier.EmailAlgemeen, supplier.Straat, supplier.Huisnummer, supplier.Toevoeging,
        supplier.Postcode, supplier.Plaats, supplier.Land, supplier.FactuurEmail,
        supplier.AfwijkendFactuuradres, supplier.VasteReferentie, supplier.Iban,
        supplier.GRekeningPercentage, supplier.FacturerenPer, supplier.BtwVerlegd,
        supplier.MandagenregisterMeesturen, supplier.Opmerkingen, supplier.Version))
      .FirstOrDefaultAsync(cancellationToken);

  public async Task<PlanningSupplierDetailDto> CreateSupplierAsync(
    PlanningSupplierWriteDto data, CancellationToken cancellationToken)
  {
    var supplier = new Leverancier
    {
      Aan = data.Actief,
      Debiteurnummer = data.Crediteurnummer!.Trim(),
      Bedrijfsnaam = data.Bedrijfsnaam!.Trim(),
      KvkNummer = data.KvkNummer,
      BtwNummer = data.BtwNummer,
      Website = data.Website,
      TelefoonAlgemeen = data.Telefoon,
      EmailAlgemeen = data.Email,
      Straat = data.Straat,
      Huisnummer = data.Huisnummer,
      Toevoeging = data.Toevoeging,
      Postcode = data.Postcode,
      Plaats = data.Plaats,
      Land = data.Land,
      FactuurEmail = data.FactuurEmail,
      AfwijkendFactuuradres = data.AfwijkendFactuuradres,
      VasteReferentie = data.VasteReferentie,
      Iban = data.Iban,
      GRekeningPercentage = data.GRekeningPercentage,
      FacturerenPer = data.FacturerenPer,
      BtwVerlegd = data.BtwVerlegd,
      MandagenregisterMeesturen = data.MandagenregisterMeesturen,
      Opmerkingen = data.Opmerkingen,
      Version = 1
    };
    context.Leveranciers.Add(supplier);
    await context.SaveChangesAsync(cancellationToken);
    return await GetSupplierAsync(supplier.Id, cancellationToken)
      ?? throw new InvalidOperationException("De aangemaakte leverancier kon niet worden opgehaald.");
  }

  public async Task<PlanningSupplierDetailDto?> SaveSupplierAsync(
    int id, long version, PlanningSupplierWriteDto data, CancellationToken cancellationToken)
  {
    var count = await context.Leveranciers.Where(supplier => supplier.Id == id && supplier.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(supplier => supplier.Version, supplier => supplier.Version + 1)
        .SetProperty(supplier => supplier.Aan, data.Actief)
        .SetProperty(supplier => supplier.Debiteurnummer, data.Crediteurnummer)
        .SetProperty(supplier => supplier.Bedrijfsnaam, data.Bedrijfsnaam)
        .SetProperty(supplier => supplier.KvkNummer, data.KvkNummer)
        .SetProperty(supplier => supplier.BtwNummer, data.BtwNummer)
        .SetProperty(supplier => supplier.Website, data.Website)
        .SetProperty(supplier => supplier.TelefoonAlgemeen, data.Telefoon)
        .SetProperty(supplier => supplier.EmailAlgemeen, data.Email)
        .SetProperty(supplier => supplier.Straat, data.Straat)
        .SetProperty(supplier => supplier.Huisnummer, data.Huisnummer)
        .SetProperty(supplier => supplier.Toevoeging, data.Toevoeging)
        .SetProperty(supplier => supplier.Postcode, data.Postcode)
        .SetProperty(supplier => supplier.Plaats, data.Plaats)
        .SetProperty(supplier => supplier.Land, data.Land)
        .SetProperty(supplier => supplier.FactuurEmail, data.FactuurEmail)
        .SetProperty(supplier => supplier.AfwijkendFactuuradres, data.AfwijkendFactuuradres)
        .SetProperty(supplier => supplier.VasteReferentie, data.VasteReferentie)
        .SetProperty(supplier => supplier.Iban, data.Iban)
        .SetProperty(supplier => supplier.GRekeningPercentage, data.GRekeningPercentage)
        .SetProperty(supplier => supplier.FacturerenPer, data.FacturerenPer)
        .SetProperty(supplier => supplier.BtwVerlegd, data.BtwVerlegd)
        .SetProperty(supplier => supplier.MandagenregisterMeesturen, data.MandagenregisterMeesturen)
        .SetProperty(supplier => supplier.Opmerkingen, data.Opmerkingen), cancellationToken);
    return count == 0 ? null : await GetSupplierAsync(id, cancellationToken);
  }
}
