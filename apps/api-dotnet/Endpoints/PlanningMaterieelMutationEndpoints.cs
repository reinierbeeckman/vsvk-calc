using System.Security.Cryptography;
using System.Text.Json;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;

namespace Vsvk.Api.Endpoints;

public static class PlanningMaterieelMutationEndpoints
{
  public static IServiceCollection AddPlanningMaterieelMutations(this IServiceCollection services) =>
    services.AddScoped<IPlanningMaterieelMutationRepository, PlanningMaterieelMutationRepository>();

  public static WebApplication MapPlanningMaterieelMutationEndpoints(this WebApplication app)
  {
    var group = app.MapGroup("/api/planning/materieel")
      .RequireAuthorization(policy => policy.RequireAuthenticatedUser().RequireAssertion(context =>
        app.Environment.IsDevelopment() && app.Configuration.GetValue<bool>("DevelopmentAccess:Enabled")
        && context.User.IsInRole(VsvkRoles.Development) && VsvkRoles.IsApplicationUser(context.User)));

    group.MapGet("/referenties", async (IPlanningMaterieelMutationRepository repository, HttpContext context, CancellationToken ct) =>
    {
      var references = await repository.GetReferencesAsync(ct);
      var json = JsonSerializer.SerializeToUtf8Bytes(references, new JsonSerializerOptions(JsonSerializerDefaults.Web));
      context.Response.Headers.ETag = '"' + Convert.ToHexString(SHA256.HashData(json)) + '"';
      context.Response.Headers.CacheControl = "private, no-store";
      return Results.Bytes(json, "application/json; charset=utf-8");
    }).WithSummary("Bestaande materieelgroepen en vestigingen ophalen voor ontwikkeling")
      .Produces<PlanningMaterieelReferencesDto>(200).Produces(401).Produces(403);

    group.MapGet("/{id:guid}", async (Guid id, IPlanningMaterieelMutationRepository repository, HttpContext context, CancellationToken ct) =>
    {
      var item = await repository.GetAsync(id, ct);
      if (item is null) return Results.NotFound();
      SetHeaders(context, item);
      return Results.Ok(item);
    }).WithSummary("Bestaand materieel ophalen voor ontwikkeling")
      .Produces<PlanningMaterieelEditDto>(200).Produces(401).Produces(403).Produces(404);

    group.MapPost("", async (PlanningMaterieelUpdateRequest request, IPlanningMaterieelMutationRepository repository, HttpContext context, CancellationToken ct) =>
    {
      if (!Valid(request) || string.IsNullOrWhiteSpace(request.Omschrijving))
        return Results.BadRequest("Controleer de materieelgegevens en referenties.");
      var created = await repository.CreateAsync(request, ct);
      if (created.Invalid) return Results.BadRequest("Een groep of vestiging bestaat niet.");
      var item = created.Materieel ?? throw new InvalidOperationException("Het aangemaakte materieel kon niet worden opgehaald.");
      SetHeaders(context, item);
      return Results.Created($"/api/planning/materieel/{item.Id}", item);
    }).WithSummary("Materieel toevoegen voor ontwikkeling")
      .Produces<PlanningMaterieelEditDto>(201).Produces(400).Produces(401).Produces(403);

    group.MapPut("/{id:guid}", async (Guid id, PlanningMaterieelUpdateRequest request, IPlanningMaterieelMutationRepository repository, HttpContext context, CancellationToken ct) =>
    {
      var precondition = IfMatchParser.Parse(context.Request.Headers.TryGetValue("If-Match", out var values) ? values.ToString() : null);
      if (!precondition.IsValid) return Results.StatusCode(precondition.StatusCode);
      if (!Valid(request)) return Results.BadRequest("Controleer de materieelgegevens en referenties.");
      if (await repository.GetAsync(id, ct) is null) return Results.NotFound();
      var saved = await repository.SaveAsync(id, precondition.Version!.Value, request, ct);
      if (saved.Invalid) return Results.BadRequest("Een groep of vestiging bestaat niet.");
      if (saved.Materieel is null) return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
      SetHeaders(context, saved.Materieel);
      return Results.Ok(saved.Materieel);
    }).WithSummary("Bestaand materieel wijzigen voor ontwikkeling met If-Match")
      .Produces<PlanningMaterieelEditDto>(200).Produces(400).Produces(401).Produces(403).Produces(404).Produces(412).Produces(428);

    return app;
  }

  private static bool Valid(PlanningMaterieelUpdateRequest request) =>
    new[] { request.Omschrijving, request.Kenteken, request.Merk, request.Zoeknaam, request.Serienummer }
      .All(value => value is null || (value.Length <= 500 && !value.Contains('\0')))
    && request.StandplaatsId != Guid.Empty && request.MaterieelGroepId != Guid.Empty;

  private static void SetHeaders(HttpContext context, PlanningMaterieelEditDto item)
  {
    context.Response.Headers.ETag = item.ETag;
    context.Response.Headers.CacheControl = "private, no-store";
  }
}
