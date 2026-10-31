using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Vsvk.Api.Auth;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;

var builder = WebApplication.CreateBuilder(args);

var connectionString = builder.Configuration.GetConnectionString("AppDb")
  ?? builder.Configuration["ConnectionStrings:AppDb"]
  ?? throw new InvalidOperationException("Missing ConnectionStrings:AppDb");

builder.Services.AddDbContext<VsvkDbContext>(options =>
  options.UseNpgsql(connectionString));

builder.Services.AddSingleton(_ => NpgsqlDataSource.Create(connectionString));

builder.Services.AddSingleton<StamdataRepository>();
builder.Services.AddSingleton<CalculatieRepository>();
builder.Services.AddScoped<InstellingenRepository>();
builder.Services.AddScoped<VestigingRepository>();
builder.Services.AddSingleton<DatabaseMigrator>();

builder.Services.AddTransient<IClaimsTransformation, KeycloakRealmRoleClaimsTransformation>();

var jwtSection = builder.Configuration.GetSection("Jwt");
var jwtAuthority = jwtSection["Authority"] ?? throw new InvalidOperationException("Missing Jwt:Authority");
var jwtMetadataAddress = jwtSection["MetadataAddress"];
var jwtAudience = jwtSection["Audience"] ?? throw new InvalidOperationException("Missing Jwt:Audience");

builder.Services
  .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
  .AddJwtBearer(options =>
  {
    options.Authority = jwtAuthority;
    if (!string.IsNullOrWhiteSpace(jwtMetadataAddress))
    {
      options.MetadataAddress = jwtMetadataAddress;
    }
    options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();

    options.TokenValidationParameters = new TokenValidationParameters
    {
      ValidateIssuer = true,
      ValidIssuer = jwtAuthority,
      ValidateAudience = true,
      ValidAudience = jwtAudience,
      ValidateLifetime = true,
      ValidateIssuerSigningKey = true,
      NameClaimType = ClaimTypes.Name,
      RoleClaimType = ClaimTypes.Role
    };
  });

builder.Services.AddAuthorization(options =>
{
  options.AddPolicy(VsvkRoles.Default, policy => policy.RequireAssertion(context => VsvkRoles.IsApplicationUser(context.User)));
  options.AddPolicy("directie", policy => policy.RequireRole(VsvkRoles.Directie));
});

var app = builder.Build();

if (args.Contains("--migrate"))
{
  var migrator = app.Services.GetRequiredService<DatabaseMigrator>();
  await migrator.MigrateAsync(app.Lifetime.ApplicationStopping);
  return;
}

static string? GetUserSub(ClaimsPrincipal user)
  => user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);

static string? GetUserVestiging(ClaimsPrincipal user)
  => VsvkRoles.GetVestiging(user);

static long? ParseIfMatch(HttpRequest request)
{
  if (!request.Headers.TryGetValue("If-Match", out var values))
  {
    return null;
  }

  var raw = values.ToString().Trim();
  if (raw.StartsWith("W/\"", StringComparison.OrdinalIgnoreCase) && raw.EndsWith("\"", StringComparison.Ordinal))
  {
    raw = raw[3..^1];
  }
  else if (raw.StartsWith('"') && raw.EndsWith('"'))
  {
    raw = raw[1..^1];
  }

  return long.TryParse(raw, out var v) ? v : null;
}

static void SetEtag(HttpResponse response, long version)
  => response.Headers.ETag = $"W/\"{version}\"";

static decimal RoundCurrency(decimal value)
  => decimal.Round(value, 2, MidpointRounding.AwayFromZero);

static decimal? ReadNullableDecimal(System.Text.Json.JsonElement value)
{
  if (value.ValueKind == System.Text.Json.JsonValueKind.Number)
  {
    return value.GetDecimal();
  }

  if (value.ValueKind == System.Text.Json.JsonValueKind.String && decimal.TryParse(value.GetString(), out var parsed))
  {
    return parsed;
  }

  return null;
}

static decimal? ReadDecimalProperty(System.Text.Json.JsonElement element, string propertyName)
{
  if (!element.TryGetProperty(propertyName, out var property))
  {
    return null;
  }

  return ReadNullableDecimal(property);
}

