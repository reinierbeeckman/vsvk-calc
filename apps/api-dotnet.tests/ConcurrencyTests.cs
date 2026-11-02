using Npgsql;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;
using Testcontainers.PostgreSql;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;
using Vsvk.Api.Http;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class IfMatchParserTests
{
  [Fact]
  public void Missing_precondition_is_required()
  {
    var result = IfMatchParser.Parse(null);

    Assert.Equal(428, result.StatusCode);
    Assert.Null(result.Version);
  }

  [Theory]
  [InlineData("")]
  [InlineData("W/\"7\"")]
  [InlineData("7")]
  [InlineData("\"abc\"")]
  [InlineData("\"07\"")]
  [InlineData("\"7\", \"8\"")]
  [InlineData("*")]
  [InlineData("\"0\"")]
  public void Weak_or_malformed_precondition_is_bad_request(string raw)
  {
    var result = IfMatchParser.Parse(raw);

    Assert.Equal(400, result.StatusCode);
    Assert.Null(result.Version);
  }

  [Fact]
  public void Strong_numeric_etag_returns_expected_version()
  {
    var result = IfMatchParser.Parse("\"7\"");

    Assert.Equal(200, result.StatusCode);
    Assert.Equal(7, result.Version);
  }
}

public sealed class CalculatieConcurrencyTests : IAsyncLifetime
{
  private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
    .WithImage("postgres:16-alpine")
    .Build();
  private NpgsqlDataSource _dataSource = null!;

  public async Task InitializeAsync()
  {
    await _postgres.StartAsync();
    _dataSource = NpgsqlDataSource.Create(_postgres.GetConnectionString());
    await using var cmd = _dataSource.CreateCommand("""
      create table calc_counters (jaar int primary key, last_seq int not null);
      create table calculaties (
        nummer text primary key, jaar int not null, seq int not null,
        projectnaam text not null, klant text not null, datum date null,
        door text not null, vestiging text not null, status text not null,
        bedrag_snapshot numeric(14,2) not null, subtotal_snapshot numeric(14,2) not null default 0,
        btw_rate_snapshot numeric(8,4) not null default 0, btw_amount_snapshot numeric(14,2) not null default 0,
        total_snapshot numeric(14,2) not null default 0, data jsonb not null,
        version bigint not null default 1, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), created_by_sub text null,
        updated_by_sub text null, is_deleted boolean not null default false,
        deleted_at timestamptz null, unique(jaar, seq));
      create table calculatie_artikelen (
        id bigserial primary key, calculatie_nummer text not null references calculaties(nummer) on delete cascade,
        line_id text null, artikel_naam text not null, categorie text null,
        aantal numeric(14,4) null, dagen numeric(14,4) null, uren numeric(14,4) null,
        toeslag numeric(14,4) null, eenheidsprijs numeric(14,4) null,
        regel_totaal numeric(14,2) null, created_at timestamptz not null default now());
      create table instellingen_algemeen (
        id int primary key, systeem_naam text not null default '', data jsonb not null,
        version bigint not null default 1, updated_at timestamptz not null default now(), updated_by_sub text null);
      insert into instellingen_algemeen(id, data) values (1, '{}'::jsonb);
      create table artikel_categorieen (
        id uuid primary key, code text not null unique, naam text not null,
        sorteervolgorde int not null default 0, actief boolean not null default true);
      create table artikel_eenheden (
        id uuid primary key, code text not null unique, naam text not null,
        sorteervolgorde int not null default 0, actief boolean not null default true);
      create table artikelen (
        id uuid primary key, naam text not null,
        categorie_id uuid not null references artikel_categorieen(id),
        eenheid_id uuid not null references artikel_eenheden(id),
        tariefsoort text not null, tarief numeric(14,4) null, actief boolean not null default true,
        version bigint not null default 1,
        check ((tariefsoort = 'vast' and tarief is not null) or (tariefsoort = 'zie_prijs' and tarief is null)));
      """);
    await cmd.ExecuteNonQueryAsync();
  }

  public async Task DisposeAsync()
  {
    await _dataSource.DisposeAsync();
    await _postgres.DisposeAsync();
  }

