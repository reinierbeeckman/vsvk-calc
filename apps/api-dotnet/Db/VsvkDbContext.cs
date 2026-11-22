using Microsoft.EntityFrameworkCore;

namespace Vsvk.Api.Db;

public sealed class VsvkDbContext : DbContext
{
  public VsvkDbContext(DbContextOptions<VsvkDbContext> options) : base(options)
  {
  }

  public DbSet<Vestiging> Vestigingen => Set<Vestiging>();
  public DbSet<InstellingenAlgemeen> InstellingenAlgemeen => Set<InstellingenAlgemeen>();
  public DbSet<ArtikelCategorie> ArtikelCategorieen => Set<ArtikelCategorie>();
  public DbSet<ArtikelEenheid> ArtikelEenheden => Set<ArtikelEenheid>();
  public DbSet<Artikel> Artikelen => Set<Artikel>();
  public DbSet<UserInformation> UserInformation => Set<UserInformation>();
  public DbSet<UserSkill> Skills => Set<UserSkill>();
  public DbSet<Materieel> MaterieelItems => Set<Materieel>();
  public DbSet<MaterieelGroep> MaterieelGroepen => Set<MaterieelGroep>();
  public DbSet<Klant> Klanten => Set<Klant>();
  public DbSet<KlantContactpersoon> KlantContactpersonen => Set<KlantContactpersoon>();
  public DbSet<Leverancier> Leveranciers => Set<Leverancier>();
  public DbSet<PlanningFunctie> PlanningFuncties => Set<PlanningFunctie>();
  public DbSet<PlanningStandaardTarief> PlanningStandaardTarieven => Set<PlanningStandaardTarief>();
  public DbSet<PlanningKlantTarief> PlanningKlantTarieven => Set<PlanningKlantTarief>();
  public DbSet<Werkopdracht> Werkopdrachten => Set<Werkopdracht>();
  public DbSet<Klus> Klussen => Set<Klus>();
  public DbSet<KlusBehoefte> KlusBehoeften => Set<KlusBehoefte>();
  public DbSet<WerkopdrachtOrdernummer> WerkopdrachtOrdernummers => Set<WerkopdrachtOrdernummer>();
  public DbSet<WerkopdrachtVrijeDag> WerkopdrachtVrijeDagen => Set<WerkopdrachtVrijeDag>();
  public DbSet<WerkopdrachtMateriaal> WerkopdrachtMaterialen => Set<WerkopdrachtMateriaal>();
  public DbSet<Inhuurmedewerker> Inhuurmedewerkers => Set<Inhuurmedewerker>();
  public DbSet<Inzet> Inzetten => Set<Inzet>();
  public DbSet<MaterieelInzet> MaterieelInzetten => Set<MaterieelInzet>();
  public DbSet<Werkbon> Werkbonnen => Set<Werkbon>();

  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
    var workOrder = modelBuilder.Entity<Werkopdracht>();
    workOrder.ToTable("werkopdrachten");
    workOrder.HasKey(item => item.Id);
    workOrder.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    workOrder.Property(item => item.Nummer).HasColumnName("nummer").HasMaxLength(50).IsRequired();
    workOrder.Property(item => item.KlantId).HasColumnName("klant_id");
    workOrder.Property(item => item.Omschrijving).HasColumnName("omschrijving").HasMaxLength(500).IsRequired();
    workOrder.Property(item => item.StartDatum).HasColumnName("start_datum").HasColumnType("date");
    workOrder.Property(item => item.EindDatum).HasColumnName("eind_datum").HasColumnType("date");
    workOrder.Property(item => item.IsOptie).HasColumnName("is_optie");
    workOrder.Property(item => item.OptieTot).HasColumnName("optie_tot").HasColumnType("date");
    workOrder.Property(item => item.Kleur).HasColumnName("kleur").HasMaxLength(20);
    workOrder.Property(item => item.VestigingId).HasColumnName("vestiging_id");
    workOrder.Property(item => item.Geannuleerd).HasColumnName("geannuleerd");
    workOrder.Property(item => item.Voorraad).HasColumnName("voorraad");
    workOrder.Property(item => item.Soort).HasColumnName("soort");
    workOrder.Property(item => item.InternProjectnummer).HasColumnName("intern_projectnummer");
    workOrder.Property(item => item.BestellerId).HasColumnName("besteller_id");
    workOrder.Property(item => item.BestellerNaam).HasColumnName("besteller_naam");
    workOrder.Property(item => item.BestellerTelefoon).HasColumnName("besteller_telefoon");
    workOrder.Property(item => item.BestellerEmail).HasColumnName("besteller_email");
    workOrder.Property(item => item.OptieReden).HasColumnName("optie_reden");
    workOrder.Property(item => item.WeekendOverslaan).HasColumnName("weekend_overslaan");
    workOrder.Property(item => item.GeschatteUren).HasColumnName("geschatte_uren");
    workOrder.Property(item => item.UiterlijkKlaar).HasColumnName("uiterlijk_klaar").HasColumnType("date");
    workOrder.Property(item => item.Prioriteit).HasColumnName("prioriteit");
    workOrder.Property(item => item.KorteWerkomschrijving).HasColumnName("korte_werkomschrijving");
    workOrder.Property(item => item.WerkInhoud).HasColumnName("werk_inhoud");
    workOrder.Property(item => item.Instructies).HasColumnName("instructies");
    workOrder.Property(item => item.Werkadres).HasColumnName("werkadres");
    workOrder.Property(item => item.WerkPostcode).HasColumnName("werk_postcode");
    workOrder.Property(item => item.WerkPlaats).HasColumnName("werk_plaats");
    workOrder.Property(item => item.GpsLocatie).HasColumnName("gps_locatie");
    workOrder.Property(item => item.ContactLocatieNaam).HasColumnName("contact_locatie_naam");
    workOrder.Property(item => item.ContactLocatieTelefoon).HasColumnName("contact_locatie_telefoon");
    workOrder.Property(item => item.StartOpLocatie).HasColumnName("start_op_locatie");
    workOrder.Property(item => item.EindOpLocatie).HasColumnName("eind_op_locatie");
    workOrder.Property(item => item.PauzeMinuten).HasColumnName("pauze_minuten");
    workOrder.Property(item => item.MeerdereDiensten).HasColumnName("meerdere_diensten");
    workOrder.Property(item => item.Version).HasColumnName("version").IsConcurrencyToken();
    workOrder.HasIndex(item => item.Nummer).IsUnique();
    workOrder.HasIndex(item => new { item.StartDatum, item.EindDatum });
    workOrder.HasOne(item => item.Klant).WithMany().HasForeignKey(item => item.KlantId).OnDelete(DeleteBehavior.Restrict);
    workOrder.HasOne(item => item.Vestiging).WithMany().HasForeignKey(item => item.VestigingId).OnDelete(DeleteBehavior.Restrict);
    workOrder.HasOne(item => item.Besteller).WithMany().HasForeignKey(item => item.BestellerId).OnDelete(DeleteBehavior.SetNull);

