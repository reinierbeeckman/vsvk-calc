# Deploy (Docker Compose)

Deze repository draait volgens het **BFF-pattern**:

- Browser/SPA praat alleen met de **YARP BFF** (`bff`)
- `bff` doet OIDC richting Keycloak en proxyt `/api/*` naar de .NET API
- `api` valideert JWT en forceert autorisatie
- PostgreSQL en API zijn intern op het compose-netwerk

## Environment-best-practice

Gebruik altijd **exact één runtime env-file** per deployment en geef die expliciet mee met `--env-file`.

- Dev template: `deploy/env/.env.dev.example`
- Staging template: `deploy/env/.env.staging.example`
- Prod template: `deploy/env/.env.prod.example`

Kopieer op de target host het juiste template naar `deploy/env/.env` en vul secrets in.

> Gebruik geen impliciete root `.env` voor compose; forceer altijd `--env-file deploy/env/.env`.

## Lokaal draaien (dev)

Vanuit repo-root:

```powershell
# 1) Start/rebuild services met expliciete env-file
& "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  up -d --build --force-recreate

# 2) Run migrations
& "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  --profile migrate run --rm migrate
```

Open daarna:

- App/BFF: http://localhost:8080
- Login start: http://localhost:8080/bff/login
- Keycloak: http://localhost:8081

## Staging/Prod draaien

Gebruik dezelfde base compose met de juiste overlay en env-file.

```bash
# Staging

docker compose --env-file deploy/env/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.staging.yml up -d --build

# Prod

docker compose --env-file deploy/env/.env \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.prod.yml up -d --build
```

## Vereiste variabelen

### App database
- `PGDATABASE`, `PGUSER`, `PGPASSWORD`

### OIDC (BFF)
- `OIDC_AUTHORITY`
- `OIDC_METADATA_ADDRESS`
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_CALLBACK_PATH`

### JWT (API)
- `JWT_AUTHORITY`
- `JWT_METADATA_ADDRESS`
- `JWT_AUDIENCE`

### Keycloak database (gescheiden van app-db)
- `KEYCLOAK_DB`, `KEYCLOAK_DB_USER`, `KEYCLOAK_DB_PASSWORD`

### Keycloak runtime
- `KEYCLOAK_HOSTNAME`
- `KEYCLOAK_ADMIN_USERNAME`, `KEYCLOAK_ADMIN_PASSWORD`

## Belangrijke security-regels

- Geen secrets in git; alleen in `deploy/env/.env` op de target host.
- `KEYCLOAK_HOSTNAME` moet matchen met issuer in `OIDC_AUTHORITY` en `JWT_AUTHORITY`.
- Keycloak DB credentials moeten verschillen van applicatie-DB credentials.

## CI/CD (GHCR)

Workflow: `.github/workflows/build-and-deploy.yml`

Benodigde GitHub Environment secrets:
- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_DIR`

Images:
- `ghcr.io/<owner>/vsvk-calc-bff:<tag>`
- `ghcr.io/<owner>/vsvk-calc-api:<tag>`