  [Fact]
  public async Task First_writer_wins_and_stale_writer_cannot_replace_it()
  {
    var repository = new CalculatieRepository(_dataSource);
    var created = await repository.CreateAsync("Utrecht", "writer-1", CancellationToken.None);
    var versionN = created.Version;
    var staleRead = await repository.GetAsync(created.Nummer, null, CancellationToken.None);
    Assert.NotNull(staleRead);

    var firstWrite = staleRead! with { Projectnaam = "Eerste wijziging", DataJson = "{\"writer\":\"eerste\"}" };
    var saved = await repository.UpsertAsync(firstWrite, firstWrite.Totals, [], versionN, null, "writer-1", CancellationToken.None);
    Assert.NotNull(saved);
    Assert.Equal(versionN + 1, saved!.Version);

    var secondWrite = staleRead with { Projectnaam = "Tweede wijziging", DataJson = "{\"writer\":\"tweede\"}" };
    var rejected = await repository.UpsertAsync(secondWrite, secondWrite.Totals, [], versionN, null, "writer-2", CancellationToken.None);
    Assert.Null(rejected);

    var persisted = await repository.GetAsync(created.Nummer, null, CancellationToken.None);
    Assert.NotNull(persisted);
    Assert.Equal("Eerste wijziging", persisted!.Projectnaam);
    using var persistedData = JsonDocument.Parse(persisted.DataJson);
    Assert.Equal("eerste", persistedData.RootElement.GetProperty("writer").GetString());
    Assert.Equal(versionN + 1, persisted.Version);
  }

  [Fact]
  public async Task Aggregate_write_rolls_back_calculation_and_article_rows_together()
  {
    var repository = new CalculatieRepository(_dataSource);
    var created = await repository.CreateAsync("Utrecht", "writer-1", CancellationToken.None);
    var original = await repository.GetAsync(created.Nummer, null, CancellationToken.None);
    Assert.NotNull(original);
    var originalArticle = new CalculationArticleSelection("old", "Bestaand", "Materiaal", 1, null, null, null, 2, 2);
    await repository.UpsertAsync(original! with { Projectnaam = "Voor" }, original!.Totals, [originalArticle], created.Version, null, "writer-1", CancellationToken.None);

    var current = await repository.GetAsync(created.Nummer, null, CancellationToken.None);
    Assert.NotNull(current);
    var overflowingArticle = new CalculationArticleSelection("new", "Nieuw", "Materiaal", 999999999999m, null, null, null, 2, 2);

    await Assert.ThrowsAsync<PostgresException>(() => repository.UpsertAsync(
      current! with { Projectnaam = "Na", DataJson = "{\"changed\":true}" },
      current!.Totals,
      [overflowingArticle],
      current.Version,
      null,
      "writer-2",
      CancellationToken.None));

    var persisted = await repository.GetAsync(created.Nummer, null, CancellationToken.None);
    Assert.NotNull(persisted);
    Assert.Equal("Voor", persisted!.Projectnaam);
    Assert.Equal(created.Version + 1, persisted.Version);
    await using var cmd = _dataSource.CreateCommand("select artikel_naam from calculatie_artikelen where calculatie_nummer = $1");
    cmd.Parameters.AddWithValue(created.Nummer);
    Assert.Equal("Bestaand", await cmd.ExecuteScalarAsync());
  }

  [Fact]
  public async Task Delete_with_stale_version_is_rejected_and_current_version_deletes()
  {
    var repository = new CalculatieRepository(_dataSource);
    var created = await repository.CreateAsync("Utrecht", "writer-1", CancellationToken.None);
    var loaded = await repository.GetAsync(created.Nummer, "Utrecht", CancellationToken.None);
    Assert.NotNull(loaded);

    var saved = await repository.UpsertAsync(
      loaded! with { Projectnaam = "Bewaard" },
      loaded!.Totals,
      [],
      created.Version,
      "Utrecht",
      "writer-1",
      CancellationToken.None);
    Assert.NotNull(saved);

    var staleDelete = await repository.SoftDeleteAsync(created.Nummer, created.Version, "Utrecht", "writer-2", CancellationToken.None);
    Assert.Null(staleDelete);
    var stillCurrent = await repository.GetAsync(created.Nummer, "Utrecht", CancellationToken.None);
    Assert.NotNull(stillCurrent);
    Assert.Equal("Bewaard", stillCurrent!.Projectnaam);

    var deletedVersion = await repository.SoftDeleteAsync(created.Nummer, saved!.Version, "Utrecht", "writer-1", CancellationToken.None);
    Assert.Equal(saved.Version + 1, deletedVersion);
    await using var cmd = _dataSource.CreateCommand("select is_deleted from calculaties where nummer = $1");
    cmd.Parameters.AddWithValue(created.Nummer);
    Assert.True((bool)(await cmd.ExecuteScalarAsync())!);
  }