    var job = modelBuilder.Entity<Klus>();
    job.ToTable("klussen");
    job.HasKey(item => item.Id);
    job.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    job.Property(item => item.WerkopdrachtId).HasColumnName("werkopdracht_id");
    job.Property(item => item.Omschrijving).HasColumnName("omschrijving").HasMaxLength(500).IsRequired();
    job.Property(item => item.StartDatum).HasColumnName("start_datum").HasColumnType("date");
    job.Property(item => item.EindDatum).HasColumnName("eind_datum").HasColumnType("date");
    job.Property(item => item.BenodigdeMedewerkers).HasColumnName("benodigde_medewerkers");
    job.Property(item => item.StartTijd).HasColumnName("start_tijd");
    job.Property(item => item.EindTijd).HasColumnName("eind_tijd");
    job.Property(item => item.Sorteervolgorde).HasColumnName("sorteervolgorde");
    job.Property(item => item.Datum).HasColumnName("datum").HasColumnType("date");
    job.Property(item => item.ReisHeen).HasColumnName("reis_heen");
    job.Property(item => item.ReisTerug).HasColumnName("reis_terug");
    job.Property(item => item.PauzeMinuten).HasColumnName("pauze_minuten");
    job.Property(item => item.DienstNaam).HasColumnName("dienst_naam");
    job.HasIndex(item => new { item.WerkopdrachtId, item.Sorteervolgorde });
    job.HasOne(item => item.Werkopdracht).WithMany(item => item.Klussen).HasForeignKey(item => item.WerkopdrachtId).OnDelete(DeleteBehavior.Cascade);

