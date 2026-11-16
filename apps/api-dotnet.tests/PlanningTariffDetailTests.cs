using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Vsvk.Api.Auth;
using Vsvk.Api.Endpoints;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningTariffDetailTests
{
  [Theory]
  [InlineData("Development", true, "development,default-roles-vsvk", HttpStatusCode.OK)]
  [InlineData("Development", false, "development,default-roles-vsvk", HttpStatusCode.Forbidden)]
  [InlineData("Production", true, "development,default-roles-vsvk", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "development", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "directie,default-roles-vsvk", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "", HttpStatusCode.Unauthorized)]
  public async Task Detail_requires_development_access(string environment, bool enabled, string roles, HttpStatusCode expected)
  {
    await using var app = await Start(environment, enabled);
    using var client = Client(app, roles);
    Assert.Equal(expected, (await client.GetAsync("/api/planning/tarieven/1/detail")).StatusCode);
    using var put = new HttpRequestMessage(HttpMethod.Put, "/api/planning/tarieven/1/detail")
    {
      Content = JsonContent.Create(new { functie = "A", actief = true, prijs = 50m, eenheid = "uur", geldigVanaf = "2026-01-01" })
    };
    put.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    Assert.Equal(expected, (await client.SendAsync(put)).StatusCode);
  }

  [Fact]
  public async Task Preconditions_validation_and_stale_edits_preserve_latest_data()
  {
    await using var app = await Start("Development", true);
    using var client = Client(app, "development,default-roles-vsvk");
    var first = await client.GetAsync("/api/planning/tarieven/1/detail");
    Assert.Equal("\"1\"", first.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/planning/tarieven/999/detail")).StatusCode);
    var body = new { functie = "Machinist", actief = false, prijs = 57.25m, eenheid = "dag", geldigVanaf = "2026-01-01" };
    async Task<HttpResponseMessage> Put(string? etag, object data)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/tarieven/1/detail") { Content = JsonContent.Create(data) };
      if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
      return await client.SendAsync(request);
    }
    Assert.Equal((HttpStatusCode)428, (await Put(null, body)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("W/\"1\"", body)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { functie = " ", actief = true, prijs = 57.25m, eenheid = "uur", geldigVanaf = "2026-01-01" })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { functie = "A", prijs = 57.25m, eenheid = "uur", geldigVanaf = "2026-01-01" })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { functie = "A", actief = true, eenheid = "uur", geldigVanaf = "2026-01-01" })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { functie = "A", actief = true, prijs = 1.234m, eenheid = "uur", geldigVanaf = "2026-01-01" })).StatusCode);
    var saved = await Put("\"1\"", body);
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag!.ToString());
    Assert.Equal(saved.Headers.ETag.ToString(), (await saved.Content.ReadFromJsonAsync<PlanningTariffDetailDto>())!.ETag);
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await Put("\"1\"", body)).StatusCode);
    var latest = await (await client.GetAsync("/api/planning/tarieven/1/detail")).Content.ReadFromJsonAsync<PlanningTariffDetailDto>();
    Assert.Equal("Machinist", latest!.Functie);
    Assert.False(latest.Actief);
    Assert.Equal(57.25m, latest.Prijs);
  }

  private static async Task<WebApplication> Start(string environment, bool enabled)
  {
    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["DevelopmentAccess:Enabled"] = enabled.ToString() });
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddSingleton<IPlanningTariffDetailService, FakeService>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, DetailTestAuth>("Test", _ => { });
    builder.Services.AddAuthorization();
    var app = builder.Build();
    app.UseAuthentication(); app.UseAuthorization(); app.MapPlanningTariffDetailEndpoints();
    await app.StartAsync();
    return app;
  }
  private static HttpClient Client(WebApplication app, string roles)
  {
    var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
    if (roles.Length > 0) client.DefaultRequestHeaders.Add("X-Detail-Test-Roles", roles);
    return client;
  }
  private sealed class FakeService : IPlanningTariffDetailService
  {
    private PlanningTariffDetailDto item = new(1, 1, "Grondwerker", true, 50m, "uur", new DateOnly(2025, 1, 1), 1);
    public Task<PlanningTariffDetailDto?> GetAsync(int id, CancellationToken ct) => Task.FromResult(id == 1 ? item : null);
    public Task<PlanningTariffDetailDto?> SaveAsync(int id, long version, PlanningTariffDetailRequest request, CancellationToken ct)
    {
      if (id != 1 || item.Version != version) return Task.FromResult<PlanningTariffDetailDto?>(null);
      item = item with { Functie = request.Functie!.Trim(), Actief = request.Actief!.Value, Prijs = request.Prijs!.Value, Eenheid = request.Eenheid!.Trim(), GeldigVanaf = request.GeldigVanaf!.Value, Version = item.Version + 1 };
      return Task.FromResult<PlanningTariffDetailDto?>(item);
    }
  }
}

public sealed class DetailTestAuth(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    if (!Request.Headers.TryGetValue("X-Detail-Test-Roles", out var roles)) return Task.FromResult(AuthenticateResult.NoResult());
    var claims = roles.ToString().Split(',').Select(role => new Claim(ClaimTypes.Role, role));
    var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
  }
}


