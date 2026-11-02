using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Endpoints;

public static class ArtikelEndpoints
{
  public static WebApplication MapArtikelEndpoints(this WebApplication app)
  {
    app.MapGet("/api/article-categories", async Task<Ok<IReadOnlyList<ArtikelCategorieDto>>> (
      ClaimsPrincipal user, ArtikelRepository repository, CancellationToken cancellationToken) =>
        TypedResults.Ok(await repository.ListCategorieenAsync(user, cancellationToken)))
      .WithName("GetArticleCategories")
      .WithSummary("Haalt artikelcategorieën uit de relationele opzoektabel op")
      .Produces<IReadOnlyList<ArtikelCategorieDto>>(StatusCodes.Status200OK)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapGet("/api/article-units", async Task<Ok<IReadOnlyList<ArtikelEenheidDto>>> (
      ClaimsPrincipal user, ArtikelRepository repository, CancellationToken cancellationToken) =>
        TypedResults.Ok(await repository.ListEenhedenAsync(user, cancellationToken)))
      .WithName("GetArticleUnits")
      .WithSummary("Haalt artikeleenheden uit de relationele opzoektabel op")
      .Produces<IReadOnlyList<ArtikelEenheidDto>>(StatusCodes.Status200OK)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapGet("/api/articles", async Task<Ok<List<ArtikelDto>>> (
      ClaimsPrincipal user, ArtikelRepository repository, CancellationToken cancellationToken) =>
        TypedResults.Ok(await repository.ListAsync(user, cancellationToken)))
      .WithName("GetArticles")
      .WithSummary("Haalt artikelen uit PostgreSQL op; directie ziet ook inactieve artikelen")
      .Produces<List<ArtikelDto>>(StatusCodes.Status200OK)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapGet("/api/articles/autocomplete", async Task<Ok<List<ArtikelDto>>> (
      string? q, int? limit, ArtikelRepository repository, CancellationToken cancellationToken) =>
        TypedResults.Ok(await repository.AutocompleteAsync(q ?? string.Empty, limit ?? 10, cancellationToken)))
      .WithName("AutocompleteArticles")
      .WithSummary("Zoekt actieve artikelen met categorie en eenheid")
      .Produces<List<ArtikelDto>>(StatusCodes.Status200OK)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapGet("/api/articles/{id:guid}", async Task<Results<Ok<ArtikelDto>, NotFound>> (
      Guid id, HttpContext context, ClaimsPrincipal user, ArtikelRepository repository, CancellationToken cancellationToken) =>
      {
        var artikel = await repository.GetByIdAsync(id, user.IsInRole(VsvkRoles.Directie), cancellationToken);
        if (artikel is null)
        {
          return TypedResults.NotFound();
        }

        context.Response.Headers.ETag = artikel.ETag;
        return TypedResults.Ok(artikel);
      })
      .WithName("GetArticleById")
      .WithSummary("Haalt één artikel op")
      .Produces<ArtikelDto>(StatusCodes.Status200OK)
      .Produces(StatusCodes.Status404NotFound)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapPost("/api/articles", async Task<Results<Created<ArtikelDto>, BadRequest<string>, Conflict<string>>> (
      HttpContext context, ArtikelRequest request, ArtikelRepository repository, CancellationToken cancellationToken) =>
      {
        var validationError = Validate(request);
        if (validationError is not null)
        {
          return TypedResults.BadRequest(validationError);
        }

        if (!await repository.LookupIdsExistAsync(request.CategorieId, request.EenheidId, cancellationToken))
        {
          return TypedResults.BadRequest("Kies een bestaande, actieve categorie en eenheid.");
        }

        try
        {
          var artikel = await repository.CreateAsync(request, cancellationToken);
          context.Response.Headers.ETag = artikel.ETag;
          return TypedResults.Created($"/api/articles/{artikel.Id}", artikel);
        }
        catch (DbUpdateException exception) when (ArtikelRepository.IsUniqueViolation(exception))
        {
          return TypedResults.Conflict("Er bestaat al een artikel met deze naam.");
        }
      })
      .WithName("CreateArticle")
      .WithSummary("Maakt een artikel aan; alleen directie heeft schrijfrechten")
      .Produces<ArtikelDto>(StatusCodes.Status201Created)
      .Produces<string>(StatusCodes.Status400BadRequest)
      .Produces<string>(StatusCodes.Status409Conflict)
      .RequireAuthorization("directie");

    app.MapPut("/api/articles/{id:guid}", async Task<IResult> (HttpContext context, Guid id, ArtikelRequest request, ArtikelRepository repository, CancellationToken cancellationToken) =>
      {
        var precondition = ReadIfMatch(context.Request);
        if (!precondition.IsValid)
        {
          return TypedResults.StatusCode(precondition.StatusCode);
        }

        var validationError = Validate(request);
        if (validationError is not null)
        {
          return TypedResults.BadRequest(validationError);
        }

        if (!await repository.LookupIdsExistAsync(request.CategorieId, request.EenheidId, cancellationToken))
        {
          return TypedResults.BadRequest("Kies een bestaande, actieve categorie en eenheid.");
        }

        try
        {
          var existing = await repository.GetByIdAsync(id, includeInactive: true, cancellationToken);
          if (existing is null)
          {
            return TypedResults.NotFound();
          }

          var artikel = await repository.UpdateAsync(id, request, precondition.Version!.Value, cancellationToken);
          if (artikel is null)
          {
            return TypedResults.StatusCode(StatusCodes.Status412PreconditionFailed);
          }

          context.Response.Headers.ETag = artikel.ETag;
          return TypedResults.Ok(artikel);
        }
        catch (DbUpdateException exception) when (ArtikelRepository.IsUniqueViolation(exception))
        {
          return TypedResults.Conflict("Er bestaat al een artikel met deze naam.");
        }
      })
      .WithName("UpdateArticle")
      .WithSummary("Wijzigt een artikel; alleen directie heeft schrijfrechten")
      .Produces<ArtikelDto>(StatusCodes.Status200OK)
      .Produces(StatusCodes.Status404NotFound)
      .Produces<string>(StatusCodes.Status400BadRequest)
      .Produces<string>(StatusCodes.Status409Conflict)
      .Produces(StatusCodes.Status412PreconditionFailed)
      .Produces(StatusCodes.Status428PreconditionRequired)
      .RequireAuthorization("directie");

    app.MapDelete("/api/articles/{id:guid}", async Task<IResult> (HttpContext context, Guid id, ArtikelRepository repository, CancellationToken cancellationToken) =>
      {
        var precondition = ReadIfMatch(context.Request);
        if (!precondition.IsValid)
        {
          return TypedResults.StatusCode(precondition.StatusCode);
        }

        var existing = await repository.GetByIdAsync(id, includeInactive: true, cancellationToken);
        if (existing is null)
        {
          return TypedResults.NotFound();
        }

        var deactivated = await repository.DeactivateAsync(id, precondition.Version!.Value, cancellationToken);
        if (deactivated is null)
        {
          return TypedResults.StatusCode(StatusCodes.Status412PreconditionFailed);
        }

        context.Response.Headers.ETag = deactivated.ETag;
        return TypedResults.NoContent();
      })
      .WithName("DeactivateArticle")
      .WithSummary("Deactiveert een artikel zonder historische calculaties te verwijderen")
      .Produces(StatusCodes.Status204NoContent)
      .Produces(StatusCodes.Status404NotFound)
      .Produces(StatusCodes.Status400BadRequest)
      .Produces(StatusCodes.Status412PreconditionFailed)
      .Produces(StatusCodes.Status428PreconditionRequired)
      .RequireAuthorization("directie");

    return app;
  }

  private static Vsvk.Api.Http.IfMatchParseResult ReadIfMatch(HttpRequest request)
  {
    if (!request.Headers.TryGetValue("If-Match", out var values))
    {
      return Vsvk.Api.Http.IfMatchParser.Parse(null);
    }

    return Vsvk.Api.Http.IfMatchParser.Parse(values.ToString());
  }

  private static string? Validate(ArtikelRequest request)
  {
    if (string.IsNullOrWhiteSpace(request.Naam) || request.Naam.Trim().Length > 200)
    {
      return "De artikelnaam is verplicht en mag maximaal 200 tekens bevatten.";
    }

    if (request.CategorieId == Guid.Empty || request.EenheidId == Guid.Empty)
    {
      return "Categorie en eenheid zijn verplicht.";
    }

    if (request.TariefSoort == "vast" && request.Tarief is null or < 0)
    {
      return "Een vast tarief moet nul of hoger zijn.";
    }

    if (request.TariefSoort == "zie_prijs" && request.Tarief is not null)
    {
      return "Bij tariefsoort zie_prijs hoort geen bedrag.";
    }

    return request.TariefSoort is "vast" or "zie_prijs" ? null : "Ongeldige tariefsoort.";
  }
}