    var jobNeed = modelBuilder.Entity<KlusBehoefte>();
    jobNeed.ToTable("klus_behoeften");
    jobNeed.HasKey(item => item.Id);
    jobNeed.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    jobNeed.Property(item => item.KlusId).HasColumnName("klus_id");
    jobNeed.Property(item => item.Aantal).HasColumnName("aantal");
    jobNeed.Property(item => item.Rol).HasColumnName("rol").HasMaxLength(200);
    jobNeed.Property(item => item.Skill).HasColumnName("skill").HasMaxLength(200);
    jobNeed.Property(item => item.Soort).HasColumnName("soort").HasMaxLength(20);
    jobNeed.Property(item => item.MaterieelId).HasColumnName("materieel_id");
    jobNeed.Property(item => item.MaterieelGroepId).HasColumnName("materieelgroep_id");
    jobNeed.Property(item => item.LosseVerhuur).HasColumnName("losse_verhuur");
    jobNeed.HasIndex(item => item.KlusId);
    jobNeed.HasOne(item => item.Klus).WithMany(item => item.Behoeften)
      .HasForeignKey(item => item.KlusId).OnDelete(DeleteBehavior.Cascade);
    jobNeed.HasOne(item => item.Materieel).WithMany().HasForeignKey(item => item.MaterieelId).OnDelete(DeleteBehavior.Restrict);
    jobNeed.HasOne(item => item.MaterieelGroep).WithMany().HasForeignKey(item => item.MaterieelGroepId).OnDelete(DeleteBehavior.Restrict);

    var orderNumber = modelBuilder.Entity<WerkopdrachtOrdernummer>();
    orderNumber.ToTable("werkopdracht_ordernummers");
    orderNumber.HasKey(item => item.Id);
    orderNumber.Property(item => item.Id).HasColumnName("id");
    orderNumber.Property(item => item.WerkopdrachtId).HasColumnName("werkopdracht_id");
    orderNumber.Property(item => item.Nummer).HasColumnName("nummer").HasMaxLength(100).IsRequired();
    orderNumber.Property(item => item.Sorteervolgorde).HasColumnName("sorteervolgorde");
    orderNumber.HasOne(item => item.Werkopdracht).WithMany(item => item.Ordernummers)
      .HasForeignKey(item => item.WerkopdrachtId).OnDelete(DeleteBehavior.Cascade);

    var skippedDay = modelBuilder.Entity<WerkopdrachtVrijeDag>();
    skippedDay.ToTable("werkopdracht_vrije_dagen");
    skippedDay.HasKey(item => new { item.WerkopdrachtId, item.Datum });
    skippedDay.Property(item => item.WerkopdrachtId).HasColumnName("werkopdracht_id");
    skippedDay.Property(item => item.Datum).HasColumnName("datum").HasColumnType("date");
    skippedDay.HasOne(item => item.Werkopdracht).WithMany(item => item.VrijeDagen)
      .HasForeignKey(item => item.WerkopdrachtId).OnDelete(DeleteBehavior.Cascade);

    var materials = modelBuilder.Entity<WerkopdrachtMateriaal>();
    materials.ToTable("werkopdracht_materialen");
    materials.HasKey(item => item.Id);
    materials.Property(item => item.Id).HasColumnName("id");
    materials.Property(item => item.WerkopdrachtId).HasColumnName("werkopdracht_id");
    materials.Property(item => item.Aantal).HasColumnName("aantal").HasPrecision(12, 2);
    materials.Property(item => item.ArtikelId).HasColumnName("artikel_id");
    materials.Property(item => item.Omschrijving).HasColumnName("omschrijving").HasMaxLength(500);
    materials.Property(item => item.Eenheid).HasColumnName("eenheid").HasMaxLength(50);
    materials.HasOne(item => item.Werkopdracht).WithMany(item => item.Materialen)
      .HasForeignKey(item => item.WerkopdrachtId).OnDelete(DeleteBehavior.Cascade);
    materials.HasOne(item => item.Artikel).WithMany().HasForeignKey(item => item.ArtikelId).OnDelete(DeleteBehavior.Restrict);

    var subcontractor = modelBuilder.Entity<Inhuurmedewerker>();
    subcontractor.ToTable("inhuurmedewerkers");
    subcontractor.HasKey(item => item.Id);
    subcontractor.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    subcontractor.Property(item => item.LeverancierId).HasColumnName("leverancier_id");
    subcontractor.Property(item => item.Naam).HasColumnName("naam").HasMaxLength(255).IsRequired();
    subcontractor.Property(item => item.Functie).HasColumnName("functie").HasMaxLength(200);
    subcontractor.Property(item => item.Telefoon).HasColumnName("telefoon").HasMaxLength(50);
    subcontractor.Property(item => item.Email).HasColumnName("email").HasMaxLength(255);
    subcontractor.Property(item => item.Actief).HasColumnName("actief");
    subcontractor.Property(item => item.Version).HasColumnName("version").IsConcurrencyToken();
    subcontractor.HasIndex(item => new { item.LeverancierId, item.Naam });
    subcontractor.HasOne(item => item.Leverancier).WithMany().HasForeignKey(item => item.LeverancierId).OnDelete(DeleteBehavior.Restrict);

