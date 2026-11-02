using System.Security.Claims;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Vsvk.Api.Auth;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;
using Vsvk.Api.Services;

namespace Vsvk.Api.Endpoints;

public static class UserProfileEndpoints
{
  public const long MaximumMultipartRequestBytes = 1_114_112;

  public static WebApplication MapUserProfileEndpoints(this WebApplication app)
  {
    app.MapGet("/api/user/profile", GetProfile)
      .WithName("GetCurrentUserProfile")
      .WithSummary("Haalt het profiel van de ingelogde gebruiker op")
      .WithDescription("Maakt bij het eerste verzoek een leeg profiel aan op basis van het gevalideerde Keycloak-subject.")
      .Produces<UserProfileResponse>(StatusCodes.Status200OK)
      .Produces(StatusCodes.Status401Unauthorized)
      .Produces(StatusCodes.Status503ServiceUnavailable)
      .RequireAuthorization(VsvkRoles.Default);

    app.MapPut("/api/user/profile", UpdateProfile)
      .WithName("UpdateCurrentUserProfile")
      .WithSummary("Werkt het profiel van de ingelogde gebruiker bij")
      .WithDescription("Vereist een strong If-Match-ETag. Het telefoonnummer en alternatieve e-mailadres zijn verplicht; de handtekening is optioneel.")
      .Accepts<IFormCollection>("multipart/form-data")
      .Produces<UserProfileResponse>(StatusCodes.Status200OK)
      .ProducesValidationProblem(StatusCodes.Status400BadRequest)
      .Produces(StatusCodes.Status401Unauthorized)
      .Produces(StatusCodes.Status412PreconditionFailed)
      .Produces(StatusCodes.Status413PayloadTooLarge)
      .Produces(StatusCodes.Status428PreconditionRequired)
      .Produces(StatusCodes.Status503ServiceUnavailable)
      .WithMetadata(new RequestSizeLimitAttribute(MaximumMultipartRequestBytes))
      .RequireAuthorization(VsvkRoles.Default);

    return app;
  }

  private static async Task<Results<Ok<UserProfileResponse>, UnauthorizedHttpResult>> GetProfile(
    HttpContext context,
    IUserProfileService service,
    CancellationToken cancellationToken)
  {
    if (!KeycloakSubject.TryGetUserId(context.User, out var subject))
    {
      return TypedResults.Unauthorized();
    }

    var profile = await service.GetOrCreateAsync(subject, cancellationToken);
    context.Response.Headers.ETag = StrongEtag.Format(profile.Version);
    context.Response.Headers.CacheControl = "no-store";
    return TypedResults.Ok(ToResponse(profile, context.User));
  }

  private static async Task<IResult> UpdateProfile(
    HttpContext context,
    IUserProfileService service,
    CancellationToken cancellationToken)
  {
    var precondition = ReadIfMatch(context.Request);
    if (!precondition.IsValid)
    {
      return TypedResults.StatusCode(precondition.StatusCode);
    }

    if (!KeycloakSubject.TryGetUserId(context.User, out var subject))
    {
      return TypedResults.Unauthorized();
    }

    if (context.Request.ContentLength > MaximumMultipartRequestBytes)
    {
      return TypedResults.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    if (context.Request.ContentType is not { } contentType
        || !contentType.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase))
    {
      return TypedResults.BadRequest(new { error = "Gebruik multipart/form-data voor profielwijzigingen." });
    }

    IFormCollection form;
    try
    {
      form = await context.Request.ReadFormAsync(cancellationToken);
    }
    catch (InvalidDataException)
    {
      return TypedResults.StatusCode(StatusCodes.Status413PayloadTooLarge);
    }

    var removeSignatureText = form["removeSignature"].ToString();
    if (!string.IsNullOrWhiteSpace(removeSignatureText) && !bool.TryParse(removeSignatureText, out _))
    {
      return TypedResults.ValidationProblem(new Dictionary<string, string[]>
      {
        ["removeSignature"] = ["Kies een geldige waarde."]
      });
    }

    var removeSignature = bool.TryParse(removeSignatureText, out var removeValue) && removeValue;
    if (form.Files.Count > 1 || form.Files.Any(file => !string.Equals(file.Name, "signature", StringComparison.Ordinal)))
    {
      return TypedResults.ValidationProblem(new Dictionary<string, string[]>
      {
        ["signature"] = ["Upload maximaal één handtekeningbestand in het veld signature."]
      });
    }

    ProfileSignature? signature = null;
    var file = form.Files.GetFile("signature");
    if (file is not null)
    {
      if (file.Length is 0 or > UserProfileService.MaximumSignatureBytes)
      {
        return TypedResults.ValidationProblem(new Dictionary<string, string[]>
        {
          ["signature"] = ["De handtekening moet een afbeelding van maximaal 1 MB zijn."]
        });
      }

      await using var memory = new MemoryStream((int)file.Length);
      await file.CopyToAsync(memory, cancellationToken);
      signature = new ProfileSignature(memory.ToArray(), file.ContentType);
    }

    var request = new UpdateUserProfileRequest
    {
      PhoneNumber = form["phoneNumber"].ToString(),
      AlternativeEmail = form["alternativeEmail"].ToString()
    };

    try
    {
      var updated = await service.UpdateAsync(
        subject,
        request,
        signature,
        removeSignature,
        precondition.Version!.Value,
        cancellationToken);

      if (updated is null)
      {
        return TypedResults.StatusCode(StatusCodes.Status412PreconditionFailed);
      }

      context.Response.Headers.ETag = StrongEtag.Format(updated.Version);
      context.Response.Headers.CacheControl = "no-store";
      return TypedResults.Ok(ToResponse(updated, context.User));
    }
    catch (UserProfileValidationException exception)
    {
      return TypedResults.ValidationProblem(exception.Errors.ToDictionary(item => item.Key, item => item.Value));
    }
  }

  private static IfMatchParseResult ReadIfMatch(HttpRequest request)
    => IfMatchParser.Parse(request.Headers.TryGetValue("If-Match", out var value) ? value.ToString() : null);

  private static UserProfileResponse ToResponse(UserProfileRecord profile, ClaimsPrincipal user)
  {
    var displayName = user.FindFirstValue("name") ?? user.Identity?.Name;
    var userName = user.FindFirstValue("preferred_username");
    var primaryEmail = user.FindFirstValue("email");

    return new UserProfileResponse(
      profile.Subject,
      displayName,
      userName,
      primaryEmail,
      profile.PhoneNumber,
      profile.AlternativeEmail,
      profile.HasSignature,
      profile.SignatureContentType,
      UserProfileRules.IsComplete(profile.PhoneNumber, profile.AlternativeEmail),
      profile.Version,
      profile.CreatedAt,
      profile.UpdatedAt);
  }
}
