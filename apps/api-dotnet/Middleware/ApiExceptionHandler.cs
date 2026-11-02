using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace Vsvk.Api.Middleware;

public sealed class ApiExceptionHandler(ILogger<ApiExceptionHandler> logger) : IExceptionHandler
{
  public async ValueTask<bool> TryHandleAsync(
    HttpContext httpContext,
    Exception exception,
    CancellationToken cancellationToken)
  {
    if (exception is not NpgsqlException)
    {
      return false;
    }

    logger.LogError(exception, "The application database is unavailable while processing {Path}.", httpContext.Request.Path);
    httpContext.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
    await httpContext.Response.WriteAsJsonAsync(new ProblemDetails
    {
      Status = StatusCodes.Status503ServiceUnavailable,
      Title = "Database tijdelijk niet beschikbaar",
      Detail = "Probeer het over enkele ogenblikken opnieuw.",
      Instance = httpContext.Request.Path
    }, cancellationToken);

    return true;
  }
}
