using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;
using Vsvk.Api.Services;
using Vsvk.Api.Auth;
using System.Security.Claims;

namespace Vsvk.Api.Endpoints;

public static class PlanningBoardEndpoints
{
  private static readonly HashSet<string> SlipStatuses =
    new(["niet_geprint", "aangemaakt", "uitgereikt", "retour", "verwerkt", "vervallen", "binnen"], StringComparer.Ordinal);

  public static WebApplication MapPlanningBoardEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning").RequireAuthorization("planning-lijsten");

    group.MapGet("/planbord/werkopdrachten", async (
      DateOnly van, DateOnly tot, string? zoom, ClaimsPrincipal user,
      VsvkDbContext context, PlanningTimelineService timeline, CancellationToken cancellationToken) =>
    {
      if (tot < van || tot.DayNumber - van.DayNumber > 62) return Results.BadRequest("Kies een periode van maximaal 63 dagen.");
      zoom = zoom is "dag" or "maand" ? zoom : "week";
      Guid? branchId = null;
      if (!VsvkRoles.HasOrganizationWideAccess(user))
      {
        var branch = VsvkRoles.GetVestiging(user);
        if (string.IsNullOrWhiteSpace(branch)) return Results.Forbid();
        branchId = Guid.TryParse(branch, out var id) ? id
          : await context.Vestigingen.AsNoTracking().Where(item => item.Naam == branch)
            .Select(item => item.Id).SingleOrDefaultAsync(cancellationToken);
        if (branchId == Guid.Empty) return Results.Forbid();
      }
      return Results.Ok(await timeline.GetAsync(van, tot, zoom!, branchId, cancellationToken));
    }).WithSummary("Daggezondheid-viewmodel voor werkopdrachten ophalen")
      .Produces<TimelineViewModel>(200).Produces(400).Produces(401).Produces(403);

    group.MapGet("/planbord", async (
      DateOnly from, DateOnly to, PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      if (to < from || to.DayNumber - from.DayNumber > 62) return Results.BadRequest("Kies een periode van maximaal 63 dagen.");
      return Results.Ok(await repository.ListAsync(from, to, cancellationToken));
    }).WithSummary("Werkopdrachten voor de planbordperiode ophalen")
      .Produces<List<PlanningBoardWorkOrderDto>>(200).Produces(400).Produces(401).Produces(403);

    group.MapGet("/planbord/referenties", async (
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
      Results.Ok(await repository.GetReferencesAsync(cancellationToken)))
      .WithSummary("Referenties voor het planbord ophalen")
      .Produces<PlanningBoardReferencesDto>(200).Produces(401).Produces(403);

    group.MapGet("/werkbonnen", async (
      ClaimsPrincipal user, VsvkDbContext db, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasRequiredVestigingScope(user)) return Results.Forbid();
      var branch = VsvkRoles.HasOrganizationWideAccess(user)
        ? null : VsvkRoles.GetVestiging(user);
      var slips = await db.Werkbonnen.AsNoTracking()
        .Where(slip => branch == null || slip.Inzet.Klus.Werkopdracht.Vestiging!.Naam == branch)
        .OrderByDescending(slip => slip.Inzet.Datum).ThenByDescending(slip => slip.Nummer)
        .Select(slip => new PlanningWorkSlipListDto(
          slip.Id, slip.Nummer, slip.Status, slip.GewijzigdNaUitgifte,
          slip.Inzet.Datum, slip.Inzet.StartTijd, slip.Inzet.EindTijd,
          slip.Inzet.Medewerker != null
            ? slip.Inzet.Medewerker.DisplayName ?? "Onbekende medewerker"
            : slip.Inzet.Inhuurmedewerker != null
              ? slip.Inzet.Inhuurmedewerker.Naam : "Onbekende medewerker",
          slip.Inzet.Medewerker != null
            ? slip.Inzet.Medewerker.JobTitle ?? ""
            : slip.Inzet.Inhuurmedewerker != null
              ? slip.Inzet.Inhuurmedewerker.Functie ?? "" : "",
          slip.Inzet.Klus.WerkopdrachtId, slip.Inzet.Klus.Werkopdracht.Nummer,
          slip.Inzet.Klus.Werkopdracht.Klant.Bedrijfsnaam,
          slip.Inzet.Klus.Werkopdracht.KorteWerkomschrijving
            ?? slip.Inzet.Klus.Werkopdracht.Omschrijving,
          slip.UitgereiktOp, slip.BinnenOp))
        .ToListAsync(cancellationToken);
      return Results.Ok(slips);
    }).WithSummary("Werkbonnen met werkopdracht- en personeelscontext ophalen")
      .Produces<List<PlanningWorkSlipListDto>>(200).Produces(401).Produces(403);