    var assignment = modelBuilder.Entity<Inzet>();
    assignment.ToTable("inzet");
    assignment.HasKey(item => item.Id);
    assignment.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    assignment.Property(item => item.KlusId).HasColumnName("klus_id");
    assignment.Property(item => item.Datum).HasColumnName("datum").HasColumnType("date");
    assignment.Property(item => item.MedewerkerId).HasColumnName("medewerker_id");
    assignment.Property(item => item.InhuurmedewerkerId).HasColumnName("inhuurmedewerker_id");
    assignment.Property(item => item.StartTijd).HasColumnName("start_tijd");
    assignment.Property(item => item.EindTijd).HasColumnName("eind_tijd");
    assignment.HasIndex(item => new { item.KlusId, item.Datum });
    assignment.HasIndex(item => new { item.MedewerkerId, item.Datum });
    assignment.HasIndex(item => new { item.InhuurmedewerkerId, item.Datum });
    assignment.HasOne(item => item.Klus).WithMany(item => item.Inzetten).HasForeignKey(item => item.KlusId).OnDelete(DeleteBehavior.Cascade);
    assignment.HasOne(item => item.Medewerker).WithMany().HasForeignKey(item => item.MedewerkerId).OnDelete(DeleteBehavior.Restrict);
    assignment.HasOne(item => item.Inhuurmedewerker).WithMany().HasForeignKey(item => item.InhuurmedewerkerId).OnDelete(DeleteBehavior.Restrict);

    var materialAssignment = modelBuilder.Entity<MaterieelInzet>();
    materialAssignment.ToTable("klus_materieelinzet");
    materialAssignment.HasKey(item => item.Id);
    materialAssignment.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    materialAssignment.Property(item => item.KlusId).HasColumnName("klus_id");
    materialAssignment.Property(item => item.Datum).HasColumnName("datum").HasColumnType("date");
    materialAssignment.Property(item => item.MaterieelId).HasColumnName("materieel_id");
    materialAssignment.HasIndex(item => new { item.KlusId, item.Datum, item.MaterieelId }).IsUnique();
    materialAssignment.HasOne(item => item.Klus).WithMany(item => item.MaterieelInzetten)
      .HasForeignKey(item => item.KlusId).OnDelete(DeleteBehavior.Cascade);
    materialAssignment.HasOne(item => item.Materieel).WithMany()
      .HasForeignKey(item => item.MaterieelId).OnDelete(DeleteBehavior.Restrict);

    var workSlip = modelBuilder.Entity<Werkbon>();
    workSlip.ToTable("werkbonnen");
    workSlip.HasKey(item => item.Id);
    workSlip.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    workSlip.Property(item => item.InzetId).HasColumnName("inzet_id");
    workSlip.Property(item => item.Nummer).HasColumnName("nummer").HasMaxLength(50).IsRequired();
    workSlip.Property(item => item.OudNummer).HasColumnName("oud_nummer").HasMaxLength(50);
    workSlip.Property(item => item.Status).HasColumnName("status").HasMaxLength(30).IsRequired();
    workSlip.Property(item => item.GewijzigdNaUitgifte).HasColumnName("gewijzigd_na_uitgifte");
    workSlip.Property(item => item.UitgereiktOp).HasColumnName("uitgereikt_op");
    workSlip.Property(item => item.BinnenOp).HasColumnName("binnen_op");
    workSlip.HasIndex(item => item.Nummer).IsUnique();
    workSlip.HasIndex(item => item.InzetId).IsUnique();
    workSlip.HasOne(item => item.Inzet).WithOne(item => item.Werkbon).HasForeignKey<Werkbon>(item => item.InzetId).OnDelete(DeleteBehavior.Cascade);

