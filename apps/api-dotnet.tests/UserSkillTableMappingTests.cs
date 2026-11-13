using Microsoft.EntityFrameworkCore;
using Vsvk.Api.Db;
using Xunit;

namespace Vsvk.Api.Tests;

public sealed class UserSkillTableMappingTests
{
  [Fact]
  public void Skill_catalog_and_user_skill_link_use_distinct_table_names()
  {
    var options = new DbContextOptionsBuilder<VsvkDbContext>()
      .UseNpgsql("Host=localhost;Database=vsvk_calc;Username=vsvk;Password=vsvk")
      .Options;

    using var context = new VsvkDbContext(options);

    var skillTable = context.Model.FindEntityType(typeof(UserSkill))?.GetTableName();
    var linkTable = context.Model.FindEntityType(typeof(UserInformationSkill))?.GetTableName();

    Assert.Equal("skills", skillTable);
    Assert.Equal("user_skills", linkTable);
  }
}
