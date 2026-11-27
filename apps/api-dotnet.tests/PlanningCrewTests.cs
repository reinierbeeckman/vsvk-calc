using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Endpoints;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningCrewTests
{
  private static readonly Guid Branch = Guid.Parse("00000000-0000-0000-0000-000000000021");
  private static readonly Guid OtherBranch = Guid.Parse("00000000-0000-0000-0000-000000000022");
  private static readonly Guid Anna = Guid.Parse("00000000-0000-0000-0000-000000000a01");
  private static readonly Guid Bram = Guid.Parse("00000000-0000-0000-0000-000000000a02");
  private static readonly Guid Graver = Guid.Parse("00000000-0000-0000-0000-000000000b01");
  private static readonly Guid Bus = Guid.Parse("00000000-0000-0000-0000-000000000b02");

  [Fact]
  public void Validation_rejects_empty_name_duplicates_and_operator_outside_crew()
  {
    Assert.True(PlanningCrewEndpoints.Valid(new("Ploeg A", [Anna, Bram], [new(Graver, Anna)])));
    Assert.True(PlanningCrewEndpoints.Valid(new("Lege ploeg", null, null)));
    Assert.False(PlanningCrewEndpoints.Valid(new("  ", [Anna], [])));
    Assert.False(PlanningCrewEndpoints.Valid(new(new string('x', 201), [Anna], [])));
    Assert.False(PlanningCrewEndpoints.Valid(new("Dubbel", [Anna, Anna], [])));
    Assert.False(PlanningCrewEndpoints.Valid(new("Dubbel materieel", [Anna], [new(Graver), new(Graver)])));
    Assert.False(PlanningCrewEndpoints.Valid(new("Vreemde bediener", [Anna], [new(Graver, Bram)])));
    Assert.False(PlanningCrewEndpoints.Valid(new("Leeg id", [Guid.Empty], [])));
  }

  [Fact]
  public async Task Planning_creates_updates_and_deletes_crew_with_concurrency()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    var migrator = new DatabaseMigrator(source);
    await migrator.MigrateAsync();
    await migrator.MigrateAsync(); // migratie is herhaalbaar
    await SeedAsync(source);
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);

    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/planning/ploegen")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/ploegen")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Ploegvestiging");

    Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/planning/ploegen",
      new PlanningCrewWriteDto("Onbekend", [Guid.NewGuid()], []))).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/planning/ploegen",
      new PlanningCrewWriteDto("Bediener buiten ploeg", [Anna], [new(Graver, Bram)]))).StatusCode);

    using var createdResponse = await client.PostAsJsonAsync("/api/planning/ploegen",
      new PlanningCrewWriteDto(" Ploeg Anna ", [Anna, Bram], [new(Graver, Anna), new(Bus)], OtherBranch));
    Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
    Assert.Equal("\"1\"", createdResponse.Headers.ETag?.ToString());
    var created = (await createdResponse.Content.ReadFromJsonAsync<PlanningCrewDto>())!;
    Assert.Equal("Ploeg Anna", created.Naam);
    Assert.Equal(Branch, created.VestigingId); // vestiging komt uit de claim, niet uit het verzoek
    Assert.Equal(new[] { Anna, Bram }, created.Leden);
    Assert.Equal(new[] { new PlanningCrewEquipmentDto(Graver, Anna), new PlanningCrewEquipmentDto(Bus) }, created.Materieel);

    var list = await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen");
    Assert.Equal(created.Id, Assert.Single(list!).Id);

    var url = $"/api/planning/ploegen/{created.Id}";
    var first = new PlanningCrewWriteDto("Ploeg Anna", [Bram], [new(Graver, Bram)]);
    var second = new PlanningCrewWriteDto("Ploeg Bram", [Anna], []);
    Assert.Equal((HttpStatusCode)428, (await client.PutAsJsonAsync(url, first)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(Put(url, first, "geen-etag"))).StatusCode);

    var responses = await Task.WhenAll(client.SendAsync(Put(url, first, "\"1\"")), client.SendAsync(Put(url, second, "\"1\"")));
    var winner = Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
    Assert.Single(responses, response => response.StatusCode == HttpStatusCode.PreconditionFailed);
    Assert.Equal("\"2\"", winner.Headers.ETag?.ToString());
    var saved = (await winner.Content.ReadFromJsonAsync<PlanningCrewDto>())!;
    var stored = Assert.Single((await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen"))!);
    Assert.Equal(saved.Naam, stored.Naam);
    Assert.Equal(saved.Leden, stored.Leden); // leden zijn volledig vervangen, niet aangevuld
    Assert.Equal(saved.Materieel, stored.Materieel);
    Assert.Equal(2, stored.Version);

    Assert.Equal(HttpStatusCode.PreconditionFailed, (await client.SendAsync(Put(url, first, "\"1\""))).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(
      Put(url, new PlanningCrewWriteDto("Ploeg Anna", [Anna], [new(Guid.NewGuid())]), "\"2\""))).StatusCode);
    var unchanged = Assert.Single((await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen"))!);
    Assert.Equal(2, unchanged.Version);
    Assert.Equal(saved.Leden, unchanged.Leden);

    Assert.Equal((HttpStatusCode)428, (await client.DeleteAsync(url)).StatusCode);
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await client.SendAsync(Delete(url, "\"1\""))).StatusCode);
    Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(Delete(url, "\"2\""))).StatusCode);
    Assert.Empty((await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen"))!);
    Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(Put(url, first, "\"2\""))).StatusCode);
  }

  [Fact]
  public async Task Crews_of_another_branch_are_hidden_and_cannot_be_changed()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await SeedAsync(source);
    await using (var seed = source.CreateCommand($"""
      insert into ploegen(id, naam, vestiging_id) values
        ('00000000-0000-0000-0000-000000000c01', 'Eigen ploeg', '{Branch}'),
        ('00000000-0000-0000-0000-000000000c02', 'Andere ploeg', '{OtherBranch}'),
        ('00000000-0000-0000-0000-000000000c03', 'Gedeelde ploeg', null);
      insert into ploeg_leden(ploeg_id, medewerker_id, sorteervolgorde)
        values ('00000000-0000-0000-0000-000000000c02', '{Anna}', 0);
      """))
      await seed.ExecuteNonQueryAsync();
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Ploegvestiging");

    var visible = await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen");
    Assert.Equal(new[] { "Eigen ploeg", "Gedeelde ploeg" }, visible!.Select(crew => crew.Naam).ToArray());
    var other = "/api/planning/ploegen/00000000-0000-0000-0000-000000000c02";
    Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(
      Put(other, new PlanningCrewWriteDto("Overgenomen", [], []), "\"1\""))).StatusCode);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(Delete(other, "\"1\""))).StatusCode);

    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Directie);
    Assert.Equal(3, (await client.GetFromJsonAsync<List<PlanningCrewDto>>("/api/planning/ploegen"))!.Count);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/planning/ploegen",
      new PlanningCrewWriteDto("Directie mag niet plannen", [], []))).StatusCode);
  }

  private static async Task SeedAsync(NpgsqlDataSource source)
  {
    await using var seed = source.CreateCommand($"""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('{Branch}', 'Ploegvestiging', 'Straat 1', '0000AA', 'Plaats', '010', 'ploeg@example.test', '1', '1', 'NL00', 1),
             ('{OtherBranch}', 'Andere vestiging', 'Straat 2', '0000AB', 'Plaats', '010', 'ander@example.test', '2', '2', 'NL01', 1)
      on conflict do nothing;
      insert into user_information(keycloak_sub, display_name, is_active)
      values ('{Anna}', 'Anna de Graaf', true), ('{Bram}', 'Bram Smit', true);
      insert into materieel(id, omschrijving, standplaats_id)
      values ('{Graver}', 'Minigraver', '{Branch}'), ('{Bus}', 'Bus', '{Branch}');
      """);
    await seed.ExecuteNonQueryAsync();
  }

  private static HttpRequestMessage Put(string url, PlanningCrewWriteDto body, string etag)
  {
    var request = new HttpRequestMessage(HttpMethod.Put, url) { Content = JsonContent.Create(body) };
    request.Headers.TryAddWithoutValidation("If-Match", etag);
    return request;
  }

  private static HttpRequestMessage Delete(string url, string etag)
  {
    var request = new HttpRequestMessage(HttpMethod.Delete, url);
    request.Headers.TryAddWithoutValidation("If-Match", etag);
    return request;
  }

  private static async Task<WebApplication> StartAsync(string connectionString)
  {
    var builder = WebApplication.CreateSlimBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(connectionString));
    builder.Services.AddScoped<PlanningCrewRepository>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddAuthorization(options =>
    {
      options.AddPolicy("planning-lijsten", policy => policy.RequireAssertion(context =>
        VsvkRoles.CanManagePlanning(context.User)));
      options.AddPolicy("planning-bord-muteer", policy => policy.RequireAuthenticatedUser()
        .RequireAssertion(context => VsvkRoles.CanEditWorkOrders(context.User)));
    });
    var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapPlanningCrewEndpoints();
    await app.StartAsync();
    return app;
  }

  private static HttpClient Client(WebApplication app) => new()
  {
    BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features
      .Get<IServerAddressesFeature>()!.Addresses.Single())
  };
}
