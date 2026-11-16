using Microsoft.EntityFrameworkCore;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Db;

public sealed partial class PlanningRepository(VsvkDbContext context)
{
  public Task<List<PlanningCustomerListDto>> ListCustomersAsync(CancellationToken cancellationToken) =>
    context.Klanten.AsNoTracking().OrderBy(customer => customer.Bedrijfsnaam).ThenBy(customer => customer.Id)
      .Select(customer => new PlanningCustomerListDto(customer.Id, customer.Aan, customer.Debiteurnummer,
        customer.Bedrijfsnaam, customer.TelefoonAlgemeen, customer.Plaats,
        customer.Contactpersonen.Where(contact => contact.IsStandaardBesteller)
          .Select(contact => contact.Naam).FirstOrDefault()))
      .ToListAsync(cancellationToken);

  public Task<PlanningCustomerDetailDto?> GetCustomerAsync(int id, CancellationToken cancellationToken) =>
    context.Klanten.AsNoTracking().Where(customer => customer.Id == id)
      .Select(customer => new PlanningCustomerDetailDto(customer.Id, customer.Aan, customer.Debiteurnummer,
        customer.Bedrijfsnaam, customer.KvkNummer, customer.Website, customer.TelefoonAlgemeen,
        customer.EmailAlgemeen, customer.Straat, customer.Huisnummer, customer.Toevoeging,
        customer.Postcode, customer.Plaats, customer.Land, customer.Opmerkingen,
        customer.Contactpersonen.OrderByDescending(contact => contact.IsStandaardBesteller)
          .ThenBy(contact => contact.Naam).ThenBy(contact => contact.Id)
          .Select(contact => new PlanningCustomerContactDto(contact.Id, contact.Naam, contact.Functie,
            contact.Telefoon, contact.Email, contact.IsStandaardBesteller)).ToList(),
        new PlanningCustomerBillingDto(customer.BtwNummer, customer.Iban, customer.FactuurEmail, customer.AfwijkendFactuuradres,
          customer.VasteReferentie, customer.GRekeningPercentage, customer.FacturerenPer,
          customer.BtwVerlegd, customer.MandagenregisterMeesturen), customer.Version))
      .FirstOrDefaultAsync(cancellationToken);

  private IQueryable<UserInformation> Employees(string? branch)
  {
    var query = context.UserInformation.AsNoTracking();
    if (branch is null) return query;
    var branchId = Guid.TryParse(branch, out var parsed) ? parsed : Guid.Empty;
    return query.Where(employee => employee.VestigingId == branchId
      || (employee.VestigingId != null && context.Vestigingen
        .Where(vestiging => vestiging.Naam == branch)
        .Select(vestiging => vestiging.Id).Contains(employee.VestigingId.Value)));
  }

  private static IQueryable<PlanningEmployeeDto> ProjectEmployees(IQueryable<UserInformation> query) =>
    query.Select(employee => new PlanningEmployeeDto(
      employee.KeycloakSubject, employee.EmployeeNumber, employee.DisplayName, employee.JobTitle,
      employee.PhoneNumber, employee.EmailAddress, employee.Vestiging != null ? employee.Vestiging.Naam : null,
      employee.IsActive, employee.Version, employee.Skills.OrderBy(skill => skill.Skill.Name)
        .Select(skill => new PlanningSkillDto(skill.Skill.Name, skill.DiplomaOn, skill.ValidUntil)).ToList()));

  public Task<List<PlanningEmployeeDto>> ListEmployeesAsync(string? branch, CancellationToken cancellationToken) =>
    ProjectEmployees(Employees(branch).OrderBy(employee => employee.DisplayName)).ToListAsync(cancellationToken);

  public Task<PlanningEmployeeDto?> GetEmployeeAsync(Guid id, string? branch, CancellationToken cancellationToken) =>
    ProjectEmployees(Employees(branch).Where(employee => employee.KeycloakSubject == id)).FirstOrDefaultAsync(cancellationToken);

  public async Task<PlanningEmployeeDto?> SetEmployeeActiveAsync(Guid id, bool active, long version, string? branch, CancellationToken cancellationToken)
  {
    await using var transaction = await context.Database.BeginTransactionAsync(cancellationToken);
    var count = await Employees(branch).Where(employee => employee.KeycloakSubject == id && employee.Version == version)
      .ExecuteUpdateAsync(setters => setters
        .SetProperty(employee => employee.IsActive, active)
        .SetProperty(employee => employee.Version, employee => employee.Version + 1)
        .SetProperty(employee => employee.UpdatedAt, DateTimeOffset.UtcNow), cancellationToken);
    if (count == 0) return null;
    var employee = await GetEmployeeAsync(id, branch, cancellationToken);
    await transaction.CommitAsync(cancellationToken);
    return employee;
  }

  public Task<List<PlanningMaterieelDto>> ListEquipmentAsync(string? branch, CancellationToken cancellationToken)
  {
    var query = context.MaterieelItems.AsNoTracking();
    if (branch is not null)
    {
      var branchId = Guid.TryParse(branch, out var parsed) ? parsed : Guid.Empty;
      query = query.Where(item => item.StandplaatsId == branchId
        || (item.Standplaats != null && item.Standplaats.Naam == branch));
    }
    return query.OrderBy(item => item.Omschrijving)
      .Select(item => new PlanningMaterieelDto(item.Id, item.Omschrijving, item.Kenteken,
        item.Merk, item.Zoeknaam, item.Serienummer, item.Standplaats != null ? item.Standplaats.Naam : null,
        item.MaterieelGroep != null ? item.MaterieelGroep.Omschrijving : null, item.Version))
      .ToListAsync(cancellationToken);
  }
}
