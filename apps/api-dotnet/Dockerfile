FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build

WORKDIR /src

COPY apps/api-dotnet/Vsvk.Api.csproj apps/api-dotnet/
RUN dotnet restore apps/api-dotnet/Vsvk.Api.csproj

COPY apps/api-dotnet/ apps/api-dotnet/

RUN dotnet publish apps/api-dotnet/Vsvk.Api.csproj -c Release -o /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime

WORKDIR /app

COPY --from=build /out ./

ENV ASPNETCORE_URLS=http://+:8090
EXPOSE 8090

ENTRYPOINT ["dotnet", "Vsvk.Api.dll"]
