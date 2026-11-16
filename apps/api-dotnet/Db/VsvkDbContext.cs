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

  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
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