  [Fact]
  public async Task Status_update_increments_version_and_rejects_a_stale_client()
  {
    var repository = new CalculatieRepository(_dataSource);
    var created = await repository.CreateAsync("Utrecht", "writer-1", CancellationToken.None);

    var first = await repository.SetStatusAsync(created.Nummer, "Verstuurd", created.Version, "Utrecht", "writer-1", CancellationToken.None);
    Assert.NotNull(first);
    Assert.Equal("Verstuurd", first!.Status);
    Assert.Equal(created.Version + 1, first.Version);

    var stale = await repository.SetStatusAsync(created.Nummer, "Opdracht", created.Version, "Utrecht", "writer-2", CancellationToken.None);
    Assert.Null(stale);
    var persisted = await repository.GetAsync(created.Nummer, "Utrecht", CancellationToken.None);
    Assert.NotNull(persisted);
    Assert.Equal("Verstuurd", persisted!.Status);
    Assert.Equal(created.Version + 1, persisted.Version);
  }

  [Fact]
  public async Task Settings_update_requires_the_version_and_rejects_a_stale_writer()
  {
    var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(_postgres.GetConnectionString()).Options;
    await using var context = new VsvkDbContext(options);
    var repository = new InstellingenRepository(_dataSource, context);
    using var firstDoc = JsonDocument.Parse("{\"medewerkers\":[\"eerste\"]}");
    using var staleDoc = JsonDocument.Parse("{\"medewerkers\":[\"tweede\"]}");

    var first = await repository.PutAsync(firstDoc.RootElement, 1, "writer-1", CancellationToken.None);
    Assert.NotNull(first);
    Assert.Equal(2, first!.Version);
    var stale = await repository.PutAsync(staleDoc.RootElement, 1, "writer-2", CancellationToken.None);
    Assert.Null(stale);

    await using var cmd = _dataSource.CreateCommand("select data::text, version from instellingen_algemeen where id = 1");
    await using var reader = await cmd.ExecuteReaderAsync();
    Assert.True(await reader.ReadAsync());
    Assert.Contains("eerste", reader.GetString(0));
    Assert.Equal(2, reader.GetInt64(1));
  }

  [Fact]
  public async Task Article_update_uses_the_clients_expected_version_even_after_a_newer_read()
  {
    var options = new DbContextOptionsBuilder<VsvkDbContext>().UseNpgsql(_postgres.GetConnectionString()).Options;
    var categoryId = Guid.NewGuid();
    var unitId = Guid.NewGuid();
    await using (var seedContext = new VsvkDbContext(options))
    {
      seedContext.ArtikelCategorieen.Add(new ArtikelCategorie { Id = categoryId, Code = "test", Naam = "Test" });
      seedContext.ArtikelEenheden.Add(new ArtikelEenheid { Id = unitId, Code = "stuk", Naam = "stuk" });
      await seedContext.SaveChangesAsync();
    }

    var createRequest = new ArtikelRequest { Naam = "Start", CategorieId = categoryId, EenheidId = unitId, TariefSoort = "vast", Tarief = 10, Actief = true };
    Guid articleId;
    await using (var createContext = new VsvkDbContext(options))
    {
      var created = await new ArtikelRepository(createContext).CreateAsync(createRequest, CancellationToken.None);
      articleId = created.Id;
      Assert.Equal(1, created.Version);
    }

    var firstRequest = createRequest with { Naam = "Eerste" };
    var staleRequest = createRequest with { Naam = "Tweede" };
    await using (var firstContext = new VsvkDbContext(options))
    {
      var first = await new ArtikelRepository(firstContext).UpdateAsync(articleId, firstRequest, 1, CancellationToken.None);
      Assert.NotNull(first);
      Assert.Equal(2, first!.Version);
    }
    await using (var staleContext = new VsvkDbContext(options))
    {
      var stale = await new ArtikelRepository(staleContext).UpdateAsync(articleId, staleRequest, 1, CancellationToken.None);
      Assert.Null(stale);
    }
    await using (var verifyContext = new VsvkDbContext(options))
    {
      var saved = await new ArtikelRepository(verifyContext).GetByIdAsync(articleId, true, CancellationToken.None);
      Assert.NotNull(saved);
      Assert.Equal("Eerste", saved!.Naam);
      Assert.Equal(2, saved.Version);
    }
    await using (var staleDeleteContext = new VsvkDbContext(options))
    {
      var staleDelete = await new ArtikelRepository(staleDeleteContext).DeactivateAsync(articleId, 1, CancellationToken.None);
      Assert.Null(staleDelete);
    }
    await using (var currentDeleteContext = new VsvkDbContext(options))
    {
      var deleted = await new ArtikelRepository(currentDeleteContext).DeactivateAsync(articleId, 2, CancellationToken.None);
      Assert.NotNull(deleted);
      Assert.False(deleted!.Actief);
      Assert.Equal(3, deleted.Version);
    }
  }
}
