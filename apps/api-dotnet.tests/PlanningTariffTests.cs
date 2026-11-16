using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
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
using Vsvk.Api.Endpoints;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningTariffTests
{
  [Fact]
  public async Task Customer_tariffs_use_current_rates_and_atomic_versioned_updates()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    var migrator = new DatabaseMigrator(source);
    await migrator.MigrateAsync();
    await migrator.MigrateAsync();
    await migrator.MigratePlanningRatesAsync();
    await migrator.MigratePlanningRatesAsync();
    await using (var seed = source.CreateCommand("""
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, '1001', 'Klant Een'), (2, '1002', 'Klant Twee');
      insert into functies(id, naam, aan) values (1, 'Grondwerker', true), (2, 'Uitvoerder', true), (3, 'Inactief', false);
      insert into standaard_tarieven(functie_id, prijs, eenheid, geldig_vanaf) values
        (1, 45, 'uur', current_date - 10), (1, 50, 'uur', current_date - 1),
        (1, 60, 'uur', current_date + 10), (2, 70, 'uur', current_date - 1), (3, 80, 'uur', current_date - 1);
      insert into klant_afwijkende_tarieven(klant_id, omschrijving, tarief) values (1, 'Historisch tarief', 99);
      """)) await seed.ExecuteNonQueryAsync();
    await migrator.MigratePlanningRatesAsync();

    var builder = WebApplication.CreateSlimBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(postgres.GetConnectionString()));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddScoped<IPlanningCustomerService, PlanningCustomerService>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy =>
      policy.RequireAssertion(context => VsvkRoles.CanManagePlanning(context.User))));
    await using var app = builder.Build();
    app.UseAuthentication(); app.UseAuthorization(); app.MapPlanningEndpoints();
    await app.StartAsync();
    using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/planning/tarieven")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", "planning");
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/klanten/1/tarieven")).StatusCode);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/tarieven/2/prijs")).StatusCode);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.PutAsJsonAsync("/api/planning/tarieven/2/prijs", new { prijs = 55m })).StatusCode);
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", "directie");

    var listResponse = await client.GetAsync("/api/planning/tarieven");
    Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
    using var list = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
    Assert.Equal(3, list.RootElement.GetArrayLength());
    Assert.Equal(50m, list.RootElement.EnumerateArray().Single(rate => rate.GetProperty("functieId").GetInt32() == 1).GetProperty("prijs").GetDecimal());

    async Task<HttpResponseMessage> PutPrice(string? etag, object body)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/tarieven/2/prijs") { Content = JsonContent.Create(body) };
      if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
      return await client.SendAsync(request);
    }
    var priceFirst = await client.GetAsync("/api/planning/tarieven/2/prijs");
    var priceSecond = await client.GetAsync("/api/planning/tarieven/2/prijs");
    Assert.Equal("\"1\"", priceFirst.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/planning/tarieven/999/prijs")).StatusCode);
    Assert.Equal(priceFirst.Headers.ETag, priceSecond.Headers.ETag);
    Assert.Equal((HttpStatusCode)428, (await PutPrice(null, new { prijs = 55m })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await PutPrice("W/\"1\"", new { prijs = 55m })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await PutPrice("\"1\"", new { prijs = -1m })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await PutPrice("\"1\"", new { prijs = 1.234m })).StatusCode);
    var savedPrice = await PutPrice("\"1\"", new { prijs = 55.25m });
    Assert.Equal(HttpStatusCode.OK, savedPrice.StatusCode);
    Assert.Equal("\"2\"", savedPrice.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await PutPrice("\"1\"", new { prijs = 60m })).StatusCode);
    using var priceRead = JsonDocument.Parse(await (await client.GetAsync("/api/planning/tarieven/2/prijs")).Content.ReadAsStringAsync());
    Assert.Equal(55.25m, priceRead.RootElement.GetProperty("prijs").GetDecimal());

    var first = await client.GetAsync("/api/planning/klanten/1/tarieven");
    var second = await client.GetAsync("/api/planning/klanten/1/tarieven");
    Assert.Equal("\"1\"", first.Headers.ETag!.ToString());
    Assert.Equal(first.Headers.ETag, second.Headers.ETag);
    using var initial = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
    Assert.Equal("Historisch tarief", initial.RootElement.GetProperty("historischeTarieven")[0].GetProperty("omschrijving").GetString());

    async Task<HttpResponseMessage> Put(string? etag, object body)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/klanten/1/tarieven") { Content = JsonContent.Create(body) };
      if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
      return await client.SendAsync(request);
    }
    var update = new { afwijkingen = new[] { new { functieId = 1, tarief = 55.25m } } };
    Assert.Equal((HttpStatusCode)428, (await Put(null, update)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("W/\"1\"", update)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { afwijkingen = new[] { new { functieId = 1, tarief = -1m } } })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { afwijkingen = new[] { new { functieId = 99, tarief = 5m } } })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { afwijkingen = new[] { new { functieId = 3, tarief = 5m } } })).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("\"1\"", new { afwijkingen = new[] { new { functieId = 1, tarief = 5m }, new { functieId = 1, tarief = 6m } } })).StatusCode);
    var saved = await Put("\"1\"", update);
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await Put("\"1\"", new { afwijkingen = Array.Empty<object>() })).StatusCode);
    using var read = JsonDocument.Parse(await (await client.GetAsync("/api/planning/klanten/1/tarieven")).Content.ReadAsStringAsync());
    Assert.Equal(55.25m, read.RootElement.GetProperty("afwijkingen").EnumerateArray().Single(rate => rate.GetProperty("functieId").GetInt32() == 1).GetProperty("tarief").GetDecimal());
    Assert.Equal(1, read.RootElement.GetProperty("historischeTarieven").GetArrayLength());
    await using (var constraint = source.CreateCommand("alter table klant_afwijkende_tarieven add constraint test_rollback check (tarief <> 66)"))
      await constraint.ExecuteNonQueryAsync();
    await using (var scope = app.Services.CreateAsyncScope())
    {
      var repository = scope.ServiceProvider.GetRequiredService<PlanningRepository>();
      await Assert.ThrowsAsync<DbUpdateException>(() => repository.SaveCustomerRatesAsync(1, 2,
        [new Vsvk.Api.DTOs.PlanningRateOverrideRequest(1, 66m)], CancellationToken.None));
    }
    var afterRollback = await client.GetAsync("/api/planning/klanten/1/tarieven");
    Assert.Equal("\"2\"", afterRollback.Headers.ETag!.ToString());
    using var rolledBack = JsonDocument.Parse(await afterRollback.Content.ReadAsStringAsync());
    Assert.Equal(55.25m, rolledBack.RootElement.GetProperty("afwijkingen")[0].GetProperty("tarief").GetDecimal());
    using var other = JsonDocument.Parse(await (await client.GetAsync("/api/planning/klanten/2/tarieven")).Content.ReadAsStringAsync());
    Assert.Empty(other.RootElement.GetProperty("afwijkingen").EnumerateArray());
    var reset = await Put("\"2\"", new { afwijkingen = Array.Empty<object>() });
    Assert.Equal(HttpStatusCode.OK, reset.StatusCode);
    Assert.Equal("\"3\"", reset.Headers.ETag!.ToString());
    await using var query = source.CreateCommand("select count(*) from klant_afwijkende_tarieven where klant_id = 1 and omschrijving = 'Historisch tarief'");
    Assert.Equal(1L, await query.ExecuteScalarAsync());
  }
}