static CalculatieTotals ExtractTotals(System.Text.Json.JsonElement root, string dataJson, decimal fallbackBedrag)
{
  decimal? subtotalFromBody = ReadDecimalProperty(root, "subtotaal") ?? ReadDecimalProperty(root, "subtotal");
  decimal? totalFromBody = ReadDecimalProperty(root, "totaal") ?? ReadDecimalProperty(root, "total") ?? ReadDecimalProperty(root, "bedrag");
  decimal? vatRateFromBody = ReadDecimalProperty(root, "btwTarief") ?? ReadDecimalProperty(root, "btw") ?? ReadDecimalProperty(root, "vatRate");

  decimal? subtotalFromData = null;
  decimal? totalFromData = null;
  decimal? vatRateFromData = null;

  try
  {
    using var dataDoc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(dataJson) ? "{}" : dataJson);
    var dataRoot = dataDoc.RootElement;

    if (dataRoot.TryGetProperty("offerte", out var offerte))
    {
      vatRateFromData = ReadDecimalProperty(offerte, "btw") ?? ReadDecimalProperty(offerte, "btwTarief");
    }

    if (dataRoot.TryGetProperty("totalen", out var totals))
    {
      subtotalFromData = ReadDecimalProperty(totals, "subtotaal") ?? ReadDecimalProperty(totals, "subtotal");
      totalFromData = ReadDecimalProperty(totals, "totaal") ?? ReadDecimalProperty(totals, "total");
    }
  }
  catch
  {
    // Ignore malformed payload; we fall back to request-level numbers.
  }

  var subtotal = subtotalFromBody ?? subtotalFromData ?? totalFromBody ?? totalFromData ?? fallbackBedrag;
  var vatRate = vatRateFromBody ?? vatRateFromData ?? 0.21m;
  var total = totalFromBody ?? totalFromData ?? RoundCurrency(subtotal * (1m + vatRate));
  var vatAmount = RoundCurrency(total - subtotal);

  return new CalculatieTotals(
    Subtotaal: RoundCurrency(subtotal),
    BtwTarief: decimal.Round(vatRate, 4, MidpointRounding.AwayFromZero),
    BtwBedrag: vatAmount,
    Totaal: RoundCurrency(total)
  );
}

static JsonElement GetOrNull(System.Text.Json.JsonElement element, string propertyName)
{
  if (element.TryGetProperty(propertyName, out var value))
  {
    return value.Clone();
  }

  using var doc = System.Text.Json.JsonDocument.Parse("null");
  return doc.RootElement.Clone();
}
static List<CalculationArticleSelection> ExtractSelectedArticles(string dataJson)
{
  var selected = new List<CalculationArticleSelection>();
  if (string.IsNullOrWhiteSpace(dataJson))
  {
    return selected;
  }

  try
  {
    using var doc = System.Text.Json.JsonDocument.Parse(dataJson);
    var root = doc.RootElement;

    var articleDefinitions = new Dictionary<string, (string? category, decimal? unitPrice)>(StringComparer.OrdinalIgnoreCase);
    if (root.TryGetProperty("artikelen", out var artikelen) && artikelen.ValueKind == System.Text.Json.JsonValueKind.Array)
    {
      foreach (var item in artikelen.EnumerateArray())
      {
        var artikelNaam = item.TryGetProperty("a", out var artikelEl) ? artikelEl.GetString() : null;
        if (string.IsNullOrWhiteSpace(artikelNaam))
        {
          continue;
        }

        var category = item.TryGetProperty("c", out var catEl) ? catEl.GetString() : null;
        var unitPrice = item.TryGetProperty("t", out var priceEl) ? ReadNullableDecimal(priceEl) : null;
        articleDefinitions[artikelNaam] = (category, unitPrice);
      }
    }

    if (!root.TryGetProperty("blocks", out var blocks) || blocks.ValueKind != System.Text.Json.JsonValueKind.Array)
    {
      return selected;
    }

    foreach (var block in blocks.EnumerateArray())
    {
      if (!block.TryGetProperty("lines", out var lines) || lines.ValueKind != System.Text.Json.JsonValueKind.Array)
      {
        continue;
      }

      foreach (var line in lines.EnumerateArray())
      {
        var articleName = line.TryGetProperty("artikel", out var artikelEl) ? artikelEl.GetString() : null;
        if (string.IsNullOrWhiteSpace(articleName))
        {
          continue;
        }

        var lineId = line.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;

        decimal? aantal = line.TryGetProperty("aantal", out var aantalEl) ? ReadNullableDecimal(aantalEl) : null;
        decimal? dagen = line.TryGetProperty("dagen", out var dagenEl) ? ReadNullableDecimal(dagenEl) : null;
        decimal? uren = line.TryGetProperty("uren", out var urenEl) ? ReadNullableDecimal(urenEl) : null;
        decimal? toeslag = line.TryGetProperty("toeslag", out var toeslagEl) ? ReadNullableDecimal(toeslagEl) : null;

        articleDefinitions.TryGetValue(articleName, out var def);

        var qty = aantal ?? 1m;
        var dayFactor = dagen ?? 1m;
        var hourFactor = uren ?? 1m;
        var surcharge = toeslag ?? 1m;
        decimal? lineTotal = null;

        if (def.unitPrice is not null)
        {
          lineTotal = RoundCurrency(def.unitPrice.Value * qty * dayFactor * hourFactor * surcharge);
        }

        selected.Add(new CalculationArticleSelection(
          LineId: lineId,
          ArtikelNaam: articleName,
          Categorie: def.category,
          Aantal: aantal,
          Dagen: dagen,
          Uren: uren,
          Toeslag: toeslag,
          Eenheidsprijs: def.unitPrice,
          RegelTotaal: lineTotal
        ));
      }
    }
  }
  catch
  {
    return selected;
  }

  return selected;
}

