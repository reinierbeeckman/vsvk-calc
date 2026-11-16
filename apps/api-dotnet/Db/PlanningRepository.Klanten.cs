using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed partial class PlanningRepository
{
  public async Task<PlanningCustomerDetailDto?> SaveCustomerAsync(int id, long version, PlanningCustomerDetailDto data, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var billing = data.Facturatie;
    var count = await context.Klanten.Where(c => c.Id == id && c.Version == version)
      .ExecuteUpdateAsync(s => s
        .SetProperty(c => c.Version, c => c.Version + 1)
        .SetProperty(c => c.Aan, data.Actief).SetProperty(c => c.Debiteurnummer, data.Debiteurnummer)
        .SetProperty(c => c.Bedrijfsnaam, data.Bedrijfsnaam).SetProperty(c => c.KvkNummer, data.KvkNummer)
        .SetProperty(c => c.Website, data.Website).SetProperty(c => c.TelefoonAlgemeen, data.Telefoon)
        .SetProperty(c => c.EmailAlgemeen, data.Email).SetProperty(c => c.Straat, data.Straat)
        .SetProperty(c => c.Huisnummer, data.Huisnummer).SetProperty(c => c.Toevoeging, data.Toevoeging)
        .SetProperty(c => c.Postcode, data.Postcode).SetProperty(c => c.Plaats, data.Plaats)
        .SetProperty(c => c.Land, data.Land).SetProperty(c => c.Opmerkingen, data.Opmerkingen)
        .SetProperty(c => c.BtwNummer, billing.BtwNummer).SetProperty(c => c.Iban, billing.Iban)
        .SetProperty(c => c.FactuurEmail, billing.FactuurEmail).SetProperty(c => c.AfwijkendFactuuradres, billing.AfwijkendFactuuradres)
        .SetProperty(c => c.VasteReferentie, billing.VasteReferentie).SetProperty(c => c.GRekeningPercentage, billing.GRekeningPercentage)
        .SetProperty(c => c.FacturerenPer, billing.FacturerenPer).SetProperty(c => c.BtwVerlegd, billing.BtwVerlegd)
        .SetProperty(c => c.MandagenregisterMeesturen, billing.MandagenregisterMeesturen), cancellationToken);
    if (count == 0) return null;

    await context.KlantContactpersonen.Where(c => c.KlantId == id && c.IsStandaardBesteller)
      .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsStandaardBesteller, false), cancellationToken);
    var contacts = await context.KlantContactpersonen.Where(c => c.KlantId == id).ToListAsync(cancellationToken);
    var ids = data.Contactpersonen.Where(c => c.Id > 0).Select(c => c.Id).ToHashSet();
    context.KlantContactpersonen.RemoveRange(contacts.Where(c => !ids.Contains(c.Id)));
    foreach (var item in data.Contactpersonen)
    {
      var contact = item.Id == 0 ? new KlantContactpersoon { KlantId = id } : contacts.Single(c => c.Id == item.Id);
      if (item.Id == 0) context.KlantContactpersonen.Add(contact);
      contact.Naam = item.Naam; contact.Functie = item.Functie; contact.Telefoon = item.Telefoon;
      contact.Email = item.Email; contact.IsStandaardBesteller = item.IsStandaardBesteller;
    }
    await context.SaveChangesAsync(cancellationToken);
    var result = await GetCustomerAsync(id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return result;
  }
}
