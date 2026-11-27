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
using Vsvk.Api.Services;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class PlanningBoardTests
{
  [Fact]
  public async Task Planning_role_creates_and_updates_work_order_aggregate_with_concurrency()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    await using (var seed = source.CreateCommand("""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('00000000-0000-0000-0000-000000000011', 'Planvestiging', 'Straat 1', '0000AA', 'Plaats', '010', 'plan@example.test', '1', '1', 'NL00', 1)
      on conflict do nothing;
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, 'D1', 'Klant');
      insert into leveranciers(id, debiteurnummer, bedrijfsnaam) values (1, 'L1', 'Leverancier');
      insert into materieel(id, omschrijving, standplaats_id)
      values ('00000000-0000-0000-0000-000000000701', 'MG-02', '00000000-0000-0000-0000-000000000011');
      """))
    {
      await seed.ExecuteNonQueryAsync();
    }
    await using (var seed = source.CreateCommand(
      "insert into user_information(keycloak_sub, display_name, job_title, is_active) values ($1, 'Interne medewerker', 'Grondwerker', true)"))
    {
      seed.Parameters.AddWithValue(employeeId);
      await seed.ExecuteNonQueryAsync();
    }
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);

    Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync(
      "/api/planning/planbord?from=2026-11-16&to=2026-11-22")).StatusCode);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Directie);
    Assert.Equal(HttpStatusCode.OK, (await client.GetAsync(
      "/api/planning/planbord?from=2026-11-16&to=2026-11-22")).StatusCode);
    Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync(
      "/api/planning/werkopdrachten", WorkOrder(employeeId))).StatusCode);
    client.DefaultRequestHeaders.Remove("X-Test-Role");
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Planvestiging");

    var doubleBooked = WorkOrder(employeeId) with
    {
      Klussen =
      [
        WorkOrder(employeeId).Klussen![0],
        new("Tweede klus", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 16), 1,
          null, null, 1,
          [new(new DateOnly(2026, 11, 16), employeeId, null, null, null, null)])
      ]
    };
    Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync(
      "/api/planning/werkopdrachten", doubleBooked)).StatusCode);

    var orderWithEquipment = WorkOrder(employeeId) with
    {
      Klussen =
      [
        WorkOrder(employeeId).Klussen![0] with
        {
          MaterieelInzetten =
          [
            new PlanningBoardMaterialAssignmentWriteDto(new DateOnly(2026, 11, 16),
              Guid.Parse("00000000-0000-0000-0000-000000000701"), employeeId)
          ]
        }
      ]
    };
    using var createdResponse = await client.PostAsJsonAsync(
      "/api/planning/werkopdrachten", orderWithEquipment);
    Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
    var created = (await createdResponse.Content.ReadFromJsonAsync<PlanningBoardWorkOrderDto>())!;
    Assert.Equal("\"1\"", createdResponse.Headers.ETag?.ToString());
    Assert.Equal("GEPLAND", created.Status);
    Assert.Single(created.Klussen);
    Assert.Single(created.Klussen[0].Inzetten);
    var createdEquipment = Assert.Single(created.Klussen[0].MaterieelInzetten!);
    Assert.Equal("MG-02", createdEquipment.Materieel);
    Assert.Equal(employeeId, createdEquipment.MedewerkerId);
    var outside = await client.GetFromJsonAsync<List<PlanningBoardWorkOrderDto>>(
      "/api/planning/planbord?from=2026-11-23&to=2026-11-29");
    Assert.Empty(outside!);

    var read = await client.GetAsync($"/api/planning/werkopdrachten/{created.Id}");
    Assert.Equal("\"1\"", read.Headers.ETag?.ToString());
    var firstUpdate = orderWithEquipment with { Omschrijving = "Eerste wijziging" };
    var secondUpdate = orderWithEquipment with { Omschrijving = "Tweede wijziging" };
    Assert.Equal((HttpStatusCode)428, (await client.PutAsJsonAsync(
      $"/api/planning/werkopdrachten/{created.Id}", firstUpdate)).StatusCode);
    using var firstRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/planning/werkopdrachten/{created.Id}")
      { Content = JsonContent.Create(firstUpdate) };
    firstRequest.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    using var secondRequest = new HttpRequestMessage(HttpMethod.Put, $"/api/planning/werkopdrachten/{created.Id}")
      { Content = JsonContent.Create(secondUpdate) };
    secondRequest.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    var responses = await Task.WhenAll(client.SendAsync(firstRequest), client.SendAsync(secondRequest));
    Assert.Single(responses, response => response.StatusCode == HttpStatusCode.OK);
    Assert.Single(responses, response => response.StatusCode == HttpStatusCode.PreconditionFailed);
    Assert.Equal("\"2\"", responses.Single(response => response.StatusCode == HttpStatusCode.OK).Headers.ETag?.ToString());
    using var stale = new HttpRequestMessage(HttpMethod.Put, $"/api/planning/werkopdrachten/{created.Id}")
    {
      Content = JsonContent.Create(firstUpdate)
    };
    stale.Headers.TryAddWithoutValidation("If-Match", "\"1\"");
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await client.SendAsync(stale)).StatusCode);
  }

  [Fact]
  public async Task Subcontractor_is_a_separate_supplier_linked_resource()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    await using (var seed = source.CreateCommand(
      "insert into leveranciers(id, debiteurnummer, bedrijfsnaam) values (1, 'L1', 'Inhuurpartner')"))
      await seed.ExecuteNonQueryAsync();
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);

    using var response = await client.PostAsJsonAsync("/api/planning/inhuurmedewerkers",
      new PlanningSubcontractorWriteDto(1, "R. Smit", "Grondwerker", "06123", null));
    Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    var saved = (await response.Content.ReadFromJsonAsync<PlanningSubcontractorListDto>())!;
    Assert.Equal("Inhuurpartner", saved.Leverancier);
    Assert.Equal("\"1\"", response.Headers.ETag?.ToString());
    var list = await client.GetFromJsonAsync<List<PlanningSubcontractorListDto>>(
      "/api/planning/inhuurmedewerkers");
    Assert.Single(list!);
    Assert.Equal(saved.Id, list![0].Id);
  }

  [Fact]
  public async Task Overlapping_work_order_does_not_show_assignments_outside_selected_week()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    await using (var seed = source.CreateCommand("""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('00000000-0000-0000-0000-000000000010', 'Testvestiging', 'Straat 1', '0000AA', 'Plaats', '010', 'test@example.test', '1', '1', 'NL00', 1)
      on conflict do nothing;
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, 'D1', 'Klant');
      """)) await seed.ExecuteNonQueryAsync();
    await using (var seed = source.CreateCommand(
      "insert into user_information(keycloak_sub, display_name, is_active) values ($1, 'Medewerker', true)"))
    {
      seed.Parameters.AddWithValue(employeeId);
      await seed.ExecuteNonQueryAsync();
    }
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Testvestiging");
    var request = WorkOrder(employeeId) with
    {
      StartDatum = new DateOnly(2026, 11, 11),
      EindDatum = new DateOnly(2026, 11, 21),
      Klussen =
      [
        new("Paallijn", new DateOnly(2026, 11, 11), new DateOnly(2026, 11, 21), 1,
          new TimeOnly(7, 0), new TimeOnly(16, 0), 0,
          [new(new DateOnly(2026, 11, 11), employeeId, null, null, null, null)])
      ]
    };
    Assert.Equal(HttpStatusCode.Created, (await client.PostAsJsonAsync(
      "/api/planning/werkopdrachten", request)).StatusCode);
    var board = await client.GetFromJsonAsync<List<PlanningBoardWorkOrderDto>>(
      "/api/planning/planbord?from=2026-11-16&to=2026-11-22");
    Assert.Single(board!);
    Assert.Empty(board![0].Klussen[0].Inzetten);
  }

  [Fact]
  public async Task Timeline_contract_groups_day_health_people_and_slip_status()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    await using (var seed = source.CreateCommand("""
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, 'D1', 'Infra Noord BV');
      insert into leveranciers(id, debiteurnummer, bedrijfsnaam) values (1, 'L1', 'Inhuur BV');
      """)) await seed.ExecuteNonQueryAsync();
    await using (var seed = source.CreateCommand(
      "insert into user_information(keycloak_sub, display_name, job_title, is_active) values ($1, 'Jan de Vries', 'Grondwerker', true)"))
    {
      seed.Parameters.AddWithValue(employeeId);
      await seed.ExecuteNonQueryAsync();
    }

    await using (var seed = source.CreateCommand($"""
      insert into inhuurmedewerkers(id, leverancier_id, naam, functie)
      values ('00000000-0000-0000-0000-000000000101', 1, 'R. Smit', 'Grondwerker');
      insert into werkopdrachten(id, nummer, klant_id, omschrijving, start_datum, eind_datum, is_optie, kleur)
      values ('00000000-0000-0000-0000-000000000201', 'WO-26-0412', 1, 'Kabeltracé Parkweg vervangen', '2026-11-16', '2026-11-20', false, '#2f6fb5');
      insert into klussen(id, werkopdracht_id, omschrijving, start_datum, eind_datum, benodigde_medewerkers, start_tijd, eind_tijd, datum)
      values
        ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', 'Hoofddienst', '2026-11-16', '2026-11-20', 2, '06:45', '17:15', '2026-11-18');
      insert into klus_behoeften(id, klus_id, aantal, rol, soort) values
        ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000301', 2, 'Grondwerker', 'mens'),
        ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000301', 14, '33 - Transportmiddelen', 'materieel');
      insert into inzet(id, klus_id, datum, medewerker_id, inhuurmedewerker_id, start_tijd, eind_tijd) values
        ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', '2026-11-18', '{employeeId}', null, '06:45', '17:15'),
        ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000301', '2026-11-18', null, '00000000-0000-0000-0000-000000000101', '06:45', '17:15');
      insert into werkbonnen(id, inzet_id, nummer, status, gewijzigd_na_uitgifte)
      values
        ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000401', 'WB-0412-11', 'uitgereikt', false);
      """))
    {
      await seed.ExecuteNonQueryAsync();
    }
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Directie);

    var vm = await client.GetFromJsonAsync<TimelineViewModel>(
      "/api/planning/planbord/werkopdrachten?van=2026-11-16&tot=2026-11-22&zoom=week");
    Assert.NotNull(vm);
    Assert.Equal(1, vm.Totaal.Werkopdrachten);
    Assert.Equal(7, vm.Dagen.Count);
    var order = Assert.Single(vm.Groepen.SelectMany(group => group.Werkopdrachten));
    Assert.Equal("aandacht", order.Groep);
    Assert.Equal("OPEN 8", order.Status);
    Assert.Equal(1, order.Bonnen);
    Assert.Equal(0, order.BonnenBinnen);
    var day = order.Dagen[new DateOnly(2026, 11, 18)];
    Assert.Equal(2, day.Nodig);
    Assert.Equal(2, day.Bezet);
    Assert.Equal("vol", day.Bezetting);
    Assert.Equal(1, day.TeDoen);
    Assert.Equal(2, order.Mensen.Count);
    Assert.Contains(order.Mensen, person => person.Extern && person.Naam == "R. Smit"
      && person.Dagen[new DateOnly(2026, 11, 18)]!.Status == "GEEN_BON");

    var slips = await client.GetFromJsonAsync<List<PlanningWorkSlipListDto>>(
      "/api/planning/werkbonnen");
    var slip = Assert.Single(slips!);
    Assert.Equal("WB-0412-11", slip.Nummer);
    Assert.Equal("WO-26-0412", slip.WerkopdrachtNummer);
    Assert.Equal("Jan de Vries", slip.Medewerker);
    Assert.Equal("Infra Noord BV", slip.Klant);
  }

  [Fact]
  public async Task Work_order_numbers_are_allocated_atomically_without_year_reset()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    var branchId = Guid.NewGuid();
    await using (var seed = source.CreateCommand($"""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('{branchId}', 'Nummering', 'Straat 1', '0000AA', 'Plaats', '010', 'test@example.test', '1', '1', 'NL00', 1);
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, 'D1', 'Klant');
      insert into werkopdracht_teller(id, last_seq) values (1, 900) on conflict (id) do update set last_seq = 900;
      insert into werkopdrachten(id, nummer, klant_id, omschrijving, start_datum, eind_datum, vestiging_id)
      values (gen_random_uuid(), 'WO-2024-1005', 1, 'Bestaand', '2026-11-16', '2026-11-16', '{branchId}');
      insert into user_information(keycloak_sub, display_name, is_active)
      values ('{employeeId}', 'Medewerker', true);
      """))
    {
      await seed.ExecuteNonQueryAsync();
    }
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Nummering");
    var request = WorkOrder(employeeId) with { Nummer = null };
    var responses = await Task.WhenAll(
      client.PostAsJsonAsync("/api/planning/werkopdrachten", request),
      client.PostAsJsonAsync("/api/planning/werkopdrachten", request with { Omschrijving = "Tweede" }));
    Assert.All(responses, response => Assert.Equal(HttpStatusCode.Created, response.StatusCode));
    var one = await responses[0].Content.ReadFromJsonAsync<PlanningBoardWorkOrderDto>();
    var two = await responses[1].Content.ReadFromJsonAsync<PlanningBoardWorkOrderDto>();
    var numbers = new[] { one!.Nummer, two!.Nummer }.Order().ToList();
    var year = TimeZoneInfo.ConvertTime(
      DateTimeOffset.UtcNow, TimeZoneInfo.FindSystemTimeZoneById("Europe/Amsterdam")).ToString("yy");
    var prefix = $"WO-{year}-";
    Assert.Equal(new[] { prefix + "1006", prefix + "1007" }, numbers);
  }

  [Fact]
  public async Task Rich_work_order_form_creates_customer_daily_jobs_needs_orders_and_materials()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    var branchId = Guid.NewGuid();
    var equipmentGroupId = Guid.NewGuid();
    await using (var seed = source.CreateCommand($"""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('{branchId}', 'Formvestiging', 'Straat 1', '0000AA', 'Plaats', '010', 'form@example.test', '1', '1', 'NL00', 1);
      insert into user_information(keycloak_sub, display_name, job_title, is_active)
      values ('{employeeId}', 'Medewerker', 'Grondwerker', true);
      insert into materieelgroep(id, omschrijving) values ('{equipmentGroupId}', '33 - Transportmiddelen');
      """))
    {
      await seed.ExecuteNonQueryAsync();
    }
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Formvestiging");
    var request = new PlanningBoardWorkOrderWriteDto(
      null, 0, "Sleuf graven", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 22),
      false, "#2f8a5b", [], VestigingId: branchId, Soort: "regie",
      BestellerNaam: "Kees", WeekendOverslaan: true, VrijeDagen: [new DateOnly(2026, 11, 19)],
      KorteWerkomschrijving: "Sleuf graven", Werkadres: "Parkweg 2", WerkPlaats: "Delft",
      StartOpLocatie: new TimeOnly(7, 0), EindOpLocatie: new TimeOnly(16, 0), PauzeMinuten: 30,
      Ordernummers: ["PO-123"], Behoeften: [new(2, "Grondwerker", "VCA")],
      Materieel: [new(1, equipmentGroupId, null, "33 - Transportmiddelen")],
      Materialen: [new(10, null, "Bestrating", "st")],
      NieuweKlant: new("Nieuwe klant", "Parkweg 1", "2600AA", "Delft", "010", "klant@example.test"));
    using var response = await client.PostAsJsonAsync("/api/planning/werkopdrachten", request);
    Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    var created = await response.Content.ReadFromJsonAsync<PlanningBoardWorkOrderDto>();
    Assert.Equal("Nieuwe klant", created!.Klant);
    Assert.Equal(4, created.Klussen.Count);
    Assert.All(created.Klussen, job => Assert.Equal(2, job.BenodigdeMedewerkers));
    Assert.All(created.Klussen, job => {
      Assert.Contains(job.Behoeften!, need => need.Soort == "mens");
      var equipment = Assert.Single(job.Behoeften!, need => need.Soort == "materieel");
      Assert.Equal(equipmentGroupId, equipment.MaterieelGroepId);
    });
    Assert.Single(created.Materieel!);
    Assert.Equal(equipmentGroupId, created.Materieel![0].MaterieelGroepId);
    Assert.Single(created.Materialen!);
    Assert.Equal(new DateOnly(2026, 11, 16), created.Klussen[0].Datum);
    Assert.DoesNotContain(created.Klussen, job => job.Datum == new DateOnly(2026, 11, 19));
  }

  [Fact]
  public async Task Delete_work_order_requires_current_etag_and_removes_the_aggregate()
  {
    await using var postgres = new PostgreSqlBuilder().WithImage("postgres:16-alpine").Build();
    await postgres.StartAsync();
    await using var source = NpgsqlDataSource.Create(postgres.GetConnectionString());
    await new DatabaseMigrator(source).MigrateAsync();
    var employeeId = Guid.NewGuid();
    var branchId = Guid.NewGuid();
    await using (var seed = source.CreateCommand($"""
      insert into vestigingen(id, naam, adres, postcode, plaats, telefoon, email, kvk_nummer, btw_nummer, iban, instellingen_algemeen_id)
      values ('{branchId}', 'Verwijdervestiging', 'Straat 1', '0000AA', 'Plaats', '010', 'delete@example.test', '1', '1', 'NL00', 1);
      insert into klanten(id, debiteurnummer, bedrijfsnaam) values (1, 'D1', 'Klant');
      insert into user_information(keycloak_sub, display_name, is_active)
      values ('{employeeId}', 'Medewerker', true);
      """))
      await seed.ExecuteNonQueryAsync();
    await using var app = await StartAsync(postgres.GetConnectionString());
    using var client = Client(app);
    client.DefaultRequestHeaders.Add("X-Test-Role", VsvkRoles.Planning);
    client.DefaultRequestHeaders.Add("X-Test-Branch", "Verwijdervestiging");
    using var createdResponse = await client.PostAsJsonAsync("/api/planning/werkopdrachten",
      WorkOrder(employeeId) with { VestigingId = branchId, Nummer = null });
    var created = (await createdResponse.Content.ReadFromJsonAsync<PlanningBoardWorkOrderDto>())!;

    var withoutPrecondition = await client.DeleteAsync($"/api/planning/werkopdrachten/{created.Id}");
    Assert.Equal((HttpStatusCode)428, withoutPrecondition.StatusCode);

    using var stale = new HttpRequestMessage(HttpMethod.Delete, $"/api/planning/werkopdrachten/{created.Id}");
    stale.Headers.TryAddWithoutValidation("If-Match", "\"0\"");
    Assert.Equal(HttpStatusCode.PreconditionFailed, (await client.SendAsync(stale)).StatusCode);

    using var deletion = new HttpRequestMessage(HttpMethod.Delete, $"/api/planning/werkopdrachten/{created.Id}");
    deletion.Headers.TryAddWithoutValidation("If-Match", created.ETag);
    Assert.Equal(HttpStatusCode.NoContent, (await client.SendAsync(deletion)).StatusCode);
    Assert.Equal(HttpStatusCode.NotFound,
      (await client.GetAsync($"/api/planning/werkopdrachten/{created.Id}")).StatusCode);
  }

  private static PlanningBoardWorkOrderWriteDto WorkOrder(Guid employeeId) =>
    new("WO-26-0422", 1, "Sleuf graven", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 16),
      false, "#2f8a5b",
      [
        new("Werkdag", new DateOnly(2026, 11, 16), new DateOnly(2026, 11, 16), 1,
          new TimeOnly(7, 0), new TimeOnly(16, 0), 0,
          [
            new(new DateOnly(2026, 11, 16), employeeId, null, new TimeOnly(7, 0), new TimeOnly(16, 0), null)
          ])
      ]);

  private static async Task<WebApplication> StartAsync(string connectionString)
  {
    var builder = WebApplication.CreateSlimBuilder();
    builder.WebHost.UseUrls("http://127.0.0.1:0");
    builder.Services.AddDbContext<VsvkDbContext>(options => options.UseNpgsql(connectionString));
    builder.Services.AddScoped<PlanningRepository>();
    builder.Services.AddScoped<PlanningBoardRepository>();
    builder.Services.AddScoped<PlanningWorkOrderNumberAllocator>();
    builder.Services.AddScoped<PlanningTimelineService>();
    builder.Services.AddScoped<IPlanningCustomerService, PlanningCustomerService>();
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
    app.MapPlanningEndpoints();
    app.MapPlanningBoardEndpoints();
    await app.StartAsync();
    return app;
  }

  private static HttpClient Client(WebApplication app) => new()
  {
    BaseAddress = new Uri(app.Services.GetRequiredService<IServer>().Features
      .Get<IServerAddressesFeature>()!.Addresses.Single())
  };
}
