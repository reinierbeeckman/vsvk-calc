using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Endpoints;
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningCreateDatabaseTests
{
  [Fact]
  public async Task Article_creation_uses_development_role_transformation_and_persists()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(postgres.GetConnectionString()).Options;
    await using var context = new VsvkDbContext(options);
    var category = await context.ArtikelCategorieen.AsNoTracking().Where(item => item.Actief).Select(item => item.Id).FirstAsync();
    var unit = await context.ArtikelEenheden.AsNoTracking().Where(item => item.Actief).Select(item => item.Id).FirstAsync();
    var body = new { naam = "Nieuw testartikel", categorieId = category, eenheidId = unit, tariefSoort = "vast", tarief = 12m, actief = true };

    foreach (var (environment, enabled, roles, expected) in new[]
    {
      ("Production", true, "default-roles-vsvk,development", HttpStatusCode.Forbidden),
      ("Development", false, "default-roles-vsvk,development", HttpStatusCode.Forbidden),
      ("Development", true, "development", HttpStatusCode.Forbidden),
      ("Development", true, "", HttpStatusCode.Unauthorized),
      ("Development", true, "default-roles-vsvk,development", HttpStatusCode.Created)
    })
    {
      var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { EnvironmentName = environment });
      builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?> { ["DevelopmentAccess:Enabled"] = enabled.ToString() });
      builder.WebHost.UseUrls("http://127.0.0.1:0");
      builder.Services.AddDbContext<VsvkDbContext>(db => db.UseNpgsql(postgres.GetConnectionString()));
      builder.Services.AddScoped<ArtikelRepository>();
      builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, DevelopmentTestHandler>("Test", _ => { });
      builder.Services.AddTransient<IClaimsTransformation, KeycloakRealmRoleClaimsTransformation>();
      builder.Services.AddAuthorization(auth =>
      {
        auth.AddPolicy(VsvkRoles.Default, policy => policy.RequireAssertion(c => VsvkRoles.IsApplicationUser(c.User)));
        auth.AddPolicy("directie", policy => policy.RequireRole(VsvkRoles.Directie));
      });
      await using var app = builder.Build();
      app.UseAuthentication(); app.UseAuthorization(); app.MapArtikelEndpoints();
      await app.StartAsync();
      var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.Single();
      using var client = new HttpClient { BaseAddress = new Uri(address) };
      if (roles.Length > 0) client.DefaultRequestHeaders.Add("X-Roles", roles);
      using var response = await client.PostAsJsonAsync("/api/articles", body);
      Assert.Equal(expected, response.StatusCode);
      if (expected == HttpStatusCode.Created)
      {
        var article = await response.Content.ReadFromJsonAsync<ArtikelDto>();
        Assert.Equal("\"1\"", response.Headers.ETag!.ToString());
        Assert.EndsWith(article!.Id.ToString(), response.Headers.Location!.ToString());
        Assert.True(await context.Artikelen.AsNoTracking().AnyAsync(item => item.Id == article.Id));
      }
    }
  }

  [Fact]
  public async Task New_customer_equipment_and_rate_are_persisted_with_initial_versions()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand("""
      insert into skills (name) values ('VCA');
      alter table user_skills add constraint test_employee_create_rollback
        check (diploma_on is distinct from date '2000-01-01');
      """)) await seed.ExecuteNonQueryAsync();
    var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(postgres.GetConnectionString()).Options;
    await using var context = new VsvkDbContext(options);
    var repository = new PlanningRepository(context);
    var employee = await repository.CreateEmployeeAsync(new PlanningEmployeeUpdateRequest("42", "Nieuwe medewerker", null, null, null, null, true, [new("VCA", null, null)]), default);
    Assert.Equal(PlanningEmployeeUpdateStatus.Saved, employee.Status);
    Assert.NotEqual(Guid.Empty, employee.Employee!.Id);
    Assert.Equal("\"1\"", employee.Employee.ETag);
    var persistedEmployee = (await repository.GetEmployeeAsync(employee.Employee.Id, null, default))!;
    Assert.Equal("Nieuwe medewerker", persistedEmployee.Naam);
    Assert.Equal("VCA", Assert.Single(persistedEmployee.Skills).Naam);
    Assert.Equal(PlanningEmployeeUpdateStatus.Invalid, (await repository.CreateEmployeeAsync(
      new PlanningEmployeeUpdateRequest(null, "Ongeldige vaardigheid", null, null, null, null, true, [new("Onbekend", null, null)]), default)).Status);
    await using (var failingEmployeeContext = new VsvkDbContext(options))
      await Assert.ThrowsAsync<DbUpdateException>(() => new PlanningRepository(failingEmployeeContext).CreateEmployeeAsync(
        new PlanningEmployeeUpdateRequest(null, "Terugrollen medewerker", null, null, null, null, true, [new("VCA", new DateOnly(2000, 1, 1), null)]), default));
    Assert.Single(await repository.ListEmployeesAsync(null, default));
    var customer = await repository.CreateCustomerAsync(new CreatePlanningCustomerRequest("999", "Nieuwe klant"), default);
    Assert.Equal("Nieuwe klant", (await repository.GetCustomerAsync(customer.Id, default))!.Bedrijfsnaam);
    Assert.Equal("\"1\"", customer.ETag);

    var equipmentRepository = new PlanningMaterieelMutationRepository(context);
    var equipment = await equipmentRepository.CreateAsync(new PlanningMaterieelUpdateRequest("Nieuwe machine", null, null, null, null, null, null), default);
    Assert.NotNull(equipment.Materieel);
    Assert.Equal("\"1\"", equipment.Materieel!.ETag);
    Assert.Equal("Nieuwe machine", (await equipmentRepository.GetAsync(equipment.Materieel.Id, default))!.Omschrijving);
    var invalid = await equipmentRepository.CreateAsync(new PlanningMaterieelUpdateRequest("Ongeldig", null, null, null, null, Guid.NewGuid(), null), default);
    Assert.True(invalid.Invalid);

    var tariffs = new PlanningTariffDetailService(context);
    var rate = await tariffs.CreateAsync(new PlanningTariffDetailRequest("Nieuwe functie", true, 55m, "uur", new DateOnly(2020, 1, 1)), default);
    Assert.Equal("\"1\"", rate.ETag);
    Assert.Equal("Nieuwe functie", (await tariffs.GetAsync(rate.Id, default))!.Functie);
    Assert.Contains(await repository.ListRatesAsync(default), item => item.StandaardTariefId == rate.Id);

    await using var duplicateContext = new VsvkDbContext(options);
    await Assert.ThrowsAsync<DbUpdateException>(() => new PlanningRepository(duplicateContext)
      .CreateCustomerAsync(new CreatePlanningCustomerRequest("999", "Dubbel"), default));
    Assert.Single(await repository.ListCustomersAsync(default));

    await using var failingContext = new VsvkDbContext(options);
    await Assert.ThrowsAsync<DbUpdateException>(() => new PlanningTariffDetailService(failingContext)
      .CreateAsync(new PlanningTariffDetailRequest("Terugrollen", true, 1m, new string('x', 51), new DateOnly(2020, 1, 1)), default));
    Assert.False(await context.PlanningFuncties.AsNoTracking().AnyAsync(item => item.Naam == "Terugrollen"));
  }
}
