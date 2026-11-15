using System.Security.Claims;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;

namespace Vsvk.Api.Endpoints;

public static class PlanningEndpoints
{
  public static WebApplication MapPlanningEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning").RequireAuthorization("planning-lijsten");

    group.MapGet("/medewerkers", async (ClaimsPrincipal user, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasRequiredVestigingScope(user)) return Results.Forbid();
      return Results.Ok(await repository.ListEmployeesAsync(Branch(user), cancellationToken));
    }).Produces<List<PlanningEmployeeDto>>(200).Produces(401).Produces(403);

    group.MapGet("/medewerkers/{id:guid}", async (Guid id, HttpContext context, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasRequiredVestigingScope(context.User)) return Results.Forbid();
      var employee = await repository.GetEmployeeAsync(id, Branch(context.User), cancellationToken);
      if (employee is null) return Results.NotFound();
      context.Response.Headers.ETag = employee.ETag;
      return Results.Ok(employee);
    }).Produces<PlanningEmployeeDto>(200).Produces(401).Produces(403).Produces(404);

    group.MapPut("/medewerkers/{id:guid}/actief", async (Guid id, PlanningActiveRequest request, HttpContext context, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasRequiredVestigingScope(context.User)) return Results.Forbid();
      var precondition = IfMatchParser.Parse(context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (request.Actief is null) return Results.BadRequest("Actief is verplicht.");
      var employee = await repository.GetEmployeeAsync(id, Branch(context.User), cancellationToken);
      if (employee is null) return Results.NotFound();
      var updated = await repository.SetEmployeeActiveAsync(id, request.Actief.Value, precondition.Version!.Value, Branch(context.User), cancellationToken);
      if (updated is null) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      context.Response.Headers.ETag = updated.ETag;
      return Results.Ok(updated);
    }).Produces<PlanningEmployeeDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    group.MapGet("/materieel", async (ClaimsPrincipal user, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (!VsvkRoles.HasRequiredVestigingScope(user)) return Results.Forbid();
      return Results.Ok(await repository.ListEquipmentAsync(Branch(user), cancellationToken));
    }).Produces<List<PlanningMaterieelDto>>(200).Produces(401).Produces(403);

    return app;
  }

  private static string? Branch(ClaimsPrincipal user) =>
    VsvkRoles.HasOrganizationWideAccess(user) ? null : VsvkRoles.GetVestiging(user);
}