    group.MapGet("/werkopdrachten/form-referenties", async (
      VsvkDbContext db, CancellationToken cancellationToken) =>
    {
      var customers = await db.Klanten.AsNoTracking().Where(item => item.Aan).OrderBy(item => item.Bedrijfsnaam)
        .Select(item => new PlanningCustomerReferenceDto(
          item.Id, item.Bedrijfsnaam, item.Debiteurnummer, item.Straat, item.Postcode, item.Plaats,
          item.TelefoonAlgemeen, item.EmailAlgemeen,
          item.Contactpersonen.OrderByDescending(contact => contact.IsStandaardBesteller)
            .ThenBy(contact => contact.Naam).Select(contact => new PlanningBoardLookupContactDto(
              contact.Id, contact.Naam, contact.Telefoon, contact.Email, contact.IsStandaardBesteller)).ToList(),
          new List<PlanningBoardWorkOrderDto>() )).ToListAsync(cancellationToken);
      var branches = await db.Vestigingen.AsNoTracking().OrderBy(item => item.Naam)
        .Select(item => new PlanningBoardLookupDto(item.Id, item.Naam)).ToListAsync(cancellationToken);
      var functions = await db.PlanningFuncties.AsNoTracking().Where(item => item.Aan)
        .OrderBy(item => item.Naam).Select(item => item.Naam)
        .ToListAsync(cancellationToken);
      var equipment = await db.MaterieelGroepen.AsNoTracking().OrderBy(item => item.Omschrijving)
        .Select(item => new PlanningMaterialLookupDto(item.Id, item.Omschrijving)).ToListAsync(cancellationToken);
      var equipmentItems = await db.MaterieelItems.AsNoTracking().OrderBy(item => item.Omschrijving)
        .Select(item => new PlanningEquipmentLookupDto(
          item.Id, item.Omschrijving ?? item.Zoeknaam ?? item.Kenteken ?? "Materieel", item.MaterieelGroepId))
        .ToListAsync(cancellationToken);
      var articles = await db.Artikelen.AsNoTracking().Where(item => item.Actief)
        .OrderBy(item => item.Naam).Select(item => new PlanningArticleLookupDto(
          item.Id, item.Naam, item.Categorie.Naam, item.Eenheid.Naam)).ToListAsync(cancellationToken);
      return Results.Ok(new PlanningWorkOrderFormReferencesDto(customers, branches, functions, equipment, equipmentItems, articles));
    }).WithSummary("Referenties voor nieuw werkopdrachtformulier ophalen")
      .Produces<PlanningWorkOrderFormReferencesDto>(200).Produces(401).Produces(403);

    group.MapGet("/klanten/{id:int}/recente-werkopdrachten", async (
      int id, VsvkDbContext db, CancellationToken cancellationToken) =>
      Results.Ok(await db.Werkopdrachten.AsNoTracking()
        .Where(item => item.KlantId == id && !item.Geannuleerd)
        .OrderByDescending(item => item.StartDatum).ThenByDescending(item => item.Nummer).Take(4)
        .Select(item => new PlanningRecentWorkOrderDto(
          item.Id, item.Nummer, item.Omschrijving, item.KorteWerkomschrijving, item.Werkadres,
          item.WerkPlaats, item.WerkPostcode, item.StartOpLocatie, item.EindOpLocatie,
          item.Klussen.Select(job => job.BenodigdeMedewerkers).Max(),
          item.Klussen.SelectMany(job => job.Behoeften)
            .Where(need => need.Soort == "mens").Select(need => new PlanningJobNeedDto(
              need.Aantal, need.Rol, need.Skill, null, false, null, "mens")).ToList(),
          item.Klussen.SelectMany(job => job.Behoeften)
            .Where(need => need.Soort == "materieel").Select(need => new PlanningJobNeedDto(
              need.Aantal, need.Rol, need.Skill, need.MaterieelId, need.LosseVerhuur, need.MaterieelGroepId, "materieel")).ToList()))
        .ToListAsync(cancellationToken)))
      .WithSummary("Laatste vier werkopdrachten van klant voor snel starten ophalen")
      .Produces<List<PlanningRecentWorkOrderDto>>(200).Produces(401).Produces(403);

