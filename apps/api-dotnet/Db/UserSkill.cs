namespace Vsvk.Api.Db;

public sealed class UserSkill
{
  public Guid Id { get; set; }
  public string Name { get; set; } = string.Empty;
  public ICollection<UserInformationSkill> UserInformationSkills { get; set; } = new List<UserInformationSkill>();
}
