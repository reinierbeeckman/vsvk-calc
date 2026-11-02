using System.Globalization;

namespace Vsvk.Api.Http;

public readonly record struct IfMatchParseResult(long? Version, int StatusCode)
{
  public bool IsValid => Version.HasValue;
}

public static class IfMatchParser
{
  public static IfMatchParseResult Parse(string? raw)
  {
    if (raw is null)
    {
      return new IfMatchParseResult(null, StatusCodes.Status428PreconditionRequired);
    }

    var value = raw.Trim();
    if (value.Length < 3 || value[0] != '"' || value[^1] != '"'
      || !long.TryParse(value.AsSpan(1, value.Length - 2), NumberStyles.None, CultureInfo.InvariantCulture, out var version)
      || version <= 0)
    {
      return new IfMatchParseResult(null, StatusCodes.Status400BadRequest);
    }

    if (!string.Equals(value, StrongEtag.Format(version), StringComparison.Ordinal))
    {
      return new IfMatchParseResult(null, StatusCodes.Status400BadRequest);
    }

    return new IfMatchParseResult(version, StatusCodes.Status200OK);
  }
}

public static class StrongEtag
{
  public static string Format(long version) => $"\"{version.ToString(CultureInfo.InvariantCulture)}\"";
}
