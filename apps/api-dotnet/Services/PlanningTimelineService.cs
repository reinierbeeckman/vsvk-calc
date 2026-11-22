using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Vsvk.Api.Db;
using Vsvk.Api.DTOs;

namespace Vsvk.Api.Services;

public sealed class PlanningTimelineService(VsvkDbContext context)
{
  private static readonly CultureInfo Dutch = CultureInfo.GetCultureInfo("nl-NL");

  public async Task<TimelineViewModel> GetAsync(
    DateOnly from, DateOnly to, string zoom, Guid? branchId, CancellationToken cancellationToken)
  {
    var today = DateOnly.FromDateTime(DateTime.Today);
    var workOrders = await context.Werkopdrachten.AsNoTracking()
      .Where(order => !order.Geannuleerd && !order.Voorraad)
      .Where(order => order.StartDatum <= to && order.EindDatum >= from)
      .Where(order => branchId == null || order.VestigingId == branchId)
      .OrderBy(order => order.StartDatum).ThenBy(order => order.Nummer)
      .Select(order => new
      {
        order.Id, order.Nummer, Customer = order.Klant.Bedrijfsnaam, order.Omschrijving,
        order.StartDatum, order.EindDatum, order.IsOptie, order.OptieTot, order.Kleur,
        Jobs = order.Klussen.Where(job => job.Datum.HasValue)
          .OrderBy(job => job.Datum).ThenBy(job => job.Sorteervolgorde).ThenBy(job => job.Id)
          .Select(job => new
          {
            job.Id, job.StartDatum, job.EindDatum, job.BenodigdeMedewerkers,
            job.StartTijd, job.EindTijd,
            Requirements = job.Behoeften.Where(need => need.Soort == "mens").Sum(need => need.Aantal),
            Assignments = job.Inzetten.Where(assignment => assignment.Datum >= from && assignment.Datum <= to)
              .OrderBy(assignment => assignment.Datum)
              .Select(assignment => new
              {
                assignment.Id, assignment.Datum, assignment.MedewerkerId, assignment.InhuurmedewerkerId,
                EmployeeName = assignment.Medewerker != null ? assignment.Medewerker.DisplayName : null,
                EmployeeJob = assignment.Medewerker != null ? assignment.Medewerker.JobTitle : null,
                SubcontractorName = assignment.Inhuurmedewerker != null ? assignment.Inhuurmedewerker.Naam : null,
                SubcontractorJob = assignment.Inhuurmedewerker != null ? assignment.Inhuurmedewerker.Functie : null,
                assignment.StartTijd, assignment.EindTijd,
                WorkSlip = assignment.Werkbon != null ? new
                {
                  assignment.Werkbon.Id, assignment.Werkbon.Nummer, assignment.Werkbon.OudNummer,
                  assignment.Werkbon.Status, assignment.Werkbon.GewijzigdNaUitgifte
                } : null
              }).ToList()
          }).ToList()
      }).ToListAsync(cancellationToken);

    var days = Days(from, to).Select(date => new TimelineDayDto(
      date, date.ToString("ddd", Dutch).TrimEnd('.'), date.Day,
      date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday, date == today)).ToList();
    var timelineOrders = new List<TimelineWorkOrderDto>();

    foreach (var order in workOrders)
    {
      if (order.IsOptie && order.OptieTot is { } optionUntil && optionUntil < from) continue;
      var dayCells = new Dictionary<DateOnly, TimelineDayCellDto>();
      var people = new Dictionary<Guid, (string Name, string? Job, bool External, Dictionary<DateOnly, TimelinePersonDayDto?> Days)>();
      var openPlaces = 0;
      var slipsTodo = 0;
      var slipCount = 0;
      var slipsInside = 0;

      foreach (var date in Days(from, to).Where(date =>
        date.DayOfWeek is not DayOfWeek.Saturday and not DayOfWeek.Sunday &&
        date >= order.StartDatum && date <= order.EindDatum))
      {
        var dayJobs = order.Jobs.Where(job => job.StartDatum <= date && job.EindDatum >= date).ToList();
        var assignments = dayJobs.SelectMany(job => job.Assignments.Where(item => item.Datum == date)
          .Select(item => (JobId: job.Id, Assignment: item))).ToList();
        var jobIds = dayJobs.Select(job => job.Id).ToList();
        var required = dayJobs.Sum(job => job.Requirements > 0 ? job.Requirements : job.BenodigdeMedewerkers);
        var occupied = Math.Min(required, assignments.Count);
        var open = Math.Max(0, required - occupied);
        if (date >= today) openPlaces += open;

        var todo = 0;
        foreach (var item in assignments)
        {
          var assignment = item.Assignment;
          var personId = assignment.MedewerkerId ?? assignment.InhuurmedewerkerId!.Value;
          var external = assignment.InhuurmedewerkerId.HasValue;
          var name = external ? assignment.SubcontractorName! : assignment.EmployeeName ?? "Onbekende medewerker";
          var job = external ? assignment.SubcontractorJob : assignment.EmployeeJob;
          if (!people.TryGetValue(personId, out var person))
          {
            person = (name, job, external, new Dictionary<DateOnly, TimelinePersonDayDto?>());
            people.Add(personId, person);
          }
          var bon = assignment.WorkSlip?.Status == "vervallen" ? null : assignment.WorkSlip;
          if (bon is not null)
          {
            slipCount++;
            if (bon.Status is "retour" or "verwerkt" or "binnen") slipsInside++;
          }
          var personStatus = BonStatus(date, today, bon is null ? null : bon.Status, bon?.GewijzigdNaUitgifte == true);
          if (date <= today && (bon is null || bon.Status == "aangemaakt" || bon.GewijzigdNaUitgifte))
            todo++;
          person.Days[date] = new TimelinePersonDayDto(
            personStatus, bon?.Id, bon?.Nummer, bon?.OudNummer, item.JobId);
        }
        slipsTodo += todo;
        var occupancy = required == 0 ? "geenBehoefte" : occupied >= required ? "vol" : occupied == 0 ? "leeg" : "deels";
        var summary = occupied == 0 ? "niemand"
          : date > today ? "gepland"
          : todo > 0 ? "teDoen"
          : assignments.All(item => item.Assignment.WorkSlip?.Status is "retour" or "verwerkt" or "binnen")
            ? "binnen"
            : "uit";
        var first = dayJobs.FirstOrDefault();
        dayCells[date] = new TimelineDayCellDto(
          jobIds, required, occupied, open, occupancy, todo, summary,
          first?.StartTijd?.ToString("HH:mm") ?? "", first?.EindTijd);
      }

      var totalRequired = dayCells.Values.Sum(day => day.Nodig);
      var totalOccupied = dayCells.Values.Sum(day => day.Bezet);
      openPlaces = Math.Max(0, totalRequired - totalOccupied);
      var completed = dayCells.Count > 0 && dayCells.Keys.All(date => date < today) &&
        totalRequired > 0 && openPlaces == 0 &&
        slipCount > 0 && slipsInside == slipCount;
      var orderStatus = order.IsOptie ? "OPTIE"
        : completed ? "AFGEROND"
        : totalRequired > 0 && openPlaces == 0 ? "GEPLAND"
        : totalOccupied == 0 ? "NIET INGEPLAND"
        : "OPEN " + openPlaces;
      var group = openPlaces > 0 || slipsTodo > 0 ? "aandacht" : completed ? "afgerond" : "schema";
      timelineOrders.Add(new TimelineWorkOrderDto(
        order.Id, order.Nummer, order.Customer, order.Omschrijving, order.StartDatum, order.EindDatum, order.Kleur,
        order.IsOptie && (order.OptieTot is null || order.OptieTot >= today),
        openPlaces, slipsTodo, group, dayCells,
        people.OrderBy(item => item.Value.External).ThenBy(item => item.Value.Name, StringComparer.Create(Dutch, false))
          .Select(item => new TimelinePersonDto(item.Key, item.Value.Name, item.Value.Job,
            item.Value.External, item.Value.Days)).ToList(),
        orderStatus, slipCount, slipsInside));
    }

    var grouped = new[] { ("aandacht", "Aandacht nodig"), ("schema", "Op schema"), ("afgerond", "Afgerond") }
      .Select(group => new TimelineGroupDto(
        group.Item1, group.Item2, timelineOrders.Where(order => order.Groep == group.Item1).ToList()))
      .Where(group => group.Werkopdrachten.Count > 0).ToList();
    return new TimelineViewModel(
      new TimelinePeriodDto(from, to, today, zoom, PeriodTitle(from, to, zoom, today)),
      days, grouped, new TimelineTotalDto(timelineOrders.Count));
  }

  private static IEnumerable<DateOnly> Days(DateOnly from, DateOnly to)
  {
    for (var date = from; date <= to; date = date.AddDays(1)) yield return date;
  }

  private static string BonStatus(DateOnly date, DateOnly today, string? status, bool changed) =>
    status is "retour" or "verwerkt" or "binnen" ? "BINNEN"
      : status == "uitgereikt" && changed ? "GEWIJZIGD"
      : status == "uitgereikt" ? "UITGEREIKT"
      : status is "aangemaakt" or "niet_geprint" ? "NIET_GEPRINT"
      : date <= today ? "GEEN_BON"
      : "GEPLAND";

  private static string PeriodTitle(DateOnly from, DateOnly to, string zoom, DateOnly today)
  {
    var date = from.ToDateTime(TimeOnly.MinValue);
    return zoom switch
    {
      "dag" => $"Wk {ISOWeek.GetWeekOfYear(date)} · {date:dddd d MMMM}",
      "maand" => date.ToString("MMMM yyyy", Dutch),
      _ => $"Wk {ISOWeek.GetWeekOfYear(date)} · {from.Day} – {to.Day} {to:MMMM}"
    };
  }
}
