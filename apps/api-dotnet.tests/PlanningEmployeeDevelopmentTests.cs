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
using Vsvk.Api.DTOs;
using Vsvk.Api.Db;
using Vsvk.Api.Endpoints;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningEmployeeDevelopmentTests
{
  private static readonly Guid EmployeeId = Guid.Parse("78aa22e8-66f5-4e31-b89c-71f0f3f57f41");
  private static object ValidBody => new { personeelsnummer = "42", naam = "Naam", functie = "Planner", telefoon = "123", email = "a@example.com", vestiging = "Noord", actief = false, skills = new[] { new { naam = "VCA", diplomaOp = "2024-01-01", geldigTot = "2027-01-01" } } };

  [Theory]
  [InlineData("Production", true, "default-roles-vsvk,development", HttpStatusCode.Forbidden)]
  [InlineData("Staging", true, "default-roles-vsvk,development", HttpStatusCode.Forbidden)]
  [InlineData("Development", false, "default-roles-vsvk,development", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "development", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "default-roles-vsvk,directie", HttpStatusCode.Forbidden)]
  [InlineData("Development", true, "", HttpStatusCode.Unauthorized)]
  [InlineData("Development", true, "default-roles-vsvk,development", HttpStatusCode.OK)]
  public async Task Mutations_require_all_development_gates(string environment, bool enabled, string roles, HttpStatusCode expected)
  {
    await using var server = await StartAsync(environment, enabled);
    using var response = await SendAsync(server.Client, roles, "\"1\"", ValidBody);
    Assert.Equal(expected, response.StatusCode);
  }

  [Fact]
  public async Task Preconditions_validation_and_conflicts_preserve_the_first_update()
  {
    await using var server = await StartAsync("Development", true);
    const string roles = "default-roles-vsvk,development";
    Assert.Equal((HttpStatusCode)428, (await SendAsync(server.Client, roles, null, ValidBody)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(server.Client, roles, "W/\"1\"", ValidBody)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(server.Client, roles, "\"1\"", new { skills = Array.Empty<object>() })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(server.Client, roles, "\"1\"", new { actief = true, skills = new[] { new { naam = "VCA" }, new { naam = "VCA" } } })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(server.Client, roles, "\"1\"", new { actief = true, skills = new[] { new { naam = "VCA", diplomaOp = "2027-01-01", geldigTot = "2024-01-01" } } })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync(server.Client, roles, "\"1\"", new { actief = true, email = "invalid", skills = Array.Empty<object>() })).StatusCode);
    var first = await SendAsync(server.Client, roles, "\"1\"", ValidBody);
    Assert.Equal(HttpStatusCode.OK, first.StatusCode);
    Assert.Equal("\"2\"", first.Headers.ETag!.ToString());
    Assert.False((await first.Content.ReadFromJsonAsync<PlanningEmployeeDto>())!.Actief);
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await SendAsync(server.Client, roles, "\"1\"", ValidBody)).StatusCode);
    Assert.Equal(1, server.Repository.Writes);
  }

  [Theory]
  [InlineData("vaardigheden", "VCA")]
  [InlineData("vestigingen", "Noord")]
  public async Task Lookups_require_development_access_and_return_names(string route, string name)
  {
    await using var server = await StartAsync("Development", true);
    Assert.Equal(HttpStatusCode.Unauthorized, (await server.Client.GetAsync($"/api/planning/medewerkers/{route}")).StatusCode);
    using var forbidden = new HttpRequestMessage(HttpMethod.Get, $"/api/planning/medewerkers/{route}");
    forbidden.Headers.Add("X-Roles", "default-roles-vsvk,directie");
    Assert.Equal(HttpStatusCode.Forbidden, (await server.Client.SendAsync(forbidden)).StatusCode);
    using var allowed = new HttpRequestMessage(HttpMethod.Get, $"/api/planning/medewerkers/{route}");
    allowed.Headers.Add("X-Roles", "default-roles-vsvk,development");
    var result = await server.Client.SendAsync(allowed);
    Assert.Equal(HttpStatusCode.OK, result.StatusCode);
    var items = await result.Content.ReadFromJsonAsync<List<PlanningEmployeeLookupDto>>();
    Assert.Equal(name, Assert.Single(items!).Naam);
  }

  private static async Task<HttpResponseMessage> SendAsync(HttpClient client, string roles, string? etag, object body)
  {
    using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/planning/medewerkers/{EmployeeId}/gegevens") { Content = JsonContent.Create(body) };
    if (roles.Length > 0) request.Headers.Add("X-Roles", roles);
    if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
    return await client.SendAsync(request);
  }

  private static async Task<TestServer> StartAsync(string environment, bool enabled)
  {
    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
    builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["DevelopmentAccess:Enabled"] = enabled.ToString() });
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    var repository = new FakeEmployeeRepository();
    builder.Services.AddSingleton<IPlanningEmployeeDevelopmentRepository>(repository);
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, DevelopmentTestHandler>("Test", _ => { });
    builder.Services.AddAuthorization();
    var app = builder.Build();
    app.UseAuthentication(); app.UseAuthorization(); app.MapPlanningEmployeeDevelopmentEndpoints();
    await app.StartAsync();
    var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
    return new TestServer(app, new HttpClient { BaseAddress = new Uri(address) }, repository);
  }

  private sealed record TestServer(WebApplication App, HttpClient Client, FakeEmployeeRepository Repository) : IAsyncDisposable
  {
    public async ValueTask DisposeAsync() { Client.Dispose(); await App.DisposeAsync(); }
  }

  private sealed class FakeEmployeeRepository : IPlanningEmployeeDevelopmentRepository
  {
    private long version = 1;
    public int Writes { get; private set; }
    public Task<List<PlanningEmployeeLookupDto>> ListSkillsAsync(CancellationToken cancellationToken) => Task.FromResult(new List<PlanningEmployeeLookupDto> { new("VCA") });
    public Task<List<PlanningEmployeeLookupDto>> ListBranchesAsync(CancellationToken cancellationToken) => Task.FromResult(new List<PlanningEmployeeLookupDto> { new("Noord") });
    public Task<PlanningEmployeeUpdateResult> SaveAsync(Guid id, long expectedVersion, PlanningEmployeeUpdateRequest request, CancellationToken cancellationToken)
    {
      if (expectedVersion != version) return Task.FromResult(new PlanningEmployeeUpdateResult(null, PlanningEmployeeUpdateStatus.Conflict));
      Writes++; version++;
      return Task.FromResult(new PlanningEmployeeUpdateResult(new PlanningEmployeeDto(id, request.Personeelsnummer, request.Naam, request.Functie, request.Telefoon, request.Email, request.Vestiging, request.Actief!.Value, version, request.Skills!), PlanningEmployeeUpdateStatus.Saved));
    }
  }
}

public sealed class DevelopmentTestHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    if (!Request.Headers.TryGetValue("X-Roles", out var roles)) return Task.FromResult(AuthenticateResult.NoResult());
    var identity = new ClaimsIdentity(roles.ToString().Split(',').Select(role => new Claim(ClaimTypes.Role, role)), Scheme.Name);
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
  }
}
