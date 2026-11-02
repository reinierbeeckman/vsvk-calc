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

  protected override void OnModelCreating(ModelBuilder modelBuilder)
  {
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
    userInformation.Property(profile => profile.PhoneNumber).HasColumnName("phone_number").HasMaxLength(32);
    userInformation.Property(profile => profile.AlternativeEmail).HasColumnName("alternative_email").HasMaxLength(254);
    userInformation.Property(profile => profile.DigitalSignature).HasColumnName("digital_signature").HasColumnType("bytea");
    userInformation.Property(profile => profile.DigitalSignatureContentType).HasColumnName("digital_signature_media_type").HasMaxLength(32);
    userInformation.Property(profile => profile.Version).HasColumnName("version").IsConcurrencyToken();
    userInformation.Property(profile => profile.CreatedAt).HasColumnName("created_at");
    userInformation.Property(profile => profile.UpdatedAt).HasColumnName("updated_at");
  }
}
