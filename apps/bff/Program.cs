using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Yarp.ReverseProxy.Transforms;
using Vsvk.Bff.Auth;
using Vsvk.Bff.Proxy;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddHttpClient();

// Persist Data Protection keys so cookie encryption survives container restarts.
var keysPath = builder.Configuration["DataProtection:KeysPath"] ?? "/var/lib/vsvk-bff/keys";
builder.Services
  .AddDataProtection()
  .PersistKeysToFileSystem(new DirectoryInfo(keysPath));

builder.Services.AddScoped<TokenRefreshCookieEvents>();
builder.Services.AddSingleton<AccessTokenForwardingTransformer>();

builder.Services
  .AddAuthentication(options =>
  {
    options.DefaultScheme = CookieAuthenticationDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = OpenIdConnectDefaults.AuthenticationScheme;
  })
  .AddCookie(options =>
  {
    options.Cookie.Name = builder.Environment.IsDevelopment()
      ? "vsvk-bff"
      : "__Host-vsvk-bff";

    options.Cookie.HttpOnly = true;
    options.Cookie.SameSite = SameSiteMode.Strict;
    options.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
      ? CookieSecurePolicy.SameAsRequest
      : CookieSecurePolicy.Always;

    options.SlidingExpiration = true;
    options.EventsType = typeof(TokenRefreshCookieEvents);
  })
  .AddOpenIdConnect(options =>
  {
    var oidcSection = builder.Configuration.GetSection("Oidc");

    // Authority must match the issuer in tokens.
    options.Authority = oidcSection["Authority"];

    // MetadataAddress may point to an internal Keycloak hostname (container network).
    options.MetadataAddress = oidcSection["MetadataAddress"];

    options.ClientId = oidcSection["ClientId"];
    options.ClientSecret = oidcSection["ClientSecret"];

    options.CallbackPath = oidcSection["CallbackPath"] ?? "/signin-oidc";

    options.ResponseType = OpenIdConnectResponseType.Code;
    options.UsePkce = true;
    options.SaveTokens = true;
    options.GetClaimsFromUserInfoEndpoint = true;

    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();

    options.Events = new OpenIdConnectEvents
    {
      OnRedirectToIdentityProvider = context =>
      {
        // Metadata can be fetched via an internal hostname, but browser redirects
        // must go to the public OIDC authority.
        if (Uri.TryCreate(options.Authority, UriKind.Absolute, out var authorityUri))
        {
          var authPath = $"{authorityUri.AbsolutePath.TrimEnd('/')}/protocol/openid-connect/auth";
          context.ProtocolMessage.IssuerAddress =
            $"{authorityUri.Scheme}://{authorityUri.Authority}{authPath}";
        }

        return Task.CompletedTask;
      }
    };

    options.Scope.Clear();
    options.Scope.Add("openid");
    options.Scope.Add("profile");
    options.Scope.Add("email");

    // Request offline_access only when explicitly enabled in Keycloak.
    // This avoids login failures when offline tokens are not allowed.
    var requestOfflineAccess = oidcSection.GetValue<bool>("RequestOfflineAccess", false);
    if (requestOfflineAccess)
    {
      options.Scope.Add("offline_access");
    }

    // Let the API enforce authorization; BFF only authenticates.
    options.TokenValidationParameters.NameClaimType = ClaimTypes.Name;
    options.TokenValidationParameters.RoleClaimType = ClaimTypes.Role;
  });

builder.Services.AddAuthorization();

builder.Services
  .AddReverseProxy()
  .LoadFromConfig(builder.Configuration.GetSection("ReverseProxy"))
  .AddTransforms(builderContext =>
  {
    // Attach the Keycloak access token as Bearer token when proxying.
    builderContext.AddRequestTransform(async transformContext =>
    {
      var transformer = transformContext.HttpContext.RequestServices.GetRequiredService<AccessTokenForwardingTransformer>();
      await transformer.TransformRequestAsync(transformContext);
    });
  });

