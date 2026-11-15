using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.Endpoints;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningRepositoryTests : IAsyncLifetime
{
  private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
  private NpgsqlDataSource _dataSource = null!;
  private DbContextOptions<VsvkDbContext> _options = null!;
  private readonly Guid _subject = Guid.NewGuid();
  private readonly Guid _branch = Guid.NewGuid();

  public async Task InitializeAsync()
  {
    await _postgres.StartAsync();
    _dataSource = NpgsqlDataSource.Create(_postgres.GetConnectionString());
    _options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(_postgres.GetConnectionString()).Options;
    await using var command = _dataSource.CreateCommand("""
      create table vestigingen (id uuid primary key, naam text not null,
        instellingen_algemeen_id integer not null default 1, adres text not null default '',
        postcode text not null default '', plaats text not null default '', telefoon text not null default '',
        email text not null default '', kvk_nummer text not null default '', btw_nummer text not null default '',
        iban text not null default '');
      create table user_information (
        keycloak_sub uuid primary key, employee_number text, display_name text, job_title text,
        phone_number text, email_address text, vestiging_id uuid references vestigingen(id),
        is_active boolean not null default true, version bigint not null default 1,
        updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
        alternative_email text, digital_signature bytea, digital_signature_media_type text);
      create table skills (id uuid primary key, name text not null);
      create table user_skills (keycloak_sub uuid references user_information(keycloak_sub),
        skill_id uuid references skills(id), diploma_on date, valid_until date,
        primary key (keycloak_sub, skill_id));
      create table materieelgroep (id uuid primary key, omschrijving text not null, version bigint not null default 1);
      create table materieel (id uuid primary key, omschrijving text, kenteken text, merk text,
        zoeknaam text, serienummer text, standplaats_id uuid references vestigingen(id),
        materieelgroep_id uuid references materieelgroep(id), version bigint not null default 1);
      """);
    await command.ExecuteNonQueryAsync();
    await using var seed = _dataSource.CreateCommand("""
      with branch as (insert into vestigingen(id, naam) values ($1, 'Pijnacker') returning id)
      insert into user_information(keycloak_sub, display_name, vestiging_id)
      select $2, 'Medewerker', id from branch
      """);
    seed.Parameters.AddWithValue(_branch);
    seed.Parameters.AddWithValue(_subject);
    await seed.ExecuteNonQueryAsync();
  }

  public async Task DisposeAsync()
  {
    await _dataSource.DisposeAsync();
    await _postgres.DisposeAsync();
  }

  [Fact]
  public async Task Stale_status_update_does_not_replace_first_write()
  {
    await using var seedSkill = _dataSource.CreateCommand("""
      with skill as (insert into skills(id, name) values ($1, 'VCA') returning id)
      insert into user_skills(keycloak_sub, skill_id, diploma_on, valid_until)
      select $2, id, date '2024-01-01', date '2034-01-01' from skill
      """);
    seedSkill.Parameters.AddWithValue(Guid.NewGuid());
    seedSkill.Parameters.AddWithValue(_subject);
    await seedSkill.ExecuteNonQueryAsync();
    await using var context = new VsvkDbContext(_options);
    var repository = new PlanningRepository(context);
    var initial = await repository.GetEmployeeAsync(_subject, "Pijnacker", CancellationToken.None);
    Assert.NotNull(initial);
    var first = await repository.SetEmployeeActiveAsync(_subject, false, initial.Version, "Pijnacker", CancellationToken.None);
    var stale = await repository.SetEmployeeActiveAsync(_subject, true, initial.Version, "Pijnacker", CancellationToken.None);
    var current = await repository.GetEmployeeAsync(_subject, "Pijnacker", CancellationToken.None);
    Assert.NotNull(first);
    Assert.Equal(initial.Version + 1, first.Version);
    Assert.Null(stale);
    Assert.False(current!.Actief);
    Assert.Equal(first.Version, current.Version);
    Assert.Equal(new DateOnly(2024, 1, 1), Assert.Single(current.Skills).DiplomaOp);
    Assert.Equal(new DateOnly(2034, 1, 1), current.Skills[0].GeldigTot);
  }

  [Fact]
  public async Task Branch_filter_applies_to_reads_and_writes()
  {
    await using var equipment = _dataSource.CreateCommand("""
      insert into materieel(id, omschrijving, standplaats_id) values ($1, 'Bus', $2)
      """);
    equipment.Parameters.AddWithValue(Guid.NewGuid());
    equipment.Parameters.AddWithValue(_branch);
    await equipment.ExecuteNonQueryAsync();
    await using var context = new VsvkDbContext(_options);
    var repository = new PlanningRepository(context);
    Assert.Empty(await repository.ListEmployeesAsync("Andere vestiging", CancellationToken.None));
    Assert.Null(await repository.SetEmployeeActiveAsync(_subject, false, 1, "Andere vestiging", CancellationToken.None));
    Assert.NotNull(await repository.GetEmployeeAsync(_subject, _branch.ToString(), CancellationToken.None));
    Assert.True((await repository.GetEmployeeAsync(_subject, null, CancellationToken.None))!.Actief);
    Assert.Empty(await repository.ListEquipmentAsync("Andere vestiging", CancellationToken.None));
    Assert.Equal("Bus", Assert.Single(await repository.ListEquipmentAsync("Pijnacker", CancellationToken.None)).Omschrijving);
  }

  [Fact]
  public async Task Two_simultaneous_writers_cannot_both_update_the_same_version()
  {
    await using var firstContext = new VsvkDbContext(_options);
    await using var secondContext = new VsvkDbContext(_options);
    var first = new PlanningRepository(firstContext);
    var second = new PlanningRepository(secondContext);
    var results = await Task.WhenAll(
      first.SetEmployeeActiveAsync(_subject, false, 1, "Pijnacker", CancellationToken.None),
      second.SetEmployeeActiveAsync(_subject, true, 1, "Pijnacker", CancellationToken.None));
    Assert.Single(results, result => result is not null);
    Assert.Single(results, result => result is null);
    Assert.Equal(2, (await first.GetEmployeeAsync(_subject, "Pijnacker", CancellationToken.None))!.Version);
  }

  [Fact]
  public async Task Status_endpoint_requires_role_scope_and_valid_current_etag()
  {
    var builder = WebApplication.CreateSlimBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(_postgres.GetConnectionString()));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, PlanningTestAuthenticationHandler>("Test", _ => { });
    builder.Services.AddAuthorization(options => options.AddPolicy("planning-lijsten", policy =>
      policy.RequireAssertion(context => VsvkRoles.CanManagePlanning(context.User))));
    await using var app = builder.Build();
    app.UseAuthentication();
    app.UseAuthorization();
    app.MapPlanningEndpoints();
    await app.StartAsync();
    using var client = new HttpClient { BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single()) };
    var path = $"/api/planning/medewerkers/{_subject}/actief";

    async Task<HttpResponseMessage> Put(string? etag)
    {
      using var request = new HttpRequestMessage(HttpMethod.Put, path) { Content = JsonContent.Create(new { actief = false }) };
      if (etag is not null) request.Headers.TryAddWithoutValidation("If-Match", etag);
      return await client.SendAsync(request);
    }

    Assert.Equal(HttpStatusCode.Unauthorized, (await Put(null)).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", "finance");
    Assert.Equal(HttpStatusCode.Forbidden, (await Put(null)).StatusCode);
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", "planning");
    Assert.Equal(HttpStatusCode.Forbidden, (await Put(null)).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Pijnacker");
    var list = await client.GetAsync("/api/planning/medewerkers");
    using var listJson = JsonDocument.Parse(await list.Content.ReadAsStringAsync());
    Assert.Equal("\"1\"", listJson.RootElement[0].GetProperty("eTag").GetString());
    Assert.Equal((HttpStatusCode)428, (await Put(null)).StatusCode);
    Assert.Equal(HttpStatusCode.BadRequest, (await Put("W/\"1\"")).StatusCode);
    var saved = await Put("\"1\"");
    Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
    Assert.Equal("\"2\"", saved.Headers.ETag!.ToString());
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await Put("\"1\"")).StatusCode);
    var read = await client.GetAsync($"/api/planning/medewerkers/{_subject}");
    Assert.Equal("\"2\"", read.Headers.ETag!.ToString());
    client.DefaultRequestHeaders.Remove("X-Test-Branch");
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Andere vestiging");
    Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/planning/medewerkers/{_subject}")).StatusCode);
  }
}

public sealed class PlanningTestAuthenticationHandler(
  IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
  : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
  protected override Task<AuthenticateResult> HandleAuthenticateAsync()
  {
    if (!Request.Headers.TryGetValue("X-Test-Role", out var role)) return Task.FromResult(AuthenticateResult.NoResult());
    var claims = new List<Claim> { new(ClaimTypes.Role, VsvkRoles.Default), new(ClaimTypes.Role, role.ToString()) };
    if (Request.Headers.TryGetValue("X-Test-Branch", out var branch)) claims.Add(new Claim("vestiging", branch.ToString()));
    var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
    return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
  }
}