    var leverancier = modelBuilder.Entity<Leverancier>();
    leverancier.ToTable("leveranciers");
    leverancier.HasKey(item => item.Id);
    leverancier.Property(item => item.Id).HasColumnName("id");
    leverancier.Property(item => item.Aan).HasColumnName("aan");
    leverancier.Property(item => item.Debiteurnummer).HasColumnName("debiteurnummer");
    leverancier.Property(item => item.Bedrijfsnaam).HasColumnName("bedrijfsnaam");
    leverancier.Property(item => item.KvkNummer).HasColumnName("kvk_nummer");
    leverancier.Property(item => item.BtwNummer).HasColumnName("btw_nummer");
    leverancier.Property(item => item.Iban).HasColumnName("iban").HasMaxLength(50);
    leverancier.Property(item => item.Website).HasColumnName("website");
    leverancier.Property(item => item.TelefoonAlgemeen).HasColumnName("telefoon_algemeen");
    leverancier.Property(item => item.EmailAlgemeen).HasColumnName("email_algemeen");
    leverancier.Property(item => item.Straat).HasColumnName("straat");
    leverancier.Property(item => item.Huisnummer).HasColumnName("huisnummer");
    leverancier.Property(item => item.Toevoeging).HasColumnName("toevoeging");
    leverancier.Property(item => item.Postcode).HasColumnName("postcode");
    leverancier.Property(item => item.Plaats).HasColumnName("plaats");
    leverancier.Property(item => item.Land).HasColumnName("land");
    leverancier.Property(item => item.FactuurEmail).HasColumnName("factuur_email");
    leverancier.Property(item => item.AfwijkendFactuuradres).HasColumnName("afwijkend_factuuradres");
    leverancier.Property(item => item.VasteReferentie).HasColumnName("vaste_referentie");
    leverancier.Property(item => item.GRekeningPercentage).HasColumnName("g_rekening_percentage").HasPrecision(5, 2);
    leverancier.Property(item => item.FacturerenPer).HasColumnName("factureren_per");
    leverancier.Property(item => item.BtwVerlegd).HasColumnName("btw_verlegd");
    leverancier.Property(item => item.MandagenregisterMeesturen).HasColumnName("mandagenregister_meesturen");
    leverancier.Property(item => item.Opmerkingen).HasColumnName("opmerkingen");
    leverancier.Property(item => item.Version).HasColumnName("version").IsConcurrencyToken();

    var klant = modelBuilder.Entity<Klant>();
    klant.ToTable("klanten");
    klant.HasKey(item => item.Id);
    klant.Property(item => item.Id).HasColumnName("id");
    klant.Property(item => item.Aan).HasColumnName("aan");
    klant.Property(item => item.Debiteurnummer).HasColumnName("debiteurnummer");
    klant.Property(item => item.Bedrijfsnaam).HasColumnName("bedrijfsnaam");
    klant.Property(item => item.KvkNummer).HasColumnName("kvk_nummer");
    klant.Property(item => item.BtwNummer).HasColumnName("btw_nummer");
    klant.Property(item => item.Iban).HasColumnName("iban").HasMaxLength(50);
    klant.Property(item => item.Website).HasColumnName("website");
    klant.Property(item => item.TelefoonAlgemeen).HasColumnName("telefoon_algemeen");
    klant.Property(item => item.EmailAlgemeen).HasColumnName("email_algemeen");
    klant.Property(item => item.Straat).HasColumnName("straat");
    klant.Property(item => item.Huisnummer).HasColumnName("huisnummer");
    klant.Property(item => item.Toevoeging).HasColumnName("toevoeging");
    klant.Property(item => item.Postcode).HasColumnName("postcode");
    klant.Property(item => item.Plaats).HasColumnName("plaats");
    klant.Property(item => item.Land).HasColumnName("land");
    klant.Property(item => item.FactuurEmail).HasColumnName("factuur_email");
    klant.Property(item => item.AfwijkendFactuuradres).HasColumnName("afwijkend_factuuradres");
    klant.Property(item => item.VasteReferentie).HasColumnName("vaste_referentie");
    klant.Property(item => item.GRekeningPercentage).HasColumnName("g_rekening_percentage").HasPrecision(5, 2);
    klant.Property(item => item.FacturerenPer).HasColumnName("factureren_per");
    klant.Property(item => item.BtwVerlegd).HasColumnName("btw_verlegd");
    klant.Property(item => item.MandagenregisterMeesturen).HasColumnName("mandagenregister_meesturen");
    klant.Property(item => item.Opmerkingen).HasColumnName("opmerkingen");
    klant.Property(item => item.TarievenVersion).HasColumnName("tarieven_version");
    klant.Property(item => item.Version).HasColumnName("version");

    var functie = modelBuilder.Entity<PlanningFunctie>();
    functie.ToTable("functies");
    functie.HasKey(item => item.Id);
    functie.Property(item => item.Id).HasColumnName("id");
    functie.Property(item => item.Aan).HasColumnName("aan");
    functie.Property(item => item.Naam).HasColumnName("naam");
    functie.Property(item => item.Toelichting).HasColumnName("toelichting");

