# Deploy (Docker Compose)

Deze repository deployt nu volgens het **BFF (Backend-for-Frontend)** patroon:

- Browser/SPA praat **alleen** met de **YARP BFF** (`bff`)
- `bff` doet OIDC (confidential client) richting **Keycloak** en bewaart tokens server-side in een encrypted cookie-ticket
- `bff` proxyt `/api/*` naar de downstream **.NET REST API** (`api`) en injecteert `Authorization: Bearer <access_token>`
- `api` valideert JWT’s van Keycloak (issuer + audience + signature + expiry) en enforce’t autorisatie (`employee`, `manager`)
- PostgreSQL en de API zijn niet publiek bereikbaar (geen host-ports), alleen via het interne compose netwerk

## Lokaal draaien (Windows / Docker Desktop)

Vanuit repo-root:

```bash
docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml up -d --build
docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml --profile migrate run --rm migrate
```

> Windows tip: als PowerShell `docker` niet herkent, herstart je terminal of roep `docker.exe` direct aan (check eventueel eerst `where.exe docker`). Voorbeeld:
>
> ```powershell
> & "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml up -d --build
> ```

Open daarna:

- App/BFF: http://localhost:8080
- BFF health: http://localhost:8080/health
- API health (via BFF): http://localhost:8080/api/health
- Keycloak: http://localhost:8081

### Test-users (dev)

Keycloak realm: `vsvk` (realm-import via `deploy/keycloak/import/vsvk-realm.json` in **dev**; voor staging/prod richt je realm/clients/roles/users in zonder dev/test secrets)

- `employee1` / `password`  (role: `employee`)
- `manager1` / `password`   (role: `manager`)

Login start:

- http://localhost:8080/bff/login

### Keycloak inrichting (staging/prod)

In staging/prod wil je meestal **geen** dev realm-import met test-users en een vaste client secret.
Richt daarom Keycloak in met eigen credentials en bewaar secrets alleen in je `.env` op de VM.

Minimale inrichting voor deze stack:

- Realm: `vsvk`
- Realm roles: `employee`, `manager`
- Client (BFF) `vsvk-bff`:
  - Type: confidential client
  - Flow: Authorization Code + PKCE
  - Redirect URI: `https://<bff-host>/signin-oidc`
  - (Optioneel) `offline_access` toestaan als je refresh tokens wil gebruiken
  - Client secret in `.env` als `OIDC_CLIENT_SECRET`
- Audience: zorg dat access tokens een `aud` bevatten die matcht met `JWT_AUDIENCE` (bijv. `vsvk-api`)
  - Dit kan met een Audience mapper / client scope mapper
- Users: koppel gebruikers aan realm roles `employee`/`manager`
## Environments (dev / staging / prod)

Compose files:

- Base: `deploy/compose/docker-compose.yml`
- Dev: `deploy/compose/docker-compose.dev.yml`
- Staging: `deploy/compose/docker-compose.staging.yml`
- Prod: `deploy/compose/docker-compose.prod.yml`

Op staging/prod zet je op de VM in `DEPLOY_DIR` een `.env` met o.a.:

### App database

- `PGDATABASE`, `PGUSER`, `PGPASSWORD`

### OIDC (BFF)

- `OIDC_AUTHORITY` (moet matchen met Keycloak issuer in tokens)
- `OIDC_METADATA_ADDRESS` (mag intern zijn, bv. `http://keycloak:8080/realms/vsvk/.well-known/openid-configuration`)
- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`

### JWT (API)

- `JWT_AUTHORITY` (issuer)
- `JWT_METADATA_ADDRESS`
- `JWT_AUDIENCE` (bijv. `vsvk-api`)

### Keycloak database (gescheiden van app db)

- `KEYCLOAK_DB` (default: `keycloak`)
- `KEYCLOAK_DB_USER` (default: `keycloak`)
- `KEYCLOAK_DB_PASSWORD` (default: `keycloak`)

### Keycloak runtime

- `KEYCLOAK_HOSTNAME` (bepaalt issuer; moet matchen met `OIDC_AUTHORITY`/`JWT_AUTHORITY`)
- `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD`

### Deploy

- `IMAGE_TAG` (optioneel; wordt door GitHub Actions gezet)
- `GITHUB_REPOSITORY_OWNER` (wordt door GitHub Actions gezet)

Voorbeeld: `deploy/env/.env.example`

## CI/CD met GHCR (GitHub Container Registry)

Workflow: `.github/workflows/build-and-deploy.yml`

Benodigd per GitHub Environment (`dev`, `test`, `acc`, `prod`) secrets:

- `SSH_HOST` (host/ip van de VM)
- `SSH_USER`
- `SSH_PRIVATE_KEY` (deploy key)
- `DEPLOY_DIR` (bijv. `/opt/vsvk-calc/dev`)

De workflow pusht images naar:

- `ghcr.io/<owner>/vsvk-calc-bff:<tag>`
- `ghcr.io/<owner>/vsvk-calc-api:<tag>`



