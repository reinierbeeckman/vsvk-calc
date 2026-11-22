using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed class PlanningBoardRepository(VsvkDbContext context)
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
              .Select(need => new PlanningJobNeedDto(need.Aantal, need.Rol, need.Skill)).ToList(),
            job.Datum, job.ReisHeen, job.ReisTerug)).ToList(),
        order.VestigingId, order.OptieTot))
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
    if (!await ReferencesExistAsync(request, cancellationToken))
      return new(PlanningBoardSaveStatus.Invalid, null);
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var order = new Werkopdracht
    {
      Id = Guid.NewGuid(), Nummer = request.Nummer!.Trim(), KlantId = request.KlantId,
      Omschrijving = request.Omschrijving!.Trim(), StartDatum = request.StartDatum,
      EindDatum = request.EindDatum, IsOptie = request.IsOptie, OptieTot = request.OptieTot,
      Kleur = request.Kleur!, VestigingId = request.VestigingId, Version = 1
    };
    AddJobs(order, request.Klussen!);
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
        .SetProperty(order => order.Kleur, request.Kleur!), cancellationToken);
    if (updated == 0)
    {
      var exists = await context.Werkopdrachten.AsNoTracking().AnyAsync(order => order.Id == id, cancellationToken);
      return new(exists ? PlanningBoardSaveStatus.Conflict : PlanningBoardSaveStatus.NotFound, null);
    }
    await context.Klussen.Where(job => job.WerkopdrachtId == id).ExecuteDeleteAsync(cancellationToken);
    var order = new Werkopdracht { Id = id };
    AddJobs(order, request.Klussen!);
    context.Klussen.AddRange(order.Klussen);
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
    return await context.UserInformation.AsNoTracking().CountAsync(
      item => employeeIds.Contains(item.KeycloakSubject), cancellationToken) == employeeIds.Count
      && await context.Inhuurmedewerkers.AsNoTracking().CountAsync(
        item => subcontractorIds.Contains(item.Id), cancellationToken) == subcontractorIds.Count;
  }

  private static void AddJobs(Werkopdracht order, IEnumerable<PlanningBoardJobWriteDto> requests)
  {
    foreach (var jobRequest in requests)
    {
      var job = new Klus
      {
        Id = Guid.NewGuid(), WerkopdrachtId = order.Id, Omschrijving = jobRequest.Omschrijving!.Trim(),
        StartDatum = jobRequest.StartDatum, EindDatum = jobRequest.EindDatum,
        BenodigdeMedewerkers = jobRequest.BenodigdeMedewerkers, StartTijd = jobRequest.StartTijd,
        EindTijd = jobRequest.EindTijd, Sorteervolgorde = jobRequest.Sorteervolgorde,
        Datum = jobRequest.Datum, ReisHeen = jobRequest.ReisHeen, ReisTerug = jobRequest.ReisTerug
      };
      foreach (var need in jobRequest.Behoeften ?? [])
        job.Behoeften.Add(new KlusBehoefte
        {
          Id = Guid.NewGuid(), KlusId = job.Id, Aantal = need.Aantal, Rol = need.Rol, Skill = need.Skill
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
      order.Klussen.Add(job);
    }
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
