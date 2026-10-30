# VSVK Calculatie & Offerte

Calculatie- en offerte-app op een BFF-architectuur:

- SPA in browser
- .NET YARP BFF
- .NET API
- Keycloak
- PostgreSQL

## Lokaal draaien (aanbevolen)

1. Kopieer [deploy/env/.env.dev.example](deploy/env/.env.dev.example) naar `deploy/env/.env` en pas waarden aan.
2. Start stack met expliciete env-file:

```powershell
& "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  up -d --build --force-recreate

& "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  --profile migrate run --rm migrate
```

Open daarna:

- App/BFF: http://localhost:8080
- Login: http://localhost:8080/bff/login
- Keycloak: http://localhost:8081

## Environments

Environment templates:

- `deploy/env/.env.dev.example`
- `deploy/env/.env.staging.example`
- `deploy/env/.env.prod.example`

Gebruik per omgeving exact één runtime env-file: `deploy/env/.env`.

## Structuur

- `apps/calculatie/` — SPA
- `apps/bff/` — YARP BFF
- `apps/api-dotnet/` — REST API
- `deploy/compose/` — compose files per environment
- `deploy/env/` — environment templates

## Security-afspraken

- Geen secrets in code of git.
- Gebruik altijd `--env-file deploy/env/.env` bij compose.
- Scheid app-database en Keycloak-database credentials.

Meer deployment-details: `deploy/README.md`.
