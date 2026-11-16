using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;

namespace Vsvk.Api.Endpoints;

public static class PlanningEmployeeDevelopmentEndpoints
{
  public static WebApplication MapPlanningEmployeeDevelopmentEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning/medewerkers")
      .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireAssertion(context =>
        app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("DevelopmentAccess:Enabled") &&
        context.User.IsInRole(VsvkRoles.Development) && VsvkRoles.IsApplicationUser(context.User)));

    group.MapGet("/vaardigheden", async (IPlanningEmployeeDevelopmentRepository repository, CancellationToken cancellationToken) =>
      Results.Ok(await repository.ListSkillsAsync(cancellationToken)))
      .WithSummary("Bestaande vaardigheden ophalen voor ontwikkelbeheer")
      .Produces<List<PlanningEmployeeLookupDto>>(200).Produces(401).Produces(403);

    group.MapGet("/vestigingen", async (IPlanningEmployeeDevelopmentRepository repository, CancellationToken cancellationToken) =>
      Results.Ok(await repository.ListBranchesAsync(cancellationToken)))
      .WithSummary("Bestaande vestigingen ophalen voor ontwikkelbeheer")
      .Produces<List<PlanningEmployeeLookupDto>>(200).Produces(401).Produces(403);

    group.MapPost("", async (PlanningEmployeeUpdateRequest request, HttpContext context,
      IPlanningEmployeeDevelopmentRepository repository, CancellationToken cancellationToken) =>
    {
      if (!IsValid(request) || string.IsNullOrWhiteSpace(request.Naam))
        return Results.BadRequest("Controleer de medewerkergegevens en vaardigheden.");
      try
      {
        var result = await repository.CreateEmployeeAsync(request, cancellationToken);
        if (result.Status == PlanningEmployeeUpdateStatus.Invalid)
          return Results.BadRequest("Kies bestaande, eenduidige vestigingen en vaardigheden.");
        var employee = result.Employee ?? throw new InvalidOperationException("De aangemaakte medewerker ontbreekt.");
        context.Response.Headers.ETag = employee.ETag;
        context.Response.Headers.CacheControl = "private, no-store";
        return Results.Created($"/api/planning/medewerkers/{employee.Id}", employee);
      }
      catch (DbUpdateException exception) when (exception.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation, ConstraintName: "ux_user_information_employee_number" })
      {
        return Results.Conflict("Dit personeelsnummer bestaat al.");
      }
    }).WithSummary("Medewerker toevoegen zonder account (alleen ontwikkeling)")
      .Produces<PlanningEmployeeDto>(201).Produces(400).Produces(401).Produces(403).Produces(409);

    group.MapPut("/{id:guid}/gegevens", async (Guid id, PlanningEmployeeUpdateRequest request, HttpContext context,
      IPlanningEmployeeDevelopmentRepository repository, CancellationToken cancellationToken) =>
    {
      var precondition = IfMatchParser.Parse(context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (id == Guid.Empty || !IsValid(request)) return Results.BadRequest("Controleer de medewerkergegevens en vaardigheden.");
      var result = await repository.SaveAsync(id, precondition.Version!.Value, request, cancellationToken);
      if (result.Status == PlanningEmployeeUpdateStatus.NotFound) return Results.NotFound();
      if (result.Status == PlanningEmployeeUpdateStatus.Conflict) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      if (result.Status == PlanningEmployeeUpdateStatus.Invalid) return Results.BadRequest("Kies bestaande, eenduidige vestigingen en vaardigheden.");
      context.Response.Headers.ETag = result.Employee!.ETag;
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(result.Employee);
    }).WithSummary("Medewerkergegevens en vaardigheden opslaan met If-Match (alleen ontwikkeling)")
      .Produces<PlanningEmployeeDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);
    return app;
  }

  private static bool IsValid(PlanningEmployeeUpdateRequest request)
  {
    static bool Length(string? value, int max) => value is null || value.Length <= max;
    if (!Length(request.Personeelsnummer, 50) || !Length(request.Naam, 200) || !Length(request.Functie, 200) ||
        !Length(request.Telefoon, 32) || !Length(request.Email, 254) ||
        (request.Email is { Length: > 0 } && !new EmailAddressAttribute().IsValid(request.Email)) ||
        (request.Vestiging is not null && string.IsNullOrWhiteSpace(request.Vestiging)) ||
        request.Actief is null || request.Skills is null || request.Skills.Count > 1000) return false;
    return request.Skills.All(skill => skill is not null && !string.IsNullOrWhiteSpace(skill.Naam) && skill.Naam.Length <= 200 &&
        (skill.DiplomaOp is null || skill.GeldigTot is null || skill.DiplomaOp <= skill.GeldigTot)) &&
      request.Skills.Select(skill => skill.Naam).Distinct(StringComparer.OrdinalIgnoreCase).Count() == request.Skills.Count;
  }
}
