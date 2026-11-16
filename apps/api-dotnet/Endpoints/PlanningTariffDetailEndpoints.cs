using Vsvk.Api.Auth;
using Vsvk.Api.Http;
using Vsvk.Api.Services;

namespace Vsvk.Api.Endpoints;

public static class PlanningTariffDetailEndpoints
{
  public static WebApplication MapPlanningTariffDetailEndpoints(this WebApplication app)
  {
    app.MapPost("/api/planning/tarieven", async (PlanningTariffDetailRequest request, HttpContext http,
      IPlanningTariffDetailService service, CancellationToken cancellationToken) =>
    {
      if (!Valid(request)) return Results.BadRequest("Controleer functie, actief, prijs, eenheid en geldig vanaf.");
      var saved = await service.CreateAsync(request, cancellationToken);
      http.Response.Headers.ETag = saved.ETag;
      http.Response.Headers.CacheControl = "private, no-store";
      return Results.Created($"/api/planning/tarieven/{saved.Id}/detail", saved);
    }).RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireAssertion(auth =>
      app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("DevelopmentAccess:Enabled") &&
      auth.User.IsInRole(VsvkRoles.Development) && VsvkRoles.IsApplicationUser(auth.User)))
      .WithSummary("Ontwikkelomgeving: standaardtarief toevoegen")
      .Produces<PlanningTariffDetailDto>(201).Produces(400).Produces(401).Produces(403);

    var group = app.MapGroup("/api/planning/tarieven/{id:int}/detail")
      .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireAssertion(auth =>
        app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("DevelopmentAccess:Enabled") &&
        auth.User.IsInRole(VsvkRoles.Development) && VsvkRoles.IsApplicationUser(auth.User)));

    group.MapGet("", async (int id, HttpContext http, IPlanningTariffDetailService service, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var item = await service.GetAsync(id, cancellationToken);
      if (item is null) return Results.NotFound();
      http.Response.Headers.ETag = item.ETag;
      http.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(item);
    }).WithSummary("Ontwikkelomgeving: standaardtariefdetail ophalen")
      .Produces<PlanningTariffDetailDto>(200).Produces(400).Produces(401).Produces(403).Produces(404);

    group.MapPut("", async (int id, PlanningTariffDetailRequest request, HttpContext http,
      IPlanningTariffDetailService service, CancellationToken cancellationToken) =>
    {
      if (id <= 0) return Results.BadRequest();
      var match = IfMatchParser.Parse(http.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!match.IsValid) return Results.StatusCode(match.StatusCode);
      if (!Valid(request))
        return Results.BadRequest("Controleer functie, actief, prijs, eenheid en geldig vanaf.");
      if (await service.GetAsync(id, cancellationToken) is null) return Results.NotFound();
      var saved = await service.SaveAsync(id, match.Version!.Value, request, cancellationToken);
      if (saved is null) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      http.Response.Headers.ETag = saved.ETag;
      http.Response.Headers.CacheControl = "private, no-store";
      return Results.Ok(saved);
    }).WithSummary("Ontwikkelomgeving: standaardtariefdetail opslaan met If-Match")
      .Produces<PlanningTariffDetailDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);
    return app;
  }

  private static bool ValidText(string? value, int maxLength) =>
    !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength && !value.Any(char.IsControl);

  private static bool Valid(PlanningTariffDetailRequest request) =>
    ValidText(request.Functie, 255) && ValidText(request.Eenheid, 50) && request.Actief is not null && request.GeldigVanaf is not null &&
    request.Prijs is not null && request.Prijs >= 0 && request.Prijs < 100000000 && decimal.Round(request.Prijs.Value, 2) == request.Prijs.Value;
}

