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
using Vsvk.Api.DTOs;
using Vsvk.Api.Db;
using Vsvk.Api.Endpoints;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningCustomerMutationTests
{
  private static PlanningCustomerDetailDto Customer => new(1, true, "1001", "Klant", null, null, null, null,
    null, null, null, null, null, null, null, [], new(null, null, null, false, null, null, null, false, false), 1);

  [Theory]
  [InlineData("Development", true, "development", HttpStatusCode.OK)]
  [InlineData("Production", true, "development", HttpStatusCode.Forbidden)]
  [InlineData("Development", false, "development", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "directie", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "development-no-access", HttpStatusCode.Forbidden)]
  public async Task Writes_require_development_environment_setting_role_and_application_access(string environment, bool enabled, string role, HttpStatusCode expected)
  {
    await using var host = await StartAsync(environment, enabled);
    using var client = Client(host);
    client.DefaultRequestHeaders.Add("X-Test-Role", role);
    using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/klanten/1") { Content = JsonContent.Create(Customer) };
    request.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    Assert.Equal(expected, (await client.SendAsync(request)).StatusCode);
  }

  [Fact]
  public async Task Preconditions_validation_and_etags_are_enforced()
  {
    await using var host = await StartAsync("Development", true);
    using var client = Client(host);
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.PutAsJsonAsync("/api/planning/klanten/1", Customer)).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", "development");
    var read = await client.GetAsync("/api/planning/klanten/1");
    Assert.Equal("\"1\"", read.Headers.ETag?.ToString());
    async Task<HttpResponseMessage> Put(string? tag, object body)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/klanten/1") { Content = JsonContent.Create(body) };
      if (tag is not null) request.Headers.TryAddWithoutValidation("If-Match", tag);
      return await client.SendAsync(request);
    }
    Assert.Equal((HttpStatusCode)428, (await Put(null, Customer)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("W/\"1\"", Customer)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { id = 1 })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", Customer with { Bedrijfsnaam = " " })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", Customer with { Email = "ongeldig" })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", Customer with { Contactpersonen = [new(99, "Andere klant", null, null, null, false)] })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", Customer with { Contactpersonen = [new(0, "A", null, null, null, true), new(0, "B", null, null, null, true)] })).StatusCode);
    var saved = await Put("\"1\"", Customer with { Bedrijfsnaam = "Nieuw" });
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag?.ToString());
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await Put("\"1\"", Customer)).StatusCode);
    Assert.Equal("Nieuw", (await (await client.GetAsync("/api/planning/klanten/1")).Content.ReadFromJsonAsync<PlanningCustomerDetailDto>())!.Bedrijfsnaam);
  }

  private static HttpClient Client(WebApplication app) => new() { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };

  private static async Task<WebApplication> StartAsync(string environment, bool enabled)
  {
    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["DevelopmentAccess:Enabled"] = enabled.ToString() });
    builder.Services.AddSingleton<IPlanningCustomerService, FakeService>();
    builder.Services.AddScoped<PlanningRepository>(_ => throw new InvalidOperationException("Not used by customer tests"));
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, CustomerAuthenticationHandler>("Test", _ => { });
    builder.Services.AddTransient<IClaimsTransformation, KeycloakRealmRoleClaimsTransformation>();
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy => policy.RequireAssertion(c => VsvkRoles.CanManagePlanning(c.User))));
    var app = builder.Build(); app.UseAuthentication(); app.UseAuthorization(); app.MapPlanningEndpoints(); await app.StartAsync(); return app;
  }

  private sealed class FakeService : IPlanningCustomerService
  {
    private PlanningCustomerDetailDto value = Customer;
    public Task<PlanningCustomerDetailDto?> GetAsync(int id, CancellationToken ct) => Task.FromResult<PlanningCustomerDetailDto?>(id == 1 ? value : null);
    public Task<PlanningCustomerDetailDto?> SaveAsync(int id, long version, PlanningCustomerDetailDto request, CancellationToken ct) => Task.FromResult<PlanningCustomerDetailDto?>(value = request with { Version = version + 1 });
    public Task<List<PlanningCustomerListDto>> ListAsync(CancellationToken ct) => throw new NotImplementedException();
    public Task<List<PlanningStandardRateDto>> ListRatesAsync(CancellationToken ct) => throw new NotImplementedException();
    public Task<PlanningCustomerRatesDto?> GetRatesAsync(int id, CancellationToken ct) => throw new NotImplementedException();
    public Task<PlanningRatesUpdateResult> SaveRatesAsync(int id, long version, List<PlanningRateOverrideRequest> overrides, CancellationToken ct) => throw new NotImplementedException();
  }

  public sealed class CustomerAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
  {
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
      if (!Request.Headers.TryGetValue("X-Test-Role", out var header)) return Task.FromResult(AuthenticateResult.NoResult());
      var role = header.ToString(); var claims = new List<Claim>();
      if (role != "development-no-access") claims.Add(new Claim(ClaimTypes.Role, VsvkRoles.Default));
      claims.Add(new Claim(ClaimTypes.Role, role == "development-no-access" ? "development" : role));
      var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
      return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
    }
  }
}
