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
using Vsvk.Api.DTOs;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningSupplierTests
{
  [Fact]
  public async Task Supplier_endpoint_returns_sorted_minimized_supplier_data()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand("""
      insert into leveranciers (debiteurnummer, bedrijfsnaam, telefoon_algemeen, plaats, iban)
      values ('C2', 'Zeta Leverancier', '020123', 'Amsterdam', 'NL91ABNA0417164300'),
             ('C1', 'Alpha Leverancier', null, 'Utrecht', null);
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
    using var client = new HttpClient
    {
      BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features
        .Get<IServerAddressesFeature>()!.Addresses.Single())
    };

    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/planning/leveranciers")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", "planning");
    Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/planning/leveranciers")).StatusCode);
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", "directie");
    var response = await client.GetAsync("/api/planning/leveranciers");
    Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    Assert.NotNull(response.Headers.ETag);
    using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
    Assert.Equal(2, body.RootElement.GetArrayLength());
    Assert.Equal("Alpha Leverancier", body.RootElement[0].GetProperty("bedrijfsnaam").GetString());
    Assert.Equal("C1", body.RootElement[0].GetProperty("crediteurnummer").GetString());
    Assert.False(body.RootElement[0].TryGetProperty("iban", out _));
    Assert.False(body.RootElement[0].TryGetProperty("btwNummer", out _));
  }

  [Fact]
  public async Task Supplier_details_create_and_update_with_preconditions_in_development()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();

    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = "Development" });
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Configuration["DevelopmentAccess:Enabled"] = "true";
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(postgres.GetConnectionString()));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddScoped<IPlanningCustomerService, PlanningCustomerService>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddTransient<Microsoft.AspNetCore.Authentication.IClaimsTransformation, KeycloakRealmRoleClaimsTransformation>();
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy =>
      policy.RequireAssertion(context => VsvkRoles.CanManagePlanning(context.User))));
    await using var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapPlanningEndpoints();
    await app.StartAsync();
    using var client = new HttpClient
    {
      BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features
        .Get<IServerAddressesFeature>()!.Addresses.Single())
    };
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Development);

    using var createdResponse = await client.PostAsJsonAsync("/api/planning/leveranciers",
      new PlanningSupplierWriteDto("C1", "Leverancier", Telefoon: "010123", Iban: "NL91ABNA0417164300"));
    Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
    var created = (await createdResponse.Content.ReadFromJsonAsync<PlanningSupplierDetailDto>())!;
    Assert.Equal("\"1\"", createdResponse.Headers.ETag?.ToString());
    Assert.Equal("010123", created.Telefoon);
    Assert.Equal("NL91ABNA0417164300", created.Iban);

    var read = await client.GetAsync("/api/planning/leveranciers/" + created.Id);
    var detail = (await read.Content.ReadFromJsonAsync<PlanningSupplierDetailDto>())!;
    var write = new PlanningSupplierWriteDto(detail.Crediteurnummer, detail.Bedrijfsnaam, detail.Actief,
      detail.KvkNummer, detail.BtwNummer, detail.Website, detail.Telefoon, detail.Email, detail.Straat,
      detail.Huisnummer, detail.Toevoeging, detail.Postcode, detail.Plaats, detail.Land, detail.FactuurEmail,
      detail.AfwijkendFactuuradres, detail.VasteReferentie, detail.Iban, detail.GRekeningPercentage,
      detail.FacturerenPer, detail.BtwVerlegd, detail.MandagenregisterMeesturen, detail.Opmerkingen);
    Assert.Equal("\"1\"", read.Headers.ETag?.ToString());
    Assert.Equal((HttpStatusCode)428, (await client.PutAsJsonAsync(
      "/api/planning/leveranciers/" + created.Id, write)).StatusCode);
    using var update = new HttpRequestMessage(HttpMethod.Put, "/api/planning/leveranciers/" + created.Id)
    {
      Content = JsonContent.Create(write with { Bedrijfsnaam = "Nieuwe naam" })
    };
    update.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    using var saved = await client.SendAsync(update);
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag?.ToString());
    using var stale = new HttpRequestMessage(HttpMethod.Put, "/api/planning/leveranciers/" + created.Id)
    {
      Content = JsonContent.Create(write)
    };
    stale.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await client.SendAsync(stale)).StatusCode);
  }

  [Theory]
  [InlineData("Production", true, "development")]
  [InlineData("Development", false, "development")]
  [InlineData("Development", true, "directie")]
  public async Task Supplier_writes_are_forbidden_without_all_development_requirements(
    string environment, bool enabled, string role)
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand(
      "insert into leveranciers(id, debiteurnummer, bedrijfsnaam) values (1, 'C1', 'Leverancier')"))
      await seed.ExecuteNonQueryAsync();

    var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Configuration["DevelopmentAccess:Enabled"] = enabled.ToString();
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(postgres.GetConnectionString()));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddScoped<IPlanningCustomerService, PlanningCustomerService>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddTransient<Microsoft.AspNetCore.Authentication.IClaimsTransformation, KeycloakRealmRoleClaimsTransformation>();
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy =>
      policy.RequireAssertion(context => VsvkRoles.CanManagePlanning(context.User))));
    await using var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapPlanningEndpoints();
    await app.StartAsync();
    using var client = new HttpClient
    {
      BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features
        .Get<IServerAddressesFeature>()!.Addresses.Single())
    };
    client.DefaultRequestHeaders.Add("X-Test-Role", role);
    var detail = new PlanningSupplierDetailDto(1, true, "C1", "Leverancier", null, null, null, null, null,
      null, null, null, null, null, "Nederland", null, false, null, null, null, null, false, false, null, 1);
    using var request = new HttpRequestMessage(HttpMethod.Put, "/api/planning/leveranciers/1")
    {
      Content = JsonContent.Create(detail)
    };
    request.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(request)).StatusCode);
  }
}