app.MapGet("/health", () => Results.Ok(new { ok = true }))
  .AllowAnonymous();

app.UseAuthentication();
app.UseAuthorization();

// Example endpoint (stays for now)
app.MapGet("/api/stamdata", async (StamdataRepository repo) =>
  {
    var rows = await repo.ListAsync();
    return Results.Ok(rows);
  })
  .RequireAuthorization(VsvkRoles.Default);

// === Calculaties ===

app.MapPost("/api/calculaties", async (HttpContext ctx, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    var vestiging = GetUserVestiging(ctx.User);
    var createdBySub = GetUserSub(ctx.User);

    var created = await repo.CreateAsync(vestiging, createdBySub, ct);

    ctx.Response.StatusCode = StatusCodes.Status201Created;
    SetEtag(ctx.Response, created.Version);

    return Results.Json(new { nummer = created.Nummer, version = created.Version });
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapGet("/api/calculaties", async (HttpContext ctx, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);

    var list = await repo.ListAsync(vestigingFilter, ct);

    // Return in SPA-compat format (data als JSON-string)
    var result = list.Select(r => new
    {
      nummer = r.Nummer,
      projectnaam = r.Projectnaam,
      klant = r.Klant,
      datum = r.Datum?.ToString("yyyy-MM-dd") ?? "",
      door = r.Door,
      vestiging = r.Vestiging,
      status = r.Status,
      bedrag = r.Bedrag,
      bijgewerkt = r.Bijgewerkt.ToString("o"),
      data = r.DataJson,
      subtotaal = r.Totals.Subtotaal,
      btwTarief = r.Totals.BtwTarief,
      btwBedrag = r.Totals.BtwBedrag,
      totaal = r.Totals.Totaal,
      version = r.Version
    });

    return Results.Json(result);
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapGet("/api/calculaties/{nummer}", async (HttpContext ctx, string nummer, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);

    var record = await repo.GetAsync(nummer, vestigingFilter, ct);
    if (record is null)
    {
      return Results.NotFound();
    }

    SetEtag(ctx.Response, record.Version);

    return Results.Json(new
    {
      nummer = record.Nummer,
      projectnaam = record.Projectnaam,
      klant = record.Klant,
      datum = record.Datum?.ToString("yyyy-MM-dd") ?? "",
      door = record.Door,
      vestiging = record.Vestiging,
      status = record.Status,
      bedrag = record.Bedrag,
      bijgewerkt = record.Bijgewerkt.ToString("o"),
      data = record.DataJson,
      subtotaal = record.Totals.Subtotaal,
      btwTarief = record.Totals.BtwTarief,
      btwBedrag = record.Totals.BtwBedrag,
      totaal = record.Totals.Totaal,
      version = record.Version
    });
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapPut("/api/calculaties/{nummer}", async (HttpContext ctx, string nummer, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync(ct);

    // We keep this loose (SPA sends record with data as string). We only extract what we need.
    using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);
    var root = doc.RootElement;

    string GetStr(string name)
      => root.TryGetProperty(name, out var p) && p.ValueKind == System.Text.Json.JsonValueKind.String ? (p.GetString() ?? "") : "";

    decimal GetDec(string name)
      => root.TryGetProperty(name, out var p) && p.ValueKind == System.Text.Json.JsonValueKind.Number ? p.GetDecimal() : 0m;

    var expectedVersion = ParseIfMatch(ctx.Request);

    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);

    // Vestiging is stored on the record; if claim exists and the user lacks organization-wide access, enforce it.
    var vestiging = GetStr("vestiging");
    if (!VsvkRoles.HasOrganizationWideAccess(ctx.User))
    {
      var userVest = GetUserVestiging(ctx.User);
      if (!string.IsNullOrWhiteSpace(userVest))
      {
        vestiging = userVest;
      }
    }

    var datumStr = GetStr("datum");
    DateOnly? datum = DateOnly.TryParse(datumStr, out var d) ? d : null;

    var dataJson = GetStr("data");
    if (string.IsNullOrWhiteSpace(dataJson))
    {
      dataJson = "{}";
    }

    var requestedStatus = GetStr("status");
    if (string.IsNullOrWhiteSpace(requestedStatus))
    {
      requestedStatus = "Concept";
    }

    var status = requestedStatus;
    if (!VsvkRoles.HasOrganizationWideAccess(ctx.User))
    {
      var existing = await repo.GetAsync(nummer, vestigingFilter, ct);
      status = existing?.Status ?? "Concept";
    }

    var bedrag = GetDec("bedrag");
    var totals = ExtractTotals(root, dataJson, bedrag);
    var selectedArticles = ExtractSelectedArticles(dataJson);

    var rec = new CalculatieRecord(
      Nummer: nummer,
      Projectnaam: GetStr("projectnaam"),
      Klant: GetStr("klant"),
      Datum: datum,
      Door: GetStr("door"),
      Vestiging: vestiging,
      Status: status,
      Bedrag: bedrag,
      DataJson: dataJson,
      Version: 0,
      Bijgewerkt: DateTimeOffset.UtcNow,
      Totals: totals
    );

    var updated = await repo.UpsertAsync(rec, totals, selectedArticles, expectedVersion, vestigingFilter, GetUserSub(ctx.User), ct);
    if (updated is null)
    {
      // Either not found / forbidden by vestiging / or version mismatch
      if (expectedVersion is not null)
      {
        return Results.StatusCode(StatusCodes.Status409Conflict);
      }

      return Results.NotFound();
    }

    SetEtag(ctx.Response, updated.Version);

    return Results.Json(new
    {
      nummer = updated.Nummer,
      projectnaam = updated.Projectnaam,
      klant = updated.Klant,
      datum = updated.Datum?.ToString("yyyy-MM-dd") ?? "",
      door = updated.Door,
      vestiging = updated.Vestiging,
      status = updated.Status,
      bedrag = updated.Bedrag,
      bijgewerkt = updated.Bijgewerkt.ToString("o"),
      data = updated.DataJson,
      subtotaal = updated.Totals.Subtotaal,
      btwTarief = updated.Totals.BtwTarief,
      btwBedrag = updated.Totals.BtwBedrag,
      totaal = updated.Totals.Totaal,
      version = updated.Version
    });
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapPatch("/api/calculaties/{nummer}/status", async (HttpContext ctx, string nummer, CalculatieRepository repo, CancellationToken ct) =>
  {
    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync(ct);
    using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);

    var status = doc.RootElement.TryGetProperty("status", out var s) && s.ValueKind == System.Text.Json.JsonValueKind.String
      ? (s.GetString() ?? "")
      : "";

    if (string.IsNullOrWhiteSpace(status))
    {
      return Results.BadRequest(new { error = "Missing status" });
    }

    var expectedVersion = ParseIfMatch(ctx.Request);
    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);

    var updated = await repo.SetStatusAsync(nummer, status, expectedVersion, vestigingFilter, GetUserSub(ctx.User), ct);
    if (updated is null)
    {
      if (expectedVersion is not null)
      {
        return Results.StatusCode(StatusCodes.Status409Conflict);
      }

      return Results.NotFound();
    }

    SetEtag(ctx.Response, updated.Version);

    return Results.Json(new
    {
      nummer = updated.Nummer,
      projectnaam = updated.Projectnaam,
      klant = updated.Klant,
      datum = updated.Datum?.ToString("yyyy-MM-dd") ?? "",
      door = updated.Door,
      vestiging = updated.Vestiging,
      status = updated.Status,
      bedrag = updated.Bedrag,
      bijgewerkt = updated.Bijgewerkt.ToString("o"),
      data = updated.DataJson,
      subtotaal = updated.Totals.Subtotaal,
      btwTarief = updated.Totals.BtwTarief,
      btwBedrag = updated.Totals.BtwBedrag,
      totaal = updated.Totals.Totaal,
      version = updated.Version
    });
  })
  .RequireAuthorization("directie");

app.MapDelete("/api/calculaties/{nummer}", async (HttpContext ctx, string nummer, CalculatieRepository repo, CancellationToken ct) =>
  {
    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);

    var ok = await repo.SoftDeleteAsync(nummer, vestigingFilter, GetUserSub(ctx.User), ct);
    return ok ? Results.NoContent() : Results.NotFound();
  })
  .RequireAuthorization("directie");

// === Instellingen (algemeen) ===

app.MapGet("/api/instellingen/algemeen", async Task<Results<Ok<InstellingenAlgemeenDto>, NotFound>> (HttpContext ctx, ClaimsPrincipal user, InstellingenRepository repo, CancellationToken ct) =>
  {
    var settings = await repo.GetAlgemeenAsync(user, ct);
    if (settings is null)
    {
      return TypedResults.NotFound();
    }

    SetEtag(ctx.Response, settings.Version);
    return TypedResults.Ok(settings);
  })
  .WithName("GetInstellingenAlgemeen")
  .WithSummary("Haalt algemene instellingen inclusief rolgefilterde vestigingen op")
  .Produces<InstellingenAlgemeenDto>(StatusCodes.Status200OK)
  .Produces(StatusCodes.Status404NotFound)
  .RequireAuthorization(VsvkRoles.Default);

app.MapPut("/api/instellingen/algemeen", async (HttpContext ctx, InstellingenRepository repo, VestigingRepository vestigingRepo, CancellationToken ct) =>
  {
    var expectedVersion = ParseIfMatch(ctx.Request);

    using var reader = new StreamReader(ctx.Request.Body);
    var body = await reader.ReadToEndAsync(ct);

    using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(body) ? "{}" : body);

    var updated = await repo.PutAsync(doc.RootElement, expectedVersion, GetUserSub(ctx.User), ct);
    if (updated is null)
    {
      if (expectedVersion is not null)
      {
        return Results.StatusCode(StatusCodes.Status409Conflict);
      }

      return Results.NotFound();
    }

    SetEtag(ctx.Response, updated.Version);

    return Results.Json(new
    {
      bijgewerkt = updated.UpdatedAt.ToString("o"),
      version = updated.Version,
      artikelen = GetOrNull(updated.Data, "artikelen"),
      vestigingen = await vestigingRepo.ListAsync(ctx.User, ct),
      medewerkers = GetOrNull(updated.Data, "medewerkers"),
      onderdelen = GetOrNull(updated.Data, "onderdelen"),
      sugg = GetOrNull(updated.Data, "sugg"),
      teksten = GetOrNull(updated.Data, "teksten"),
      standaard = GetOrNull(updated.Data, "standaard")
    });
  })
  .RequireAuthorization("directie");



