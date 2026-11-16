using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;
using Vsvk.Api.Services;

namespace Vsvk.Api.Endpoints;

public static class PlanningEndpoints
{
  public static WebApplication MapPlanningEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning").RequireAuthorization("planning-lijsten");

    group.MapGet("/klanten", async (HttpContext context, IPlanningCustomerService service, CancellationToken cancellationToken) =>
      CustomerResponse(context, await service.ListAsync(cancellationToken)))
      .RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Klanten voor planning ophalen")
      .Produces<List<PlanningCustomerListDto>>(200).Produces(401).Produces(403);

    group.MapGet("/klanten/{id:int}", async (int id, HttpContext context, IPlanningCustomerService service, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var customer = await service.GetAsync(id, cancellationToken);
      return customer is null ? Results.NotFound() : CustomerResponse(context, customer);
    }).RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Klant met contactpersonen ophalen")
      .Produces<PlanningCustomerDetailDto>(200).Produces(400).Produces(401).Produces(403).Produces(404);

    group.MapGet("/tarieven", async (HttpContext context, IPlanningCustomerService service, CancellationToken cancellationToken) =>
      CustomerResponse(context, await service.ListRatesAsync(cancellationToken)))
      .RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Actuele standaardtarieven ophalen")
      .Produces<List<PlanningStandardRateDto>>(200).Produces(401).Produces(403);

    group.MapGet("/tarieven/{id:int}/prijs", async (int id, HttpContext context, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var price = await repository.GetStandardPriceAsync(id, cancellationToken);
      if (price is null) return Results.NotFound();
      context.Response.Headers.ETag = price.ETag;
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(price);
    }).RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Standaardtariefprijs ophalen")
      .Produces<PlanningStandardPriceDto>(200).Produces(400).Produces(401).Produces(403).Produces(404);

    group.MapPut("/tarieven/{id:int}/prijs", async (int id, PlanningStandardPriceRequest request, HttpContext context, PlanningRepository repository, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var precondition = IfMatchParser.Parse(context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (request.Prijs is null || request.Prijs < 0 || request.Prijs >= 100000000 || decimal.Round(request.Prijs.Value, 2) != request.Prijs.Value)
        return Results.BadRequest("Vul een geldig tarief in met maximaal twee decimalen.");
      if (await repository.GetStandardPriceAsync(id, cancellationToken) is null) return Results.NotFound();
      var price = await repository.SaveStandardPriceAsync(id, precondition.Version!.Value, request.Prijs.Value, cancellationToken);
      if (price is null) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      context.Response.Headers.ETag = price.ETag;
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(price);
    }).RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Standaardtariefprijs opslaan met If-Match")
      .Produces<PlanningStandardPriceDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    group.MapGet("/klanten/{id:int}/tarieven", async (int id, HttpContext context, IPlanningCustomerService service, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var rates = await service.GetRatesAsync(id, cancellationToken);
      if (rates is null) return Results.NotFound();
      context.Response.Headers.ETag = rates.ETag;
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(rates);
    }).RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Afwijkende klanttarieven ophalen")
      .Produces<PlanningCustomerRatesDto>(200).Produces(400).Produces(401).Produces(403).Produces(404);

    group.MapPut("/klanten/{id:int}/tarieven", async (int id, PlanningCustomerRatesRequest request, HttpContext context, IPlanningCustomerService service, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var precondition = IfMatchParser.Parse(context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      var overrides = request.Afwijkingen;
      if (overrides is null || overrides.Count > 1000 || overrides.Any(item => item is null || item.FunctieId <= 0 ||
        item.Tarief is null || item.Tarief < 0 || item.Tarief >= 100000000 || decimal.Round(item.Tarief.Value, 2) != item.Tarief.Value) ||
        overrides.Select(item => item.FunctieId).Distinct().Count() != overrides.Count)
        return Results.BadRequest("Controleer de functies en tarieven.");
      if (await service.GetRatesAsync(id, cancellationToken) is null) return Results.NotFound();
      var saved = await service.SaveRatesAsync(id, precondition.Version!.Value, overrides, cancellationToken);
      if (saved.Invalid) return Results.BadRequest("Een functie heeft geen geldig standaardtarief of is niet actief.");
      if (saved.Rates is null) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      context.Response.Headers.ETag = saved.Rates.ETag;
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(saved.Rates);
    }).RequireAuthorization(policy => policy.RequireRole(VsvkRoles.Directie))
      .WithSummary("Afwijkende klanttarieven opslaan met If-Match")
      .Produces<PlanningCustomerRatesDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

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

  private static IResult CustomerResponse<T>(HttpContext context, T value)
  {
    var json = JsonSerializer.SerializeToUtf8Bytes(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
    context.Response.Headers.ETag = '"' + Convert.ToHexString(SHA256.HashData(json)) + '"';
    context.Response.Headers.CacheControl = "private, no-store";
    return Results.Bytes(json, "application/json; charset=utf-8");
  }
}