builder.Services.Configure<ForwardedHeadersOptions>(options =>
{
  options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
  options.KnownNetworks.Clear();
  options.KnownProxies.Clear();
});

var app = builder.Build();

app.UseForwardedHeaders();

app.MapGet("/health", () => Results.Ok(new { ok = true }));

app.UseHttpsRedirection();

app.UseAuthentication();

app.Use(async (ctx, next) =>
{
  static bool IsPublicPath(PathString path)
    => path.StartsWithSegments("/health")
       || path.StartsWithSegments("/bff/login")
       || path.StartsWithSegments("/bff/logout")
       || path.StartsWithSegments("/bff/access-denied")
       || path.StartsWithSegments("/signin-oidc")
       || path.StartsWithSegments("/signout-callback-oidc");

  if (!IsPublicPath(ctx.Request.Path) && ctx.User.Identity?.IsAuthenticated != true)
  {
    var returnUrl = $"{ctx.Request.Path}{ctx.Request.QueryString}";
    await ctx.ChallengeAsync(
      OpenIdConnectDefaults.AuthenticationScheme,
      new AuthenticationProperties { RedirectUri = returnUrl });
    return;
  }

  if (!IsPublicPath(ctx.Request.Path)
      && !ctx.Request.Path.StartsWithSegments("/bff/user"))
  {
    var accessToken = await ctx.GetTokenAsync("access_token");
    if (!KeycloakAccessTokenClaims.HasApplicationAccess(accessToken))
    {
      if (ctx.Request.Path.StartsWithSegments("/api"))
      {
        ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
        return;
      }

      ctx.Response.Redirect("/bff/access-denied");
      return;
    }
  }

  await next();
});

app.UseAuthorization();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/bff/login", (HttpContext ctx, string? returnUrl) =>
{
  var props = new AuthenticationProperties { RedirectUri = string.IsNullOrWhiteSpace(returnUrl) ? "/" : returnUrl };
  return Results.Challenge(props, new[] { OpenIdConnectDefaults.AuthenticationScheme });
}).AllowAnonymous();

app.MapPost("/bff/logout", () =>
{
  var properties = new AuthenticationProperties { RedirectUri = "/bff/login" };
  return Results.SignOut(
    properties,
    new[]
    {
      CookieAuthenticationDefaults.AuthenticationScheme,
      OpenIdConnectDefaults.AuthenticationScheme
    });
});

app.MapGet("/bff/access-denied", () => Results.Content(
  "<!doctype html><html lang=\"nl\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Geen toegang</title><body style=\"font:16px Arial,sans-serif;max-width:38rem;margin:10vh auto;padding:1rem;color:#222\"><h1>Geen toegang</h1><p>Je Keycloak-account heeft niet de vereiste rol <code>default-roles-vsvk</code>.</p><form method=\"post\" action=\"/bff/logout\"><button type=\"submit\">Uitloggen</button></form></body></html>",
  "text/html; charset=utf-8"))
  .AllowAnonymous();

app.MapGet("/bff/user", async (HttpContext context, ClaimsPrincipal user) =>
{
  if (user.Identity?.IsAuthenticated != true)
  {
    return Results.Unauthorized();
  }

  var accessToken = await context.GetTokenAsync("access_token");
  var roles = KeycloakAccessTokenClaims.GetRealmRoles(accessToken);
  if (!roles.Contains(KeycloakAccessTokenClaims.ApplicationAccessRole, StringComparer.Ordinal))
  {
    return Results.Forbid();
  }

  return Results.Ok(new
  {
    name = user.Identity?.Name,
    username = user.FindFirst("preferred_username")?.Value ?? user.Identity?.Name,
    roles,
    hasApplicationAccess = true,
    claims = user.Claims.Select(c => new { c.Type, c.Value })
  });
});

app.MapReverseProxy().RequireAuthorization();

app.Run();

