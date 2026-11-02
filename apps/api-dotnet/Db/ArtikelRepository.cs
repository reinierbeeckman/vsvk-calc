using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Vsvk.Api.Auth;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed class ArtikelRepository(VsvkDbContext context)
{
  public async Task<IReadOnlyList<ArtikelCategorieDto>> ListCategorieenAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
  {
    var query = context.ArtikelCategorieen.AsNoTracking();
    if (!user.IsInRole(VsvkRoles.Directie))
    {
      query = query.Where(categorie => categorie.Actief);
    }

    return await query
      .OrderBy(categorie => categorie.Sorteervolgorde)
      .ThenBy(categorie => categorie.Naam)
      .Select(categorie => new ArtikelCategorieDto(categorie.Id, categorie.Code, categorie.Naam, categorie.Sorteervolgorde, categorie.Actief))
      .ToListAsync(cancellationToken);
  }

  public async Task<IReadOnlyList<ArtikelEenheidDto>> ListEenhedenAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
  {
    var query = context.ArtikelEenheden.AsNoTracking();
    if (!user.IsInRole(VsvkRoles.Directie))
    {
      query = query.Where(eenheid => eenheid.Actief);
    }

    return await query
      .OrderBy(eenheid => eenheid.Sorteervolgorde)
      .ThenBy(eenheid => eenheid.Naam)
      .Select(eenheid => new ArtikelEenheidDto(eenheid.Id, eenheid.Code, eenheid.Naam, eenheid.Sorteervolgorde, eenheid.Actief))
      .ToListAsync(cancellationToken);
  }

  public Task<List<ArtikelDto>> ListAsync(ClaimsPrincipal user, CancellationToken cancellationToken)
  {
    var query = context.Artikelen.AsNoTracking();
    if (!user.IsInRole(VsvkRoles.Directie))
    {
      query = query.Where(artikel => artikel.Actief);
    }

    return query
      .OrderBy(artikel => artikel.Categorie.Sorteervolgorde)
      .ThenBy(artikel => artikel.Naam)
      .Select(ArtikelProjections.Response)
      .ToListAsync(cancellationToken);
  }

  public Task<List<ArtikelDto>> AutocompleteAsync(string query, int limit, CancellationToken cancellationToken)
  {
    var search = query.Trim();
    var articles = context.Artikelen
      .AsNoTracking()
      .Where(artikel => artikel.Actief);

    if (search.Length > 0)
    {
      var pattern = $"%{search}%";
      articles = articles.Where(artikel =>
        EF.Functions.ILike(artikel.Naam, pattern)
        || EF.Functions.ILike(artikel.Categorie.Naam, pattern)
        || EF.Functions.ILike(artikel.Eenheid.Naam, pattern));
    }

    return articles
      .OrderBy(artikel => artikel.Naam.StartsWith(search) ? 0 : 1)
      .ThenBy(artikel => artikel.Categorie.Sorteervolgorde)
      .ThenBy(artikel => artikel.Naam)
      .Select(ArtikelProjections.Response)
      .Take(Math.Clamp(limit, 1, 50))
      .ToListAsync(cancellationToken);
  }

  public async Task<IReadOnlyDictionary<string, (string? Category, decimal? Tariff)>> GetSnapshotsByNameAsync(
    IReadOnlyCollection<string> names,
    CancellationToken cancellationToken)
  {
    if (names.Count == 0)
    {
      return new Dictionary<string, (string?, decimal?)>(StringComparer.OrdinalIgnoreCase);
    }

    var snapshots = await context.Artikelen
      .AsNoTracking()
      .Where(artikel => names.Contains(artikel.Naam))
      .Select(artikel => new { artikel.Naam, Category = artikel.Categorie.Naam, artikel.Tarief })
      .ToListAsync(cancellationToken);

    return snapshots.ToDictionary(
      artikel => artikel.Naam,
      artikel => ((string?)artikel.Category, artikel.Tarief),
      StringComparer.OrdinalIgnoreCase);
  }

  public Task<ArtikelDto?> GetByIdAsync(Guid id, bool includeInactive, CancellationToken cancellationToken)
  {
    var query = context.Artikelen.AsNoTracking().Where(artikel => artikel.Id == id);
    if (!includeInactive)
    {
      query = query.Where(artikel => artikel.Actief);
    }

    return query.Select(ArtikelProjections.Response).FirstOrDefaultAsync(cancellationToken);
  }

  public async Task<bool> LookupIdsExistAsync(Guid categorieId, Guid eenheidId, CancellationToken cancellationToken) =>
    await context.ArtikelCategorieen.AnyAsync(categorie => categorie.Id == categorieId && categorie.Actief, cancellationToken)
    && await context.ArtikelEenheden.AnyAsync(eenheid => eenheid.Id == eenheidId && eenheid.Actief, cancellationToken);

  public async Task<ArtikelDto> CreateAsync(ArtikelRequest request, CancellationToken cancellationToken)
  {
    var artikel = new Artikel
    {
      Id = Guid.NewGuid(),
      Naam = request.Naam.Trim(),
      CategorieId = request.CategorieId,
      EenheidId = request.EenheidId,
      TariefSoort = request.TariefSoort,
      Tarief = request.Tarief,
      Actief = request.Actief
    };

    context.Artikelen.Add(artikel);
    await context.SaveChangesAsync(cancellationToken);
    return (await GetByIdAsync(artikel.Id, includeInactive: true, cancellationToken))!;
  }

  public async Task<ArtikelDto?> UpdateAsync(Guid id, ArtikelRequest request, long expectedVersion, CancellationToken cancellationToken)
  {
    var artikel = await context.Artikelen.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
    if (artikel is null)
    {
      return null;
    }

    artikel.Naam = request.Naam.Trim();
    artikel.CategorieId = request.CategorieId;
    artikel.EenheidId = request.EenheidId;
    artikel.TariefSoort = request.TariefSoort;
    artikel.Tarief = request.Tarief;
    artikel.Actief = request.Actief;
    context.Entry(artikel).Property(item => item.Version).OriginalValue = expectedVersion;
    artikel.Version++;

    try
    {
      await context.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateConcurrencyException)
    {
      return null;
    }

    return await GetByIdAsync(id, includeInactive: true, cancellationToken);
  }

  public async Task<ArtikelDto?> DeactivateAsync(Guid id, long expectedVersion, CancellationToken cancellationToken)
  {
    var artikel = await context.Artikelen.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
    if (artikel is null)
    {
      return null;
    }

    artikel.Actief = false;
    context.Entry(artikel).Property(item => item.Version).OriginalValue = expectedVersion;
    artikel.Version++;
    try
    {
      await context.SaveChangesAsync(cancellationToken);
    }
    catch (DbUpdateConcurrencyException)
    {
      return null;
    }

    return await GetByIdAsync(id, includeInactive: true, cancellationToken);
  }

  public static bool IsUniqueViolation(Exception exception) =>
    exception is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } };
}