app.MapGet("/api/calculations", async (HttpContext ctx, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    var vestigingFilter = VsvkRoles.HasOrganizationWideAccess(ctx.User) ? null : GetUserVestiging(ctx.User);
    var list = await repo.ListAsync(vestigingFilter, ct);

    var result = list.Select(r => new
    {
      number = r.Nummer,
      projectName = r.Projectnaam,
      customer = r.Klant,
      date = r.Datum?.ToString("yyyy-MM-dd") ?? "",
      by = r.Door,
      branch = r.Vestiging,
      status = r.Status,
      amount = r.Bedrag,
      summary = new
      {
        subtotal = r.Totals.Subtotaal,
        vatRate = r.Totals.BtwTarief,
        vatAmount = r.Totals.BtwBedrag,
        total = r.Totals.Totaal
      },
      updatedAt = r.Bijgewerkt.ToString("o"),
      data = r.DataJson,
      version = r.Version
    });

    return Results.Json(result);
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapPost("/api/calculations", async (HttpContext ctx, CalculatieRepository repo, CancellationToken ct) =>
  {
    if (!VsvkRoles.HasRequiredVestigingScope(ctx.User))
    {
      return Results.Forbid();
    }

    var vestiging = GetUserVestiging(ctx.User);
    var createdBySub = GetUserSub(ctx.User);

    var created = await repo.CreateAsync(vestiging, createdBySub, ct);

    ctx.Response.StatusCode = StatusCodes.Status201Created;
    SetEtag(ctx.Response, created.Version);

    return Results.Json(new { number = created.Nummer, version = created.Version });
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapGet("/api/articles/autocomplete", async (string? q, int? limit, CalculatieRepository repo, CancellationToken ct) =>
  {
    var query = (q ?? string.Empty).Trim();
    var items = await repo.AutocompleteArticlesAsync(query, limit ?? 10, ct);
    return Results.Json(items);
  })
  .RequireAuthorization(VsvkRoles.Default);

app.MapGet("/api/management/secret", () => Results.Ok(new { ok = true, secret = "directie-only" }))
  .RequireAuthorization("directie");

app.Run();
