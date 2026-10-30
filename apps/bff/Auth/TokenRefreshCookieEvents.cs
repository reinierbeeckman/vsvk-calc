using System.Globalization;
using System.Net.Http.Headers;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.Extensions.Options;

namespace Vsvk.Bff.Auth;

/// <summary>
/// Refreshes the OIDC access token using the refresh token stored in the encrypted auth cookie.
/// This keeps the SPA token-free: tokens never reach the browser.
/// </summary>
public sealed class TokenRefreshCookieEvents : CookieAuthenticationEvents
{
  private static readonly TimeSpan RefreshSkew = TimeSpan.FromMinutes(1);

  private readonly IHttpClientFactory _httpClientFactory;
  private readonly IOptionsMonitor<OpenIdConnectOptions> _oidcOptions;

  public TokenRefreshCookieEvents(IHttpClientFactory httpClientFactory, IOptionsMonitor<OpenIdConnectOptions> oidcOptions)
  {
    _httpClientFactory = httpClientFactory;
    _oidcOptions = oidcOptions;
  }

  public override async Task ValidatePrincipal(CookieValidatePrincipalContext context)
  {
    var expiresAtRaw = context.Properties.GetTokenValue("expires_at");
    if (string.IsNullOrWhiteSpace(expiresAtRaw))
    {
      return;
    }

    if (!DateTimeOffset.TryParse(expiresAtRaw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var expiresAt))
    {
      return;
    }

    var now = DateTimeOffset.UtcNow;
    if (expiresAt > now.Add(RefreshSkew))
    {
      return;
    }

    var refreshToken = context.Properties.GetTokenValue("refresh_token");
    if (string.IsNullOrWhiteSpace(refreshToken))
    {
      context.RejectPrincipal();
      await context.HttpContext.SignOutAsync();
      return;
    }

    var oidc = _oidcOptions.Get(OpenIdConnectDefaults.AuthenticationScheme);

    var config = await oidc.ConfigurationManager!.GetConfigurationAsync(context.HttpContext.RequestAborted);
    var tokenEndpoint = config.TokenEndpoint;

    var http = _httpClientFactory.CreateClient();

    using var request = new HttpRequestMessage(HttpMethod.Post, tokenEndpoint)
    {
      Content = new FormUrlEncodedContent(new Dictionary<string, string>
      {
        ["grant_type"] = "refresh_token",
        ["client_id"] = oidc.ClientId!,
        ["client_secret"] = oidc.ClientSecret!,
        ["refresh_token"] = refreshToken
      })
    };

    request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

    using var response = await http.SendAsync(request, context.HttpContext.RequestAborted);
    if (!response.IsSuccessStatusCode)
    {
      context.RejectPrincipal();
      await context.HttpContext.SignOutAsync();
      return;
    }

    var payload = await response.Content.ReadAsStringAsync(context.HttpContext.RequestAborted);
    using var doc = JsonDocument.Parse(payload);

    var accessToken = doc.RootElement.GetProperty("access_token").GetString();
    var newRefreshToken = doc.RootElement.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : refreshToken;
    var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var exp) ? exp.GetInt32() : 300;

    if (string.IsNullOrWhiteSpace(accessToken))
    {
      context.RejectPrincipal();
      await context.HttpContext.SignOutAsync();
      return;
    }

    context.Properties.UpdateTokenValue("access_token", accessToken);
    context.Properties.UpdateTokenValue("refresh_token", newRefreshToken ?? refreshToken);

    var newExpiresAt = now.AddSeconds(expiresIn);
    context.Properties.UpdateTokenValue("expires_at", newExpiresAt.ToString("o", CultureInfo.InvariantCulture));

    context.ShouldRenew = true;
  }
}