    var standaardTarief = modelBuilder.Entity<PlanningStandaardTarief>();
    standaardTarief.ToTable("standaard_tarieven");
    standaardTarief.HasKey(item => item.Id);
    standaardTarief.Property(item => item.Id).HasColumnName("id");
    standaardTarief.Property(item => item.FunctieId).HasColumnName("functie_id");
    standaardTarief.Property(item => item.Prijs).HasColumnName("prijs").HasPrecision(10, 2);
    standaardTarief.Property(item => item.Version).HasColumnName("version");
    standaardTarief.Property(item => item.Eenheid).HasColumnName("eenheid");
    standaardTarief.Property(item => item.GeldigVanaf).HasColumnName("geldig_vanaf");
    standaardTarief.HasOne(item => item.Functie).WithMany().HasForeignKey(item => item.FunctieId);

    var klantTarief = modelBuilder.Entity<PlanningKlantTarief>();
    klantTarief.ToTable("klant_afwijkende_tarieven");
    klantTarief.HasKey(item => item.Id);
    klantTarief.Property(item => item.Id).HasColumnName("id");
    klantTarief.Property(item => item.KlantId).HasColumnName("klant_id");
    klantTarief.Property(item => item.FunctieId).HasColumnName("functie_id");
    klantTarief.Property(item => item.Omschrijving).HasColumnName("omschrijving");
    klantTarief.Property(item => item.Tarief).HasColumnName("tarief").HasPrecision(10, 2);
    klantTarief.Property(item => item.Eenheid).HasColumnName("eenheid");

    var contact = modelBuilder.Entity<KlantContactpersoon>();
    contact.ToTable("klant_contactpersonen");
    contact.HasKey(item => item.Id);
    contact.Property(item => item.Id).HasColumnName("id");
    contact.Property(item => item.KlantId).HasColumnName("klant_id");
    contact.Property(item => item.IsStandaardBesteller).HasColumnName("is_standaard_besteller");
    contact.Property(item => item.Naam).HasColumnName("naam");
    contact.Property(item => item.Functie).HasColumnName("functie");
    contact.Property(item => item.Telefoon).HasColumnName("telefoon");
    contact.Property(item => item.Email).HasColumnName("email");
    contact.HasOne(item => item.Klant).WithMany(item => item.Contactpersonen)
      .HasForeignKey(item => item.KlantId).OnDelete(DeleteBehavior.Cascade);

    var instellingen = modelBuilder.Entity<InstellingenAlgemeen>();

    instellingen.ToTable("instellingen_algemeen");
    instellingen.HasKey(i => i.Id);
    instellingen.Property(i => i.Id).HasColumnName("id");
    instellingen.Property(i => i.SysteemNaam).HasColumnName("systeem_naam").IsRequired();
    instellingen.Property(i => i.Version).HasColumnName("version");
    instellingen.HasMany(i => i.Vestigingen)
      .WithOne(v => v.InstellingenAlgemeen)
      .HasForeignKey(v => v.InstellingenAlgemeenId)
      .OnDelete(DeleteBehavior.Cascade);

    var vestiging = modelBuilder.Entity<Vestiging>();

    vestiging.ToTable("vestigingen");
    vestiging.HasKey(v => v.Id);

    vestiging.Property(v => v.Id).HasColumnName("id");
    vestiging.Property(v => v.InstellingenAlgemeenId).HasColumnName("instellingen_algemeen_id");
    vestiging.Property(v => v.Naam).HasColumnName("naam").IsRequired();
    vestiging.Property(v => v.Adres).HasColumnName("adres").IsRequired();
    vestiging.Property(v => v.Postcode).HasColumnName("postcode").IsRequired();
    vestiging.Property(v => v.Plaats).HasColumnName("plaats").IsRequired();
    vestiging.Property(v => v.Telefoon).HasColumnName("telefoon").IsRequired();
    vestiging.Property(v => v.Email).HasColumnName("email").IsRequired();
    vestiging.Property(v => v.KvkNummer).HasColumnName("kvk_nummer").IsRequired();
    vestiging.Property(v => v.BtwNummer).HasColumnName("btw_nummer").IsRequired();
    vestiging.Property(v => v.Iban).HasColumnName("iban").IsRequired();

