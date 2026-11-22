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
      if (!ValidWorkOrder(request)) return Results.BadRequest("Controleer de werkopdracht, klussen en inzet.");
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
      if (!ValidWorkOrder(request)) return Results.BadRequest("Controleer de werkopdracht, klussen en inzet.");
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

    group.MapGet("/inhuurmedewerkers", async (
      PlanningBoardRepository repository, CancellationToken cancellationToken) =>
      Results.Ok(await repository.ListSubcontractorsAsync(cancellationToken)))
      .WithSummary("Inhuurmedewerkers met leverancier ophalen")
      .Produces<List<PlanningSubcontractorListDto>>(200).Produces(401).Produces(403);

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

  private static bool ValidWorkOrder(PlanningBoardWorkOrderWriteDto request)
  {
    if (string.IsNullOrWhiteSpace(request.Nummer) || request.Nummer.Length > 50 ||
        request.KlantId <= 0 || string.IsNullOrWhiteSpace(request.Omschrijving) ||
        request.Omschrijving.Length > 500 || request.EindDatum < request.StartDatum ||
        !IsColor(request.Kleur) || request.Klussen is not { Count: > 0 and <= 200 })
      return false;
    foreach (var job in request.Klussen)
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
        if (requirement.Aantal <= 0 || (requirement.Rol?.Length ?? 0) > 200 || (requirement.Skill?.Length ?? 0) > 200)
          return false;
    }
    return request.Klussen.SelectMany(job => job.Inzetten ?? [])
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
