using Microsoft.EntityFrameworkCore;

namespace Vsvk.Api.Db;

public sealed class VsvkDbContext : DbContext
{
  public VsvkDbContext(DbContextOptions<VsvkDbContext> options) : base(options)
  {
  }

  public DbSet<Vestiging> Vestigingen => Set<Vestiging>();
  public DbSet<InstellingenAlgemeen> InstellingenAlgemeen => Set<InstellingenAlgemeen>();

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
  }
}