    var artikelCategorie = modelBuilder.Entity<ArtikelCategorie>();
    artikelCategorie.ToTable("artikel_categorieen");
    artikelCategorie.HasKey(categorie => categorie.Id);
    artikelCategorie.Property(categorie => categorie.Id).HasColumnName("id");
    artikelCategorie.Property(categorie => categorie.Code).HasColumnName("code").HasMaxLength(100).IsRequired();
    artikelCategorie.Property(categorie => categorie.Naam).HasColumnName("naam").HasMaxLength(200).IsRequired();
    artikelCategorie.Property(categorie => categorie.Sorteervolgorde).HasColumnName("sorteervolgorde");
    artikelCategorie.Property(categorie => categorie.Actief).HasColumnName("actief");
    artikelCategorie.HasIndex(categorie => categorie.Code).IsUnique();

    var artikelEenheid = modelBuilder.Entity<ArtikelEenheid>();
    artikelEenheid.ToTable("artikel_eenheden");
    artikelEenheid.HasKey(eenheid => eenheid.Id);
    artikelEenheid.Property(eenheid => eenheid.Id).HasColumnName("id");
    artikelEenheid.Property(eenheid => eenheid.Code).HasColumnName("code").HasMaxLength(100).IsRequired();
    artikelEenheid.Property(eenheid => eenheid.Naam).HasColumnName("naam").HasMaxLength(100).IsRequired();
    artikelEenheid.Property(eenheid => eenheid.Sorteervolgorde).HasColumnName("sorteervolgorde");
    artikelEenheid.Property(eenheid => eenheid.Actief).HasColumnName("actief");
    artikelEenheid.HasIndex(eenheid => eenheid.Code).IsUnique();

    var artikel = modelBuilder.Entity<Artikel>();
    artikel.ToTable("artikelen", table => table.HasCheckConstraint(
      "ck_artikelen_tariefsoort_tarief",
      "(tariefsoort = 'vast' and tarief is not null) or (tariefsoort = 'zie_prijs' and tarief is null)"));
    artikel.HasKey(item => item.Id);
    artikel.Property(item => item.Id).HasColumnName("id");
    artikel.Property(item => item.Naam).HasColumnName("naam").HasMaxLength(200).IsRequired();
    artikel.Property(item => item.CategorieId).HasColumnName("categorie_id");
    artikel.Property(item => item.EenheidId).HasColumnName("eenheid_id");
    artikel.Property(item => item.TariefSoort).HasColumnName("tariefsoort").HasMaxLength(20).IsRequired();
    artikel.Property(item => item.Tarief).HasColumnName("tarief").HasPrecision(14, 4);
    artikel.Property(item => item.Actief).HasColumnName("actief");
    artikel.Property(item => item.Version).HasColumnName("version").IsConcurrencyToken();
    artikel.HasIndex(item => item.Actief);
    artikel.HasOne(item => item.Categorie)
      .WithMany(categorie => categorie.Artikelen)
      .HasForeignKey(item => item.CategorieId)
      .OnDelete(DeleteBehavior.Restrict);
    artikel.HasOne(item => item.Eenheid)
      .WithMany(eenheid => eenheid.Artikelen)
      .HasForeignKey(item => item.EenheidId)
      .OnDelete(DeleteBehavior.Restrict);

    var userInformation = modelBuilder.Entity<UserInformation>();
    userInformation.ToTable("user_information", table =>
    {
      table.HasCheckConstraint(
        "ck_user_information_signature_size",
        "digital_signature is null or octet_length(digital_signature) <= 1048576");
      table.HasCheckConstraint(
        "ck_user_information_signature_content_type",
        "(digital_signature is null) = (digital_signature_media_type is null)");
    });
    userInformation.HasKey(profile => profile.KeycloakSubject);
    userInformation.Property(profile => profile.KeycloakSubject).HasColumnName("keycloak_sub");
    userInformation.Property(profile => profile.EmployeeNumber).HasColumnName("employee_number").HasMaxLength(50);
    userInformation.Property(profile => profile.DisplayName).HasColumnName("display_name").HasMaxLength(200);
    userInformation.Property(profile => profile.JobTitle).HasColumnName("job_title").HasMaxLength(200);
    userInformation.Property(profile => profile.PhoneNumber).HasColumnName("phone_number").HasMaxLength(32);
    userInformation.Property(profile => profile.EmailAddress).HasColumnName("email_address").HasMaxLength(254);
    userInformation.Property(profile => profile.IsActive).HasColumnName("is_active");
    userInformation.Property(profile => profile.VestigingId).HasColumnName("vestiging_id");
    userInformation.Property(profile => profile.AlternativeEmail).HasColumnName("alternative_email").HasMaxLength(254);
    userInformation.Property(profile => profile.DigitalSignature).HasColumnName("digital_signature").HasColumnType("bytea");
    userInformation.Property(profile => profile.DigitalSignatureContentType).HasColumnName("digital_signature_media_type").HasMaxLength(32);
    userInformation.Property(profile => profile.Version).HasColumnName("version").IsConcurrencyToken();
    userInformation.Property(profile => profile.CreatedAt).HasColumnName("created_at");
    userInformation.Property(profile => profile.UpdatedAt).HasColumnName("updated_at");
    userInformation.HasOne(profile => profile.Vestiging)
      .WithMany()
      .HasForeignKey(profile => profile.VestigingId)
      .OnDelete(DeleteBehavior.Restrict);

