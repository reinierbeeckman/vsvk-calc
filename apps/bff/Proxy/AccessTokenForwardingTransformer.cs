using System.Net.Http.Headers;
using Microsoft.AspNetCore.Authentication;
using Yarp.ReverseProxy.Transforms;

namespace Vsvk.Bff.Proxy;

public sealed class AccessTokenForwardingTransformer
{
  public async Task TransformRequestAsync(RequestTransformContext context)
  {
    // Never forward the session cookie to downstream services.
    context.ProxyRequest.Headers.Remove("Cookie");

    var accessToken = await context.HttpContext.GetTokenAsync("access_token");
    if (!string.IsNullOrWhiteSpace(accessToken))
    {
      context.ProxyRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    }
  }
}
