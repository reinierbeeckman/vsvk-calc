using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Vsvk.Api.Auth;
using Vsvk.Api.DTOs;
using Vsvk.Api.Endpoints;
using Vsvk.Api.Db;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningMaterieelMutationTests
{
  private static readonly Guid Id = Guid.Parse("00000000-0000-0000-0000-000000000001");
  private static readonly Guid Group = Guid.Parse("00000000-0000-0000-0000-000000000002");
  private static readonly Guid Branch = Guid.Parse("00000000-0000-0000-0000-000000000003");

  [Theory]
  [InlineData("Production", true, true, true, HttpStatusCode.Forbidden)]
  [InlineData("Staging", true, true, true, HttpStatusCode.Forbidden)]
  [InlineData("Development", false, true, true, HttpStatusCode.Forbidden)]
  [InlineData("Development", true, false, true, HttpStatusCode.Forbidden)]
  [InlineData("Development", true, true, false, HttpStatusCode.Forbidden)]
  [InlineData("Development", true, true, true, HttpStatusCode.OK)]
  public async Task Access_requires_every_development_condition(string environment, bool enabled, bool developer, bool application, HttpStatusCode expected)
  {
    await using var host = await TestHost.Start(environment, enabled);
    host.Client.DefaultRequestHeaders.Add("X-Test-Authenticated", "yes");
    if (developer) host.Client.DefaultRequestHeaders.Add("X-Test-Developer", "yes");
    if (application) host.Client.DefaultRequestHeaders.Add("X-Test-Application", "yes");
    Assert.Equal(expected, (await host.Client.GetAsync($"/api/planning/materieel/{Id}")).StatusCode);
    Assert.Equal(expected, (await host.Put("\"1\"", Request("Bus"))).StatusCode);
    Assert.Equal(expected == HttpStatusCode.OK ? HttpStatusCode.Created : expected,
      (await host.Client.PostAsJsonAsync("/api/planning/materieel", Request("Bus"))).StatusCode);
  }

  [Fact]
  public async Task Unauthenticated_user_is_challenged()
  {
    await using var host = await TestHost.Start("Development", true);
    Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client.GetAsync($"/api/planning/materieel/{Id}")).StatusCode);
    Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client.PostAsJsonAsync("/api/planning/materieel", Request("Bus"))).StatusCode);
  }

  [Theory]
  [InlineData("Production", true, HttpStatusCode.Forbidden)]
  [InlineData("Development", false, HttpStatusCode.Forbidden)]
  [InlineData("Development", true, HttpStatusCode.Created)]
  public async Task Create_is_available_only_in_enabled_development(string environment, bool enabled, HttpStatusCode expected)
  {
    await using var host = await TestHost.Start(environment, enabled);
    host.Authorize();
    using var response = await host.Client.PostAsJsonAsync("/api/planning/materieel", Request("Nieuwe machine"));
    Assert.Equal(expected, response.StatusCode);
    if (expected == HttpStatusCode.Created)
    {
      Assert.NotNull(response.Headers.Location);
      Assert.Equal("\"1\"", response.Headers.ETag!.ToString());
    }
  }

  [Fact]
  public async Task Create_rejects_invalid_fields_and_references()
  {
    await using var host = await TestHost.Start("Development", true);
    host.Authorize();
    Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.PostAsJsonAsync("/api/planning/materieel", Request(new string('x', 501)))).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await host.Client.PostAsJsonAsync("/api/planning/materieel", Request("Machine") with { MaterieelGroepId = Guid.NewGuid() })).StatusCode);
  }

  [Fact]
  public async Task Versioned_write_rejects_missing_malformed_and_stale_preconditions_and_preserves_first_write()
  {
    await using var host = await TestHost.Start("Development", true);
    host.Authorize();
    var initial = await host.Client.GetAsync($"/api/planning/materieel/{Id}");
    Assert.Equal("\"1\"", initial.Headers.ETag!.ToString());
    var dto = await initial.Content.ReadFromJsonAsync<PlanningMaterieelEditDto>();
    Assert.Equal(Group, dto!.MaterieelGroepId);
    Assert.Equal(Branch, dto.StandplaatsId);
    Assert.Equal((HttpStatusCode)428, (await host.Put(null, Request("Ontbreekt"))).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await host.Put("W/\"1\"", Request("Ongeldig"))).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await host.Put("\"1\"", Request("Bus") with { MaterieelGroepId = Guid.NewGuid() })).StatusCode);
    var saved = await host.Put("\"1\"", Request("Eerste"));
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await host.Put("\"1\"", Request("Tweede"))).StatusCode);
    var current = await host.Client.GetAsync($"/api/planning/materieel/{Id}");
    Assert.Equal("\"2\"", current.Headers.ETag!.ToString());
    Assert.Equal("Eerste", (await current.Content.ReadFromJsonAsync<PlanningMaterieelEditDto>())!.Omschrijving);
  }

  [Fact]
  public async Task Reference_choices_are_available_and_validation_rejects_excessive_text()
  {
    await using var host = await TestHost.Start("Development", true);
    host.Authorize();
    var response = await host.Client.GetAsync("/api/planning/materieel/referenties");
    Assert.NotNull(response.Headers.ETag);
    var refs = await response.Content.ReadFromJsonAsync<PlanningMaterieelReferencesDto>();
    Assert.Equal(Group, Assert.Single(refs!.Groepen).Id);
    Assert.Equal(Branch, Assert.Single(refs.Vestigingen).Id);
    Assert.Equal(HttpStatusCode.BadRequest, (await host.Put("\"1\"", Request(new string('x', 501)))).StatusCode);
  }

  private static PlanningMaterieelUpdateRequest Request(string description) => new(description, "AB-12-CD", "Merk", "Zoek", "Serie", Branch, Group);

  private sealed class TestHost(WebApplication app, HttpClient client) : IAsyncDisposable
  {
    public HttpClient Client => client;
    public static async Task<TestHost> Start(string environment, bool enabled)
    {
      var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
      builder.Configuration["DevelopmentAccess:Enabled"] = enabled.ToString();
      builder.WebHost.UseUrls("http://127.0.0.1:0");
      builder.Services.AddSingleton<IPlanningMaterieelMutationRepository, FakeRepository>();
      builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, MaterieelTestAuthenticationHandler>("Test", _ => { });
      builder.Services.AddAuthorization();
      var app = builder.Build();
      app.UseAuthentication(); app.UseAuthorization(); app.MapPlanningMaterieelMutationEndpoints();
      await app.StartAsync();
      return new TestHost(app, new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) });
    }
    public void Authorize()
    {
      client.DefaultRequestHeaders.Add("X-Test-Authenticated", "yes");
      client.DefaultRequestHeaders.Add("X-Test-Developer", "yes");
      client.DefaultRequestHeaders.Add("X-Test-Application", "yes");
    }
    public async Task<HttpResponseMessage> Put(string? etag, PlanningMaterieelUpdateRequest value)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/planning/materieel/{Id}") { Content = JsonContent.Create(value) };
      if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
      return await client.SendAsync(request);
    }
    public async ValueTask DisposeAsync() { client.Dispose(); await app.DisposeAsync(); }
  }

  private sealed class FakeRepository : IPlanningMaterieelMutationRepository
  {
    private PlanningMaterieelEditDto item = new(Id, "Bus", null, null, null, null, Branch, Group, 1);
    public Task<PlanningMaterieelEditDto?> GetAsync(Guid id, CancellationToken ct) => Task.FromResult(id == Id ? item : null);
    public Task<PlanningMaterieelReferencesDto> GetReferencesAsync(CancellationToken ct) => Task.FromResult(new PlanningMaterieelReferencesDto([new(Group, "Groep")], [new(Branch, "Vestiging")]));
    public Task<PlanningMaterieelSaveResult> CreateAsync(PlanningMaterieelUpdateRequest request, CancellationToken ct)
    {
      if (request.MaterieelGroepId != Group || request.StandplaatsId != Branch) return Task.FromResult(new PlanningMaterieelSaveResult(null, true));
      item = new(Id, request.Omschrijving, request.Kenteken, request.Merk, request.Zoeknaam, request.Serienummer, request.StandplaatsId, request.MaterieelGroepId, 1);
      return Task.FromResult(new PlanningMaterieelSaveResult(item, false));
    }
    public Task<PlanningMaterieelSaveResult> SaveAsync(Guid id, long version, PlanningMaterieelUpdateRequest request, CancellationToken ct)
    {
      if (item.Version != version) return Task.FromResult(new PlanningMaterieelSaveResult(null, false));
      if (request.MaterieelGroepId != Group || request.StandplaatsId != Branch) return Task.FromResult(new PlanningMaterieelSaveResult(null, true));
      item = new(id, request.Omschrijving, request.Kenteken, request.Merk, request.Zoeknaam, request.Serienummer, request.StandplaatsId, request.MaterieelGroepId, version + 1);
      return Task.FromResult(new PlanningMaterieelSaveResult(item, false));
    }
  }
}

public sealed class MaterieelTestAuthenticationHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    if (!Request.Headers.ContainsKey("X-Test-Authenticated")) return Task.FromResult(AuthenticateResult.NoResult());
    var claims = new List<Claim>();
    if (Request.Headers.ContainsKey("X-Test-Developer")) claims.Add(new Claim(ClaimTypes.Role, VsvkRoles.Development));
    if (Request.Headers.ContainsKey("X-Test-Application")) claims.Add(new Claim(ClaimTypes.Role, VsvkRoles.Default));
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name)), Scheme.Name)));
  }
}