    var userSkill = modelBuilder.Entity<UserSkill>();
    userSkill.ToTable("skills", table => table.HasCheckConstraint(
      "ck_skills_name_not_empty",
      "btrim(name) <> ''"));
    userSkill.HasKey(skill => skill.Id);
    userSkill.Property(skill => skill.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    userSkill.Property(skill => skill.Name).HasColumnName("name").HasMaxLength(200).IsRequired();
    userSkill.HasIndex(skill => skill.Name).IsUnique();

    var userInformationSkill = modelBuilder.Entity<UserInformationSkill>();
    userInformationSkill.ToTable("user_skills");
    userInformationSkill.HasKey(skill => new { skill.KeycloakSubject, skill.SkillId });
    userInformationSkill.Property(skill => skill.KeycloakSubject).HasColumnName("keycloak_sub");
    userInformationSkill.Property(skill => skill.SkillId).HasColumnName("skill_id");
    userInformationSkill.Property(skill => skill.DiplomaOn).HasColumnName("diploma_on").HasColumnType("date");
    userInformationSkill.Property(skill => skill.ValidUntil).HasColumnName("valid_until").HasColumnType("date");
    userInformationSkill.HasOne(skill => skill.UserInformation)
      .WithMany(profile => profile.Skills)
      .HasForeignKey(skill => skill.KeycloakSubject)
      .OnDelete(DeleteBehavior.Cascade);
    userInformationSkill.HasOne(skill => skill.Skill)
      .WithMany(item => item.UserInformationSkills)
      .HasForeignKey(skill => skill.SkillId)
      .OnDelete(DeleteBehavior.Cascade);
    userInformationSkill.HasIndex(skill => skill.SkillId)
      .HasDatabaseName("ix_user_skills_skill_id");

    var materieelGroep = modelBuilder.Entity<MaterieelGroep>();
    materieelGroep.ToTable("materieelgroep", table => table.HasCheckConstraint(
      "ck_materieelgroep_omschrijving_not_empty",
      "btrim(omschrijving) <> ''"));
    materieelGroep.HasKey(group => group.Id);
    materieelGroep.Property(group => group.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    materieelGroep.Property(group => group.Omschrijving).HasColumnName("omschrijving").IsRequired();
    materieelGroep.Property(group => group.Version).HasColumnName("version").IsConcurrencyToken();

    var materieel = modelBuilder.Entity<Materieel>();
    materieel.ToTable("materieel");
    materieel.HasKey(item => item.Id);
    materieel.Property(item => item.Id).HasColumnName("id").HasDefaultValueSql("gen_random_uuid()");
    materieel.Property(item => item.Kenteken).HasColumnName("kenteken");
    materieel.Property(item => item.Omschrijving).HasColumnName("omschrijving");
    materieel.Property(item => item.StandplaatsId).HasColumnName("standplaats_id");
    materieel.Property(item => item.Merk).HasColumnName("merk");
    materieel.Property(item => item.Zoeknaam).HasColumnName("zoeknaam");
    materieel.Property(item => item.Serienummer).HasColumnName("serienummer");
    materieel.Property(item => item.MaterieelGroepId).HasColumnName("materieelgroep_id");
    materieel.Property(item => item.Version).HasColumnName("version").IsConcurrencyToken();
    materieel.HasIndex(item => item.StandplaatsId);
    materieel.HasIndex(item => item.MaterieelGroepId);
    materieel.HasOne(item => item.Standplaats)
      .WithMany()
      .HasForeignKey(item => item.StandplaatsId)
      .OnDelete(DeleteBehavior.Restrict);
    materieel.HasOne(item => item.MaterieelGroep)
      .WithMany(group => group.MaterieelItems)
      .HasForeignKey(item => item.MaterieelGroepId)
      .OnDelete(DeleteBehavior.Restrict);
  }
}