    group.MapPost("/werkopdrachten/drukte", async (
      PlanningWorkOrderCapacityRequest request, VsvkDbContext db, CancellationToken cancellationToken) =>
    {
      if (request.Tot < request.Van || request.Tot.DayNumber - request.Van.DayNumber > 366)
        return Results.BadRequest("Ongeldige capaciteitperiode.");
      var skipped = request.VrijeDagen.Select(DateOnly.Parse).ToHashSet();
      var days = Enumerable.Range(0, request.Tot.DayNumber - request.Van.DayNumber + 1)
        .Select(offset => request.Van.AddDays(offset))
        .Where(day => !skipped.Contains(day)).ToList();
      var peopleResults = new List<PlanningCapacityItemDto>();
      foreach (var grouped in (request.Mensen ?? []).GroupBy(item => item.Rol ?? "Elke functie"))
      {
        var available = await db.UserInformation.AsNoTracking()
          .CountAsync(employee => employee.IsActive &&
            (grouped.Key == "Elke functie" || employee.JobTitle == grouped.Key), cancellationToken);
        var requestedNow = grouped.Sum(item => item.Aantal);
        var worst = 0;
        DateOnly? worstDay = null;
        foreach (var day in days)
        {
          var requestedOther = await db.Klussen.AsNoTracking()
            .Where(job => job.Datum == day && job.Werkopdracht.Geannuleerd == false &&
              job.Behoeften.Any(need => grouped.Key == "Elke functie" || need.Rol == grouped.Key))
            .Select(job => job.Behoeften.Where(need => grouped.Key == "Elke functie" || need.Rol == grouped.Key)
              .Sum(need => need.Aantal)).SumAsync(cancellationToken);
          var total = requestedOther + requestedNow;
          if (total > worst) { worst = total; worstDay = day; }
        }
        var label = worst > available ? "Overvraagd" : available == 0 || worst == 0
          ? (available == 0 ? "Vol" : "Rustig") : worst >= available ? "Vol" : worst >= .7m * available ? "Druk" : "Rustig";
        peopleResults.Add(new(grouped.Key, worst, available, label, worstDay));
      }
      var materialResults = new List<PlanningCapacityItemDto>();
      foreach (var grouped in (request.Materieel ?? []).GroupBy(item => item.Type ?? "Materieel"))
      {
        var groupId = grouped.Select(item => item.MaterieelGroepId).FirstOrDefault();
        var available = groupId is { } id
          ? await db.MaterieelItems.AsNoTracking().CountAsync(item => item.MaterieelGroepId == id, cancellationToken)
          : 0;
        var requested = grouped.Sum(item => item.Aantal);
        materialResults.Add(new(grouped.Key, requested, available,
          requested > available ? "Overvraagd" : available == 0 || requested >= available ? "Vol"
            : requested >= .7m * available ? "Druk" : "Rustig", days.FirstOrDefault()));
      }
      return Results.Ok(new PlanningWorkOrderCapacityDto(peopleResults, materialResults,
        peopleResults.OrderByDescending(item => item.Beschikbaar == 0 ? double.MaxValue : (double)item.Gevraagd / item.Beschikbaar)
          .Select(item => item.DruksteDag).FirstOrDefault(),
        peopleResults.Sum(item => item.Gevraagd), peopleResults.Sum(item => item.Beschikbaar),
        materialResults.Sum(item => item.Gevraagd), materialResults.Sum(item => item.Beschikbaar)));
    }).WithSummary("Drukte-indicatie voor mensen en materieel berekenen")
      .Produces<PlanningWorkOrderCapacityDto>(200).Produces(400).Produces(401).Produces(403);

