using System.Net;
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

public sealed class PlanningCustomerTests
{
  [Fact]
  public async Task Customer_endpoints_return_contacts_only_for_the_requested_customer()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand("""
      insert into klanten (id, debiteurnummer, bedrijfsnaam, btw_nummer, telefoon_algemeen, iban)
      values (1, '1001', 'Klant Een', 'NL123', '010123', 'NL91ABNA0417164300'),
             (2, '1002', 'Klant Twee', 'NL456', null, null);
      insert into klant_contactpersonen (klant_id, naam, functie, telefoon, email, is_standaard_besteller)
      values (1, 'Jan', 'Inkoper', '06123', 'jan@example.test', true),
             (1, 'Piet', null, null, null, false), (2, 'Andere klant', null, null, null, true);
      """)) await seed.ExecuteNonQueryAsync();

    var builder = WebApplication.CreateSlimBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(postgres.GetConnectionString()));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddScoped<IPlanningCustomerService, PlanningCustomerService>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy =>
      policy.RequireAssertion(context => VsvkRoles.CanManagePlanning(context.User))));
    await using var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapPlanningEndpoints();
    await app.StartAsync();
    using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };

    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/planning/klanten")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Default);
    var generalList = await client.GetAsync("/api/planning/klanten");
    Assert.Equal(HttpStatusCode.OK, generalList.StatusCode);
    using var generalBody = JsonDocument.Parse(await generalList.Content.ReadAsStringAsync());
    Assert.Equal(2, generalBody.RootElement.GetArrayLength());
    Assert.False(generalBody.RootElement[0].TryGetProperty("iban", out _));
    Assert.False(generalBody.RootElement[0].TryGetProperty("btwNummer", out _));
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/klanten/1")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-No-Default", "true");
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", "planning");
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/klanten")).StatusCode);
    client.DefaultRequestHeaders.Remove("X-Test-No-Default");
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", "directie");
    var listResponse = await client.GetAsync("/api/planning/klanten");
    Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
    Assert.NotNull(listResponse.Headers.ETag);
    using var list = JsonDocument.Parse(await listResponse.Content.ReadAsStringAsync());
    Assert.Equal(2, list.RootElement.GetArrayLength());
    Assert.Equal("Klant Een", list.RootElement[0].GetProperty("bedrijfsnaam").GetString());
    Assert.False(list.RootElement[0].TryGetProperty("btwNummer", out _));
    Assert.False(list.RootElement[0].TryGetProperty("iban", out _));

    var response = await client.GetAsync("/api/planning/klanten/1");
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.NotNull(response.Headers.ETag);
    using var detail = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    Assert.Equal("NL123", detail.RootElement.GetProperty("facturatie").GetProperty("btwNummer").GetString());
    Assert.Equal("NL91ABNA0417164300", detail.RootElement.GetProperty("facturatie").GetProperty("iban").GetString());
    var contacts = detail.RootElement.GetProperty("contactpersonen");
    Assert.Equal(2, contacts.GetArrayLength());
    Assert.Equal("Jan", contacts[0].GetProperty("naam").GetString());
    Assert.True(contacts[0].GetProperty("isStandaardBesteller").GetBoolean());
    Assert.Equal("Piet", contacts[1].GetProperty("naam").GetString());
    await using (var update = source.CreateCommand("update klant_contactpersonen set telefoon = '06456' where naam = 'Jan'; update klanten set version = version + 1 where id = 1"))
      await update.ExecuteNonQueryAsync();
    var changed = await client.GetAsync("/api/planning/klanten/1");
    Assert.NotEqual(response.Headers.ETag, changed.Headers.ETag);
    await using (var update = source.CreateCommand("update klanten set iban = 'NL02ABNA0123456789', version = version + 1 where id = 1"))
      await update.ExecuteNonQueryAsync();
    var changedIban = await client.GetAsync("/api/planning/klanten/1");
    Assert.NotEqual(changed.Headers.ETag, changedIban.Headers.ETag);
    using var noIban = JsonDocument.Parse(await (await client.GetAsync("/api/planning/klanten/2")).Content.ReadAsStringAsync());
    Assert.Equal(JsonValueKind.Null, noIban.RootElement.GetProperty("facturatie").GetProperty("iban").ValueKind);
    Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/planning/klanten/999")).StatusCode);
  }

  [Fact]
  public async Task Customer_aggregate_rejects_stale_writes_and_rolls_back_contact_errors()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand("insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, '1001', 'Oud'); insert into klant_contactpersonen(klant_id, naam) values (1, 'Jan')")) await seed.ExecuteNonQueryAsync();
    var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(postgres.GetConnectionString()).Options;
    await using var context = new VsvkDbContext(options);
    var repository = new PlanningRepository(context);
    var original = (await repository.GetCustomerAsync(1, CancellationToken.None))!;
    var first = original with { Bedrijfsnaam = "Eerste", Contactpersonen = [original.Contactpersonen[0] with { Naam = "Piet" }] };
    var saved = await repository.SaveCustomerAsync(1, 1, first, CancellationToken.None);
    Assert.Equal(2, saved!.Version);
    Assert.Null(await repository.SaveCustomerAsync(1, 1, original with { Bedrijfsnaam = "Verouderd" }, CancellationToken.None));
    var current = (await repository.GetCustomerAsync(1, CancellationToken.None))!;
    Assert.Equal("Eerste", current.Bedrijfsnaam);
    Assert.Equal("Piet", current.Contactpersonen[0].Naam);
    var invalid = current with { Bedrijfsnaam = "Terugrollen", Contactpersonen = [current.Contactpersonen[0] with { Naam = new string('x', 256) }] };
    await Assert.ThrowsAsync<DbUpdateException>(() => repository.SaveCustomerAsync(1, 2, invalid, CancellationToken.None));
    await using var verify = new VsvkDbContext(options);
    var after = (await new PlanningRepository(verify).GetCustomerAsync(1, CancellationToken.None))!;
    Assert.Equal(2, after.Version);
    Assert.Equal("Eerste", after.Bedrijfsnaam);
    Assert.Equal("Piet", after.Contactpersonen[0].Naam);
  }
}
