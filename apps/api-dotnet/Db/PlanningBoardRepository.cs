using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed class PlanningBoardRepository(
  VsvkDbContext context, PlanningWorkOrderNumberAllocator numberAllocator)
{
  public async Task<List<PlanningBoardWorkOrderDto>> ListAsync(
    DateOnly from, DateOnly to, CancellationToken cancellationToken)
  {
    var items = await context.Werkopdrachten.AsNoTracking()
      .Where(order => order.StartDatum <= to && order.EindDatum >= from)
      .Where(order => !order.Geannuleerd && !order.Voorraad)
      .OrderBy(order => order.StartDatum).ThenBy(order => order.Nummer)
      .Select(order => new PlanningBoardWorkOrderDto(
        order.Id, order.Nummer, order.KlantId, order.Klant.Bedrijfsnaam, order.Omschrijving,
        order.StartDatum, order.EindDatum, order.IsOptie, order.Kleur, "",
        order.Version,
        order.Klussen.OrderBy(job => job.Sorteervolgorde).ThenBy(job => job.StartDatum)
          .Select(job => new PlanningBoardJobDto(
            job.Id, job.Omschrijving, job.StartDatum, job.EindDatum, job.BenodigdeMedewerkers,
            job.StartTijd, job.EindTijd, job.Sorteervolgorde,
            job.Inzetten.Where(assignment => assignment.Datum >= from && assignment.Datum <= to)
              .OrderBy(assignment => assignment.Datum)
              .Select(assignment => new PlanningBoardAssignmentDto(
                assignment.Id, assignment.Datum, assignment.MedewerkerId,
                assignment.Medewerker != null ? assignment.Medewerker.DisplayName : null,
                assignment.Medewerker != null ? assignment.Medewerker.JobTitle
                  : assignment.Inhuurmedewerker != null ? assignment.Inhuurmedewerker.Functie : null,
                assignment.InhuurmedewerkerId,
                assignment.Inhuurmedewerker != null ? assignment.Inhuurmedewerker.Naam : null,
                assignment.Inhuurmedewerker != null ? assignment.Inhuurmedewerker.Leverancier.Bedrijfsnaam : null,
                assignment.StartTijd, assignment.EindTijd,
                assignment.Werkbon != null ? new PlanningBoardWorkSlipDto(
                  assignment.Werkbon.Id, assignment.Werkbon.Nummer, assignment.Werkbon.Status,
                  assignment.Werkbon.GewijzigdNaUitgifte, assignment.Werkbon.UitgereiktOp,
                  assignment.Werkbon.BinnenOp) : null)).ToList(),
            job.Behoeften.OrderBy(need => need.Id)
              .Select(need => new PlanningJobNeedDto(need.Aantal, need.Rol, need.Skill, need.MaterieelId, need.LosseVerhuur, need.MaterieelGroepId, need.Soort)).ToList(),
            job.Datum, job.ReisHeen, job.ReisTerug,
            job.MaterieelInzetten.Where(assignment => assignment.Datum >= from && assignment.Datum <= to)
              .OrderBy(assignment => assignment.Datum)
              .Select(assignment => new PlanningBoardMaterialAssignmentDto(
                assignment.Id, assignment.Datum, assignment.MaterieelId,
                assignment.Materieel.Omschrijving ?? assignment.Materieel.Zoeknaam ?? assignment.Materieel.Kenteken)).ToList())).ToList(),
        order.VestigingId, order.OptieTot, order.Soort, order.InternProjectnummer, order.BestellerId,
        order.BestellerNaam, order.BestellerTelefoon, order.BestellerEmail, order.OptieReden,
        order.WeekendOverslaan, order.VrijeDagen.Select(item => item.Datum).ToList(), order.Voorraad,
        order.GeschatteUren, order.UiterlijkKlaar, order.Prioriteit, order.KorteWerkomschrijving,
        order.WerkInhoud, order.Instructies, order.Werkadres, order.WerkPostcode, order.WerkPlaats,
        order.GpsLocatie, order.ContactLocatieNaam, order.ContactLocatieTelefoon,
        order.StartOpLocatie, order.EindOpLocatie, order.PauzeMinuten, order.MeerdereDiensten,
        order.Ordernummers.OrderBy(item => item.Sorteervolgorde).Select(item => item.Nummer).ToList(),
        order.Klussen.Where(job => job.Sorteervolgorde == 0).SelectMany(job => job.Behoeften)
          .Where(need => need.Soort == "mens")
          .Select(need => new PlanningJobNeedDto(need.Aantal, need.Rol, need.Skill, null, false, null, "mens")).ToList(),
        order.Klussen.Where(job => job.Sorteervolgorde == 0).SelectMany(job => job.Behoeften)
          .Where(need => need.Soort == "materieel")
          .Select(need => new PlanningJobNeedDto(need.Aantal, need.Rol, need.Skill, need.MaterieelId, need.LosseVerhuur, need.MaterieelGroepId, "materieel")).ToList(),
        order.Materialen.Select(item => new PlanningWorkMaterialWriteDto(
          item.Aantal, item.ArtikelId, item.Omschrijving, item.Eenheid)).ToList()))
      .ToListAsync(cancellationToken);
    return items.Select(WithStatus).ToList();
  }

  public async Task<PlanningBoardWorkOrderDto?> GetAsync(Guid id, CancellationToken cancellationToken) =>
    (await ListAsync(DateOnly.MinValue, DateOnly.MaxValue, cancellationToken))
      .FirstOrDefault(item => item.Id == id);

  public async Task<PlanningBoardReferencesDto> GetReferencesAsync(CancellationToken cancellationToken)
  {
    var customers = await context.Klanten.AsNoTracking().Where(customer => customer.Aan)
      .OrderBy(customer => customer.Bedrijfsnaam)
      .Select(customer => new PlanningBoardCustomerLookupDto(customer.Id, customer.Bedrijfsnaam))
      .ToListAsync(cancellationToken);
    var employees = await context.UserInformation.AsNoTracking().Where(employee => employee.IsActive)
      .OrderBy(employee => employee.DisplayName)
      .Select(employee => new PlanningBoardLookupDto(employee.KeycloakSubject, employee.DisplayName ?? "Onbekende medewerker"))
      .ToListAsync(cancellationToken);
    var subcontractors = await context.Inhuurmedewerkers.AsNoTracking().Where(item => item.Actief)
      .OrderBy(item => item.Naam)
      .Select(item => new PlanningBoardSubcontractorLookupDto(
        item.Id, item.Naam, item.Functie, item.LeverancierId, item.Leverancier.Bedrijfsnaam))
      .ToListAsync(cancellationToken);
    var suppliers = await context.Leveranciers.AsNoTracking().Where(item => item.Aan)
      .OrderBy(item => item.Bedrijfsnaam)
      .Select(item => new PlanningBoardSupplierLookupDto(item.Id, item.Bedrijfsnaam))
      .ToListAsync(cancellationToken);
    var branches = await context.Vestigingen.AsNoTracking().OrderBy(item => item.Naam)
      .Select(item => new PlanningBoardLookupDto(item.Id, item.Naam)).ToListAsync(cancellationToken);
    return new(customers, employees, subcontractors, suppliers, branches);
  }

  public Task<List<PlanningSubcontractorListDto>> ListSubcontractorsAsync(CancellationToken cancellationToken) =>
    context.Inhuurmedewerkers.AsNoTracking().OrderBy(item => item.Naam)
      .Select(item => new PlanningSubcontractorListDto(
        item.Id, item.LeverancierId, item.Leverancier.Bedrijfsnaam, item.Naam, item.Functie,
        item.Telefoon, item.Email, item.Actief, item.Version))
      .ToListAsync(cancellationToken);

  public async Task<PlanningBoardSaveResult> CreateAsync(
    PlanningBoardWorkOrderWriteDto request, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    if (request.NieuweKlant is { } newCustomer)
    {
      var customer = new Klant
      {
        Aan = true, Debiteurnummer = "N-" + Guid.NewGuid().ToString("N")[..12].ToUpperInvariant(),
        Bedrijfsnaam = newCustomer.Bedrijfsnaam!.Trim(), Straat = newCustomer.Straat,
        Postcode = newCustomer.Postcode, Plaats = newCustomer.Plaats,
        TelefoonAlgemeen = newCustomer.Telefoon, EmailAlgemeen = newCustomer.Email,
        Version = 1, TarievenVersion = 1
      };
      context.Klanten.Add(customer);
      await context.SaveChangesAsync(cancellationToken);
      request = request with { KlantId = customer.Id };
    }
    if (request.NieuweBesteller is { } newBuyer && request.KlantId > 0)
    {
      var buyer = new KlantContactpersoon
      {
        KlantId = request.KlantId, Naam = newBuyer.Naam!.Trim(),
        Telefoon = newBuyer.Telefoon, Email = newBuyer.Email
      };
      context.KlantContactpersonen.Add(buyer);
      await context.SaveChangesAsync(cancellationToken);
      request = request with { BestellerId = buyer.Id, BestellerNaam = buyer.Naam,
        BestellerTelefoon = buyer.Telefoon, BestellerEmail = buyer.Email };
    }
    if (!await ReferencesExistAsync(request, cancellationToken))
      return new(PlanningBoardSaveStatus.Invalid, null);
    var number = await numberAllocator.AllocateAsync(cancellationToken);
    var order = new Werkopdracht
    {
      Id = Guid.NewGuid(), Nummer = number, KlantId = request.KlantId,
      Omschrijving = request.Omschrijving!.Trim(), StartDatum = request.StartDatum,
      EindDatum = request.EindDatum, IsOptie = request.IsOptie, OptieTot = request.OptieTot,
      Kleur = request.Kleur!, VestigingId = request.VestigingId, Soort = request.Soort,
      InternProjectnummer = request.InternProjectnummer, BestellerId = request.BestellerId,
      BestellerNaam = request.BestellerNaam, BestellerTelefoon = request.BestellerTelefoon,
      BestellerEmail = request.BestellerEmail, OptieReden = request.OptieReden,
      WeekendOverslaan = request.WeekendOverslaan, GeschatteUren = request.GeschatteUren,
      UiterlijkKlaar = request.UiterlijkKlaar, Prioriteit = request.Prioriteit,
      KorteWerkomschrijving = request.KorteWerkomschrijving, WerkInhoud = request.WerkInhoud,
      Instructies = request.Instructies, Werkadres = request.Werkadres, WerkPostcode = request.WerkPostcode,
      WerkPlaats = request.WerkPlaats, GpsLocatie = request.GpsLocatie,
      ContactLocatieNaam = request.ContactLocatieNaam, ContactLocatieTelefoon = request.ContactLocatieTelefoon,
      StartOpLocatie = request.StartOpLocatie, EindOpLocatie = request.EindOpLocatie,
      PauzeMinuten = request.PauzeMinuten, MeerdereDiensten = request.MeerdereDiensten,
      Voorraad = request.Werkvoorraad, Version = 1
    };
    if (request.Klussen is { Count: > 0 }) AddJobs(order, request.Klussen);
    else AddGeneratedJobs(order, request);
    AddChildren(order, request);
    context.Werkopdrachten.Add(order);
    await context.SaveChangesAsync(cancellationToken);
    var saved = await GetAsync(order.Id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, saved);
  }

  public async Task<PlanningBoardSaveResult> SaveAsync(
    Guid id, long version, PlanningBoardWorkOrderWriteDto request, CancellationToken cancellationToken)
  {
    if (!await ReferencesExistAsync(request, cancellationToken))
      return new(PlanningBoardSaveStatus.Invalid, null);
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var updated = await context.Werkopdrachten.Where(order => order.Id == id && order.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(order => order.Version, order => order.Version + 1)
        .SetProperty(order => order.Nummer, request.Nummer!.Trim())
        .SetProperty(order => order.KlantId, request.KlantId)
        .SetProperty(order => order.Omschrijving, request.Omschrijving!.Trim())
        .SetProperty(order => order.StartDatum, request.StartDatum)
        .SetProperty(order => order.EindDatum, request.EindDatum)
        .SetProperty(order => order.IsOptie, request.IsOptie)
        .SetProperty(order => order.OptieTot, request.OptieTot)
        .SetProperty(order => order.VestigingId, request.VestigingId)
        .SetProperty(order => order.Kleur, request.Kleur!)
        .SetProperty(order => order.Soort, request.Soort)
        .SetProperty(order => order.InternProjectnummer, request.InternProjectnummer)
        .SetProperty(order => order.BestellerId, request.BestellerId)
        .SetProperty(order => order.BestellerNaam, request.BestellerNaam)
        .SetProperty(order => order.BestellerTelefoon, request.BestellerTelefoon)
        .SetProperty(order => order.BestellerEmail, request.BestellerEmail)
        .SetProperty(order => order.OptieReden, request.OptieReden)
        .SetProperty(order => order.WeekendOverslaan, request.WeekendOverslaan)
        .SetProperty(order => order.GeschatteUren, request.GeschatteUren)
        .SetProperty(order => order.UiterlijkKlaar, request.UiterlijkKlaar)
        .SetProperty(order => order.Prioriteit, request.Prioriteit)
        .SetProperty(order => order.KorteWerkomschrijving, request.KorteWerkomschrijving)
        .SetProperty(order => order.WerkInhoud, request.WerkInhoud)
        .SetProperty(order => order.Instructies, request.Instructies)
        .SetProperty(order => order.Werkadres, request.Werkadres)
        .SetProperty(order => order.WerkPostcode, request.WerkPostcode)
        .SetProperty(order => order.WerkPlaats, request.WerkPlaats)
        .SetProperty(order => order.GpsLocatie, request.GpsLocatie)
        .SetProperty(order => order.ContactLocatieNaam, request.ContactLocatieNaam)
        .SetProperty(order => order.ContactLocatieTelefoon, request.ContactLocatieTelefoon)
        .SetProperty(order => order.StartOpLocatie, request.StartOpLocatie)
        .SetProperty(order => order.EindOpLocatie, request.EindOpLocatie)
        .SetProperty(order => order.PauzeMinuten, request.PauzeMinuten)
        .SetProperty(order => order.MeerdereDiensten, request.MeerdereDiensten)
        .SetProperty(order => order.Voorraad, request.Werkvoorraad), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.Werkopdrachten.AsNoTracking().AnyAsync(order => order.Id == id, cancellationToken);
      return new(exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound, null);
    }
    var today = DateOnly.FromDateTime(DateTime.Today);
    if (request.Klussen is { Count: > 0 })
      await context.Klussen.Where(job => job.WerkopdrachtId == id).ExecuteDeleteAsync(cancellationToken);
    else
      await context.Klussen.Where(job => job.WerkopdrachtId == id &&
        job.Datum >= today && !job.Inzetten.Any()).ExecuteDeleteAsync(cancellationToken);
    await context.WerkopdrachtOrdernummers.Where(item => item.WerkopdrachtId == id).ExecuteDeleteAsync(cancellationToken);
    await context.WerkopdrachtVrijeDagen.Where(item => item.WerkopdrachtId == id).ExecuteDeleteAsync(cancellationToken);
    await context.WerkopdrachtMaterialen.Where(item => item.WerkopdrachtId == id).ExecuteDeleteAsync(cancellationToken);
    var order = new Werkopdracht { Id = id };
    if (request.Klussen is { Count: > 0 }) AddJobs(order, request.Klussen);
    else AddGeneratedJobs(order, request, await context.Klussen.AsNoTracking()
      .Where(job => job.WerkopdrachtId == id).Select(job => job.Datum).ToListAsync(cancellationToken));
    AddChildren(order, request);
    context.Klussen.AddRange(order.Klussen);
    context.WerkopdrachtOrdernummers.AddRange(order.Ordernummers);
    context.WerkopdrachtVrijeDagen.AddRange(order.VrijeDagen);
    context.WerkopdrachtMaterialen.AddRange(order.Materialen);
    await context.SaveChangesAsync(cancellationToken);
    var saved = await GetAsync(id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, saved);
  }

  public async Task<PlanningSubcontractorSaveResult> CreateSubcontractorAsync(
    PlanningSubcontractorWriteDto request, CancellationToken cancellationToken)
  {
    if (!await context.Leveranciers.AsNoTracking().AnyAsync(item => item.Id == request.LeverancierId, cancellationToken))
      return new(PlanningBoardSaveStatus.Invalid, null);
    var item = new Inhuurmedewerker
    {
      Id = Guid.NewGuid(), LeverancierId = request.LeverancierId, Naam = request.Naam!.Trim(),
      Functie = request.Functie, Telefoon = request.Telefoon, Email = request.Email,
      Actief = request.Actief, Version = 1
    };
    context.Inhuurmedewerkers.Add(item);
    await context.SaveChangesAsync(cancellationToken);
    var saved = await context.Inhuurmedewerkers.AsNoTracking().Where(candidate => candidate.Id == item.Id)
      .Select(candidate => new PlanningSubcontractorListDto(
        candidate.Id, candidate.LeverancierId, candidate.Leverancier.Bedrijfsnaam, candidate.Naam,
        candidate.Functie, candidate.Telefoon, candidate.Email, candidate.Actief, candidate.Version))
      .SingleAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, saved);
  }

  public async Task<PlanningBoardSaveStatus> DeleteAsync(
    Guid id, long version, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var deleted = await context.Werkopdrachten
      .Where(order => order.Id == id && order.Version == version)
      .ExecuteDeleteAsync(cancellationToken);
    if (deleted == 0)
    {
      var exists = await context.Werkopdrachten.AsNoTracking().AnyAsync(order => order.Id == id, cancellationToken);
      return exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound;
    }
    await transaction.CommitAsync(cancellationToken);
    return PlanningBoardSaveStatus.Saved;
  }

  public async Task<PlanningBoardSaveResult> SetLifecycleAsync(
    Guid id, long version, string state, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var updated = await context.Werkopdrachten.Where(order => order.Id == id && order.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(order => order.Version, order => order.Version + 1)
        .SetProperty(order => order.Voorraad, state == "voorraad")
        .SetProperty(order => order.Geannuleerd, state == "annuleren"), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.Werkopdrachten.AsNoTracking().AnyAsync(order => order.Id == id, cancellationToken);
      return new(exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound, null);
    }
    if (state == "voorraad")
      await context.Klussen.Where(job => job.WerkopdrachtId == id && job.Datum >= DateOnly.FromDateTime(DateTime.Today)
        && !job.Inzetten.Any()).ExecuteDeleteAsync(cancellationToken);
    var saved = await GetAsync(id, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, saved);
  }

  public async Task<PlanningSubcontractorSaveResult> SaveSubcontractorAsync(
    Guid id, long version, PlanningSubcontractorWriteDto request, CancellationToken cancellationToken)
  {
    if (!await context.Leveranciers.AsNoTracking().AnyAsync(item => item.Id == request.LeverancierId, cancellationToken))
      return new(PlanningBoardSaveStatus.Invalid, null);
    var updated = await context.Inhuurmedewerkers.Where(item => item.Id == id && item.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(item => item.Version, item => item.Version + 1)
        .SetProperty(item => item.LeverancierId, request.LeverancierId)
        .SetProperty(item => item.Naam, request.Naam!.Trim())
        .SetProperty(item => item.Functie, request.Functie)
        .SetProperty(item => item.Telefoon, request.Telefoon)
        .SetProperty(item => item.Email, request.Email)
        .SetProperty(item => item.Actief, request.Actief), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.Inhuurmedewerkers.AsNoTracking().AnyAsync(item => item.Id == id, cancellationToken);
      return new(exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound, null);
    }
    var saved = await context.Inhuurmedewerkers.AsNoTracking().Where(item => item.Id == id)
      .Select(item => new PlanningSubcontractorListDto(
        item.Id, item.LeverancierId, item.Leverancier.Bedrijfsnaam, item.Naam, item.Functie,
        item.Telefoon, item.Email, item.Actief, item.Version)).SingleAsync(cancellationToken);
    return new(PlanningBoardSaveStatus.Saved, saved);
  }

  private async Task<bool> ReferencesExistAsync(
    PlanningBoardWorkOrderWriteDto request, CancellationToken cancellationToken)
  {
    if (!await context.Klanten.AsNoTracking().AnyAsync(item => item.Id == request.KlantId, cancellationToken))
      return false;
    var jobs = request.Klussen ?? [];
    var employeeIds = jobs.SelectMany(job => job.Inzetten ?? [])
      .Where(item => item.MedewerkerId.HasValue).Select(item => item.MedewerkerId!.Value).Distinct().ToList();
    var subcontractorIds = jobs.SelectMany(job => job.Inzetten ?? [])
      .Where(item => item.InhuurmedewerkerId.HasValue).Select(item => item.InhuurmedewerkerId!.Value).Distinct().ToList();
    var equipmentIds = jobs.SelectMany(job => job.MaterieelInzetten ?? [])
      .Select(item => item.MaterieelId).Distinct().ToList();
    return await context.UserInformation.AsNoTracking().CountAsync(
      item => employeeIds.Contains(item.KeycloakSubject), cancellationToken) == employeeIds.Count
      && await context.Inhuurmedewerkers.AsNoTracking().CountAsync(
        item => subcontractorIds.Contains(item.Id), cancellationToken) == subcontractorIds.Count
      && await context.MaterieelItems.AsNoTracking().CountAsync(
        item => equipmentIds.Contains(item.Id), cancellationToken) == equipmentIds.Count;
  }

  private static void AddJobs(Werkopdracht order, IEnumerable<PlanningBoardJobWriteDto> requests)
  {
    foreach (var jobRequest in requests)
    {
      var job = new Klus
      {
        Id = Guid.NewGuid(), WerkopdrachtId = order.Id, Omschrijving = jobRequest.Omschrijving!.Trim(),
        StartDatum = jobRequest.StartDatum, EindDatum = jobRequest.EindDatum,
        BenodigdeMedewerkers = jobRequest.Behoeften is { Count: > 0 }
          ? jobRequest.Behoeften.Where(item => item.Soort == "mens").Sum(item => item.Aantal)
          : jobRequest.BenodigdeMedewerkers, StartTijd = jobRequest.StartTijd,
        EindTijd = jobRequest.EindTijd, Sorteervolgorde = jobRequest.Sorteervolgorde,
        Datum = jobRequest.Datum, ReisHeen = jobRequest.ReisHeen, ReisTerug = jobRequest.ReisTerug
      };
      foreach (var need in jobRequest.Behoeften ?? [])
        job.Behoeften.Add(new KlusBehoefte
        {
          Id = Guid.NewGuid(), KlusId = job.Id, Aantal = need.Aantal, Rol = need.Rol, Skill = need.Skill,
          Soort = need.Soort, MaterieelId = need.MaterieelId, MaterieelGroepId = need.MaterieelGroepId,
          LosseVerhuur = need.LosseVerhuur
        });
      foreach (var assignmentRequest in jobRequest.Inzetten!)
      {
        var assignment = new Inzet
        {
          Id = Guid.NewGuid(), KlusId = job.Id, Datum = assignmentRequest.Datum,
          MedewerkerId = assignmentRequest.MedewerkerId, InhuurmedewerkerId = assignmentRequest.InhuurmedewerkerId,
          StartTijd = assignmentRequest.StartTijd, EindTijd = assignmentRequest.EindTijd
        };
        if (assignmentRequest.Werkbon is { } slip)
          assignment.Werkbon = new Werkbon
          {
            Id = Guid.NewGuid(), InzetId = assignment.Id, Nummer = slip.Nummer!.Trim(),
            Status = slip.Status!, GewijzigdNaUitgifte = slip.GewijzigdNaUitgifte,
            UitgereiktOp = slip.UitgereiktOp, BinnenOp = slip.BinnenOp
          };
        job.Inzetten.Add(assignment);
      }
      foreach (var materialRequest in jobRequest.MaterieelInzetten ?? [])
        job.MaterieelInzetten.Add(new MaterieelInzet
        {
          Id = Guid.NewGuid(), KlusId = job.Id, Datum = materialRequest.Datum,
          MaterieelId = materialRequest.MaterieelId
        });

      order.Klussen.Add(job);
    }
  }

  private static void AddGeneratedJobs(
    Werkopdracht order, PlanningBoardWorkOrderWriteDto request, IEnumerable<DateOnly?>? existingDays = null)
  {
    if (request.Werkvoorraad) return;
    var existing = (existingDays ?? []).Where(date => date.HasValue).Select(date => date!.Value).ToHashSet();
    var skipped = (request.VrijeDagen ?? []).ToHashSet();
    for (var date = request.StartDatum; date <= request.EindDatum; date = date.AddDays(1))
    {
      if (existing.Contains(date) || skipped.Contains(date) ||
          (request.WeekendOverslaan && date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday))
        continue;
      var needsTemplate = (request.Behoeften ?? []).Select(need => new KlusBehoefte
      {
        Id = Guid.NewGuid(), Aantal = need.Aantal, Rol = need.Rol, Skill = need.Skill,
        MaterieelId = need.MaterieelId, LosseVerhuur = need.LosseVerhuur, Soort = "mens",
        MaterieelGroepId = need.MaterieelGroepId
      }).ToList();
      needsTemplate.AddRange((request.Materieel ?? []).Select(need => new KlusBehoefte
      {
        Id = Guid.NewGuid(), Aantal = need.Aantal, MaterieelId = need.MaterieelId,
        MaterieelGroepId = need.MaterieelGroepId,
        Rol = need.Type, LosseVerhuur = need.LosseVerhuur, Soort = "materieel"
      }));
      var services = request.Diensten is { Count: > 0 }
        ? request.Diensten
        : [new PlanningServiceWriteDto("Dagdienst", request.StartOpLocatie ?? TimeOnly.MinValue,
          request.EindOpLocatie ?? new TimeOnly(16, 0))];
      foreach (var service in services)
      {
        var job = new Klus
        {
          Id = Guid.NewGuid(), WerkopdrachtId = order.Id,
          Omschrijving = request.KorteWerkomschrijving ?? request.Omschrijving ?? "",
          StartDatum = request.StartDatum, EindDatum = request.EindDatum, Datum = date,
          BenodigdeMedewerkers = request.Behoeften?.Where(item => item.Soort == "mens")
            .Sum(item => item.Aantal) ?? 0,
          StartTijd = service.Start, EindTijd = service.Eind, DienstNaam = service.Naam,
          ReisHeen = request.Klussen?.FirstOrDefault()?.ReisHeen,
          ReisTerug = request.Klussen?.FirstOrDefault()?.ReisTerug,
          PauzeMinuten = request.PauzeMinuten, Sorteervolgorde = order.Klussen.Count
        };
        foreach (var sourceNeed in needsTemplate)
          job.Behoeften.Add(new KlusBehoefte
          {
            Id = Guid.NewGuid(), KlusId = job.Id, Aantal = sourceNeed.Aantal,
            Rol = sourceNeed.Rol, Skill = sourceNeed.Skill, MaterieelId = sourceNeed.MaterieelId,
            MaterieelGroepId = sourceNeed.MaterieelGroepId, LosseVerhuur = sourceNeed.LosseVerhuur,
            Soort = sourceNeed.Soort
          });
        order.Klussen.Add(job);
      }
    }
  }

  private static void AddChildren(Werkopdracht order, PlanningBoardWorkOrderWriteDto request)
  {
    foreach (var number in (request.Ordernummers ?? []).Where(value => !string.IsNullOrWhiteSpace(value)).Select((value, index) =>
      new WerkopdrachtOrdernummer
      {
        Id = Guid.NewGuid(), WerkopdrachtId = order.Id, Nummer = value.Trim(), Sorteervolgorde = index
      }))
      order.Ordernummers.Add(number);
    foreach (var date in request.VrijeDagen ?? [])
      order.VrijeDagen.Add(new WerkopdrachtVrijeDag { WerkopdrachtId = order.Id, Datum = date });
    foreach (var material in request.Materialen ?? [])
      order.Materialen.Add(new WerkopdrachtMateriaal
      {
        Id = Guid.NewGuid(), WerkopdrachtId = order.Id, Aantal = material.Aantal,
        ArtikelId = material.ArtikelId, Omschrijving = material.Omschrijving, Eenheid = material.Eenheid
      });
  }

  private static PlanningBoardWorkOrderDto WithStatus(PlanningBoardWorkOrderDto order)
  {
    var assignments = order.Klussen.SelectMany(job => job.Inzetten).ToList();
    var required = 0;
    var covered = 0;
    foreach (var job in order.Klussen)
    {
      foreach (var date in Enumerable.Range(0, job.EindDatum.DayNumber - job.StartDatum.DayNumber + 1)
        .Select(offset => job.StartDatum.AddDays(offset))
        .Where(date => date.DayOfWeek is not DayOfWeek.Saturday and not DayOfWeek.Sunday))
      {
        required += job.BenodigdeMedewerkers;
        covered += Math.Min(job.BenodigdeMedewerkers, job.Inzetten.Count(item => item.Datum == date));
      }
    }
    var slipped = assignments.Where(item => item.Werkbon != null).ToList();
    var completed = order.EindDatum < DateOnly.FromDateTime(DateTime.Today)
      && slipped.Count == assignments.Count       && slipped.All(item => item.Werkbon!.Status is "binnen" or "retour" or "verwerkt")
      && covered >= required;
    var status = order.IsOptie ? "OPTIE" : completed ? "AFGEROND"
      : covered == 0 ? "NIET INGEPLAND" : covered < required ? $"OPEN {required - covered}" : "GEPLAND";
    return order with { Status = status };
  }
}
