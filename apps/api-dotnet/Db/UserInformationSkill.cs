namespace Vsvk.Api.Db;

public sealed class UserInformationSkill
{
  public Guid KeycloakSubject { get; set; }
  public UserInformation UserInformation { get; set; } = null!;
  public Guid SkillId { get; set; }
  public UserSkill Skill { get; set; } = null!;
  public DateOnly? DiplomaOn { get; set; }
  public DateOnly? ValidUntil { get; set; }
}