    group.MapGet("/werkopdrachten/{id:guid}", async (
      Guid id, HttpContext context, PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      var item = await repository.GetAsync(id, cancellationToken);
      if (item is null) return Results.NotFound();
      SetHeaders(context, item.ETag);
      return Results.Ok(item);
    }).WithSummary("Werkopdracht met klussen, inzet en werkbonnen ophalen")
      .Produces<PlanningBoardWorkOrderDto>(200).Produces(401).Produces(403).Produces(404);

    group.MapPost("/werkopdrachten", async (
      PlanningBoardWorkOrderWriteDto request, HttpContext context, VsvkDbContext db,
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasOrganizationWideAccess(context.User))
      {
        var branchId = await ResolveBranchIdAsync(context.User, db, cancellationToken);
        if (branchId is null) return Results.Forbid();
        request = request with { VestigingId = branchId };
      }
      if (!ValidWorkOrder(request, false)) return Results.BadRequest("Controleer de werkopdracht, klussen en inzet.");
      try
      {
        var result = await repository.CreateAsync(request, cancellationToken);
        if (result.Status == PlanningBoardSaveStatus.Invalid)
          return Results.BadRequest("Een klant, medewerker of inhuurmedewerker bestaat niet.");
        var saved = result.WorkOrder!;
        SetHeaders(context, saved.ETag);
        return Results.Created($"/api/planning/werkopdrachten/{saved.Id}", saved);
      }
      catch (DbUpdateException ex) when (IsUniqueViolation(ex))
      {
        return Results.Conflict("Een werkopdracht- of werkbonnummer bestaat al.");
      }
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Werkopdracht met aggregate aanmaken")
      .Produces<PlanningBoardWorkOrderDto>(201).Produces(400).Produces(401).Produces(403).Produces(409);

    group.MapPut("/werkopdrachten/{id:guid}", async (
      Guid id, PlanningBoardWorkOrderWriteDto request, HttpContext context, VsvkDbContext db,
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(
        context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (!VsvkRoles.HasOrganizationWideAccess(context.User))
      {
        var branchId = await ResolveBranchIdAsync(context.User, db, cancellationToken);
        if (branchId is null) return Results.Forbid();
        var owned = await db.Werkopdrachten.AsNoTracking()
          .AnyAsync(order => order.Id == id && order.VestigingId == branchId, cancellationToken);
        if (!owned) return Results.Forbid();
        request = request with { VestigingId = branchId };
      }
      if (!ValidWorkOrder(request, true)) return Results.BadRequest("Controleer de werkopdracht, klussen en inzet.");
      try
      {
        var result = await repository.SaveAsync(id, precondition.Version!.Value, request, cancellationToken);
        if (result.Status == PlanningBoardSaveStatus.NotFound) return Results.NotFound();
        if (result.Status == PlanningBoardSaveStatus.Conflict) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
        if (result.Status == PlanningBoardSaveStatus.Invalid) return Results.BadRequest("Een referentie bestaat niet.");
        var saved = result.WorkOrder!;
        SetHeaders(context, saved.ETag);
        return Results.Ok(saved);
      }
      catch (DbUpdateException ex) when (IsUniqueViolation(ex))
      {
        return Results.Conflict("Een werkopdracht- of werkbonnummer bestaat al.");
      }
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Werkopdrachtaggregate atomair opslaan met If-Match")
      .Produces<PlanningBoardWorkOrderDto>(200).Produces(400).Produces(401).Produces(403)
      .Produces(404).Produces(409).Produces(412).Produces(428);

    group.MapDelete("/werkopdrachten/{id:guid}", async (
      Guid id, HttpContext context, VsvkDbContext db,
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(
        context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (!VsvkRoles.HasOrganizationWideAccess(context.User))
      {
        var branchId = await ResolveBranchIdAsync(context.User, db, cancellationToken);
        if (branchId is null) return Results.Forbid();
        var owned = await db.Werkopdrachten.AsNoTracking()
          .AnyAsync(order => order.Id == id && order.VestigingId == branchId, cancellationToken);
        if (!owned) return Results.Forbid();
      }
      var result = await repository.DeleteAsync(id, precondition.Version!.Value, cancellationToken);
      return result switch
      {
        PlanningBoardSaveStatus.Saved => Results.NoContent(),
        PlanningBoardSaveStatus.NotFound => Results.NotFound(),
        _ => Results.StatusCode(StatusCodes.Status412PreconditionFailed)
      };
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Werkopdrachtaggregate definitief verwijderen met If-Match")
      .Produces(204).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    group.MapGet("/inhuurmedewerkers", async (
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
      Results.Ok(await repository.ListSubcontractorsAsync(cancellationToken)))
      .WithSummary("Inhuurmedewerkers met leverancier ophalen")
      .Produces<List<PlanningSubcontractorListDto>>(200).Produces(401).Produces(403);

    foreach (var lifecycle in new[] { "voorraad", "annuleren" })
      group.MapPost($"/werkopdrachten/{{id:guid}}/{lifecycle}", async (
        Guid id, HttpContext context, PlanningBoardRepository repository, CancellationToken cancellationToken) =>
      {
        var precondition = IfMatchParser.Parse(
          context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
        if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
        var result = await repository.SetLifecycleAsync(id, precondition.Version!.Value, lifecycle, cancellationToken);
        if (result.Status == PlanningBoardSaveStatus.NotFound) return Results.NotFound();
        if (result.Status == PlanningBoardSaveStatus.Conflict) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
        SetHeaders(context, result.WorkOrder!.ETag);
        return Results.Ok(result.WorkOrder);
      }).RequireAuthorization("planning-bord-muteer")
        .Produces<PlanningBoardWorkOrderDto>(200).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    group.MapPost("/inhuurmedewerkers", async (
      PlanningSubcontractorWriteDto request, HttpContext context,
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      if (!ValidSubcontractor(request)) return Results.BadRequest("Controleer de inhuurmedewerker.");
      var result = await repository.CreateSubcontractorAsync(request, cancellationToken);
      if (result.Status == PlanningBoardSaveStatus.Invalid) return Results.BadRequest("De leverancier bestaat niet.");
      SetHeaders(context, result.Subcontractor!.ETag);
      return Results.Created($"/api/planning/inhuurmedewerkers/{result.Subcontractor.Id}", result.Subcontractor);
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Inhuurmedewerker toevoegen")
      .Produces<PlanningSubcontractorListDto>(201).Produces(400).Produces(401).Produces(403);

    group.MapPut("/inhuurmedewerkers/{id:guid}", async (
      Guid id, PlanningSubcontractorWriteDto request, HttpContext context,
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(
        context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (!ValidSubcontractor(request)) return Results.BadRequest("Controleer de inhuurmedewerker.");
      var result = await repository.SaveSubcontractorAsync(id, precondition.Version!.Value, request, cancellationToken);
      if (result.Status == PlanningBoardSaveStatus.NotFound) return Results.NotFound();
      if (result.Status == PlanningBoardSaveStatus.Conflict) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      if (result.Status == PlanningBoardSaveStatus.Invalid) return Results.BadRequest("De leverancier bestaat niet.");
      SetHeaders(context, result.Subcontractor!.ETag);
      return Results.Ok(result.Subcontractor);
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Inhuurmedewerker opslaan met If-Match")
      .Produces<PlanningSubcontractorListDto>(200).Produces(400).Produces(401).Produces(403)
      .Produces(404).Produces(412).Produces(428);

    return app;
  }

  private static bool ValidWorkOrder(PlanningBoardWorkOrderWriteDto request, bool requireNumber)
  {
    if ((requireNumber && (string.IsNullOrWhiteSpace(request.Nummer) || request.Nummer.Length > 50)) ||
        (!requireNumber && request.Nummer?.Length > 50) ||
        (request.KlantId <= 0 && string.IsNullOrWhiteSpace(request.NieuweKlant?.Bedrijfsnaam)) ||
        string.IsNullOrWhiteSpace(request.Omschrijving) ||
        request.Omschrijving.Length > 500 || request.EindDatum < request.StartDatum ||
        !IsColor(request.Kleur))
      return false;
    if (request.Soort == "aangenomen" && string.IsNullOrWhiteSpace(request.InternProjectnummer)) return false;
    var richCreate = request.KorteWerkomschrijving is not null || request.Behoeften is not null ||
      request.Materialen is not null || request.NieuweKlant is not null;
    if (request.NieuweKlant is { } customer &&
        (customer.Bedrijfsnaam?.Trim().Length is < 1 or > 255)) return false;
    if (string.IsNullOrWhiteSpace(request.KorteWerkomschrijving ?? request.Omschrijving)) return false;
    if (richCreate && string.IsNullOrWhiteSpace(request.Werkadres) && string.IsNullOrWhiteSpace(request.GpsLocatie)) return false;
    if (!request.Werkvoorraad && request.EindDatum < request.StartDatum) return false;
    if (richCreate && (request.Behoeften ?? []).Sum(item => item.Aantal) < 1) return false;
    foreach (var job in request.Klussen ?? [])
    {
      if (string.IsNullOrWhiteSpace(job.Omschrijving) || job.Omschrijving.Length > 500 ||
          job.StartDatum < request.StartDatum || job.EindDatum > request.EindDatum ||
          job.EindDatum < job.StartDatum || job.BenodigdeMedewerkers is <= 0 or > 100 ||
          job.Inzetten is not { Count: <= 1000 })
        return false;
      foreach (var assignment in job.Inzetten)
      {
        if (assignment.Datum < job.StartDatum || assignment.Datum > job.EindDatum ||
            assignment.MedewerkerId.HasValue == assignment.InhuurmedewerkerId.HasValue ||
            (assignment.StartTijd is not null && assignment.EindTijd is not null &&
             assignment.EindTijd <= assignment.StartTijd))
          return false;
        if (assignment.Werkbon is { } slip &&
            (string.IsNullOrWhiteSpace(slip.Nummer) || slip.Nummer.Length > 50 ||
             slip.Status is null || !SlipStatuses.Contains(slip.Status)))
          return false;
      }
      foreach (var requirement in job.Behoeften ?? [])
        if (requirement.Aantal <= 0 || (requirement.Rol?.Length ?? 0) > 200 || (requirement.Skill?.Length ?? 0) > 200 ||
            requirement.Soort is not ("mens" or "materieel"))
          return false;
    }
    return (request.Klussen ?? []).SelectMany(job => job.Inzetten ?? [])
      .GroupBy(item => (item.Datum, item.MedewerkerId, item.InhuurmedewerkerId))
      .All(group => group.Count() == 1);
  }

  private static bool ValidSubcontractor(PlanningSubcontractorWriteDto request) =>
    request.LeverancierId > 0 && !string.IsNullOrWhiteSpace(request.Naam) && request.Naam.Length <= 255 &&
    (request.Functie is null || request.Functie.Length <= 200) &&
    (request.Telefoon is null || request.Telefoon.Length <= 50) &&
    (request.Email is null || request.Email.Length <= 255) &&
    (string.IsNullOrWhiteSpace(request.Email) || new EmailAddressAttribute().IsValid(request.Email));

  private static bool IsColor(string? value) =>
    value is { Length: 7 } && value[0] == '#' &&
    value[1..].All(character => Uri.IsHexDigit(character));

  private static bool IsUniqueViolation(DbUpdateException exception) =>
    exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation };

  private static async Task<Guid?> ResolveBranchIdAsync(
    ClaimsPrincipal user, VsvkDbContext context, CancellationToken cancellationToken)
  {
    var branch = VsvkRoles.GetVestiging(user);
    if (string.IsNullOrWhiteSpace(branch)) return null;
    if (Guid.TryParse(branch, out var id)) return id;
    return await context.Vestigingen.AsNoTracking().Where(item => item.Naam == branch)
      .Select(item => (Guid?)item.Id).SingleOrDefaultAsync(cancellationToken);
  }

  private static void SetHeaders(HttpContext context, string etag)
  {
    context.Response.Headers.ETag = etag;
    context.Response.Headers.CacheControl = "private, no-store";
  }
}
