FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

COPY apps/bff/Vsvk.Bff.csproj apps/bff/
RUN dotnet restore apps/bff/Vsvk.Bff.csproj

COPY apps/bff/ apps/bff/
COPY apps/calculatie/ apps/calculatie/
COPY apps/planning/ apps/planning/
COPY apps/shared/ apps/shared/

RUN dotnet publish apps/bff/Vsvk.Bff.csproj -c Release -o /out /p:UseAppHost=false

# Serve the existing SPA as static files via the BFF.
RUN mkdir -p /out/wwwroot && cp -r apps/calculatie/* /out/wwwroot/
RUN mkdir -p /out/wwwroot/planning && cp -r apps/planning/* /out/wwwroot/planning/
RUN mkdir -p /out/wwwroot/shared && cp -r apps/shared/* /out/wwwroot/shared/

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

WORKDIR /app

COPY --from=build /out ./

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Vsvk.Bff.dll"]
