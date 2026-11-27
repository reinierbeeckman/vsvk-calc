using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;

namespace Vsvk.Api.Endpoints;

/// <summary>Ploegen op het planbord: vaste combinaties van mensen en materieel.</summary>
public static class PlanningCrewEndpoints
{
  private const int MaxItems = 100;

  public static WebApplication MapPlanningCrewEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning/ploegen").RequireAuthorization("planning-lijsten");

    group.MapGet("", async (
      ClaimsPrincipal user, VsvkDbContext db, PlanningCrewRepository repository, CancellationToken cancellationToken) =>
    {
      Guid? branchId = null;
      if (!VsvkRoles.HasOrganizationWideAccess(user))
      {
        branchId = await ResolveBranchIdAsync(user, db, cancellationToken);
        if (branchId is null) return Results.Forbid();
      }
      return Results.Ok(await repository.ListAsync(branchId, cancellationToken));
    }).WithSummary("Ploegen van de eigen vestiging en gedeelde ploegen ophalen")
      .Produces<List<PlanningCrewDto>>(200).Produces(401).Produces(403);

    group.MapPost("", async (
      PlanningCrewWriteDto request, HttpContext context, VsvkDbContext db,
      PlanningCrewRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasOrganizationWideAccess(context.User))
      {
        var branchId = await ResolveBranchIdAsync(context.User, db, cancellationToken);
        if (branchId is null) return Results.Forbid();
        request = request with { VestigingId = branchId };
      }
      if (!Valid(request)) return Results.BadRequest("Controleer de naam, leden en het materieel van de ploeg.");
      var result = await repository.CreateAsync(request, cancellationToken);
      if (result.Status == PlanningBoardSaveStatus.Invalid)
        return Results.BadRequest("Een medewerker, materieelstuk of vestiging bestaat niet.");
      SetHeaders(context, result.Crew!.ETag);
      return Results.Created($"/api/planning/ploegen/{result.Crew.Id}", result.Crew);
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Ploeg aanmaken")
      .Produces<PlanningCrewDto>(201).Produces(400).Produces(401).Produces(403);

    group.MapPut("/{id:guid}", async (
      Guid id, PlanningCrewWriteDto request, HttpContext context, VsvkDbContext db,
      PlanningCrewRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(
        context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (await DeniedAsync(id, context.User, db, repository, cancellationToken)) return Results.Forbid();
      if (!Valid(request)) return Results.BadRequest("Controleer de naam, leden en het materieel van de ploeg.");
      var result = await repository.SaveAsync(id, precondition.Version!.Value, request, cancellationToken);
      return result.Status switch
      {
        PlanningBoardSaveStatus.NotFound => Results.NotFound(),
        PlanningBoardSaveStatus.Conflict => Results.StatusCode(StatusCodes.Status412PreconditionFailed),
        PlanningBoardSaveStatus.Invalid => Results.BadRequest("Een medewerker of materieelstuk bestaat niet."),
        _ => Saved(context, result.Crew!)
      };
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Ploeg atomair opslaan met If-Match")
      .Produces<PlanningCrewDto>(200).Produces(400).Produces(401).Produces(403)
      .Produces(404).Produces(412).Produces(428);

    group.MapDelete("/{id:guid}", async (
      Guid id, HttpContext context, VsvkDbContext db,
      PlanningCrewRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(
        context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (await DeniedAsync(id, context.User, db, repository, cancellationToken)) return Results.Forbid();
      return await repository.DeleteAsync(id, precondition.Version!.Value, cancellationToken) switch
      {
        PlanningBoardSaveStatus.Saved => Results.NoContent(),
        PlanningBoardSaveStatus.NotFound => Results.NotFound(),
        _ => Results.StatusCode(StatusCodes.Status412PreconditionFailed)
      };
    }).RequireAuthorization("planning-bord-muteer")
      .WithSummary("Ploeg verwijderen met If-Match")
      .Produces(204).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    return app;
  }

  public static bool Valid(PlanningCrewWriteDto request)
  {
    var naam = request.Naam?.Trim();
    if (string.IsNullOrEmpty(naam) || naam.Length > 200) return false;
    var members = request.Leden ?? [];
    var equipment = request.Materieel ?? [];
    if (members.Count > MaxItems || equipment.Count > MaxItems) return false;
    if (members.Contains(Guid.Empty) || members.Distinct().Count() != members.Count) return false;
    if (equipment.Any(item => item is null || item.MaterieelId == Guid.Empty) ||
        equipment.Select(item => item.MaterieelId).Distinct().Count() != equipment.Count) return false;
    return equipment.All(item => item.MedewerkerId is not { } operatorId || members.Contains(operatorId));
  }

  /// <summary>Gebruikers zonder organisatiebrede toegang wijzigen alleen ploegen van hun eigen vestiging of gedeelde ploegen.</summary>
  private static async Task<bool> DeniedAsync(
    Guid id, ClaimsPrincipal user, VsvkDbContext db, PlanningCrewRepository repository, CancellationToken cancellationToken)
  {
    if (VsvkRoles.HasOrganizationWideAccess(user)) return false;
    var branchId = await ResolveBranchIdAsync(user, db, cancellationToken);
    if (branchId is null) return true;
    if (await repository.IsVisibleAsync(id, branchId.Value, cancellationToken)) return false;
    // Een onbekende ploeg geeft 404 via de repository, geen 403.
    return await db.Ploegen.AsNoTracking().AnyAsync(crew => crew.Id == id, cancellationToken);
  }

  private static async Task<Guid?> ResolveBranchIdAsync(
    ClaimsPrincipal user, VsvkDbContext context, CancellationToken cancellationToken)
  {
    var branch = VsvkRoles.GetVestiging(user);
    if (string.IsNullOrWhiteSpace(branch)) return null;
    if (Guid.TryParse(branch, out var id)) return id;
    return await context.Vestigingen.AsNoTracking().Where(item => item.Naam == branch)
      .Select(item => (Guid?)item.Id).SingleOrDefaultAsync(cancellationToken);
  }

  private static IResult Saved(HttpContext context, PlanningCrewDto crew)
  {
    SetHeaders(context, crew.ETag);
    return Results.Ok(crew);
  }

  private static void SetHeaders(HttpContext context, string etag)
  {
    context.Response.Headers.ETag = etag;
    context.Response.Headers.CacheControl = "private, no-store";
  }
}
