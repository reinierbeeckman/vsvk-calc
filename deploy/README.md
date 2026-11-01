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
docker compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  up -d --build --force-recreate

# 2) Run migrations
docker compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  --profile migrate run --rm migrate
```

Open daarna:

- App/BFF: http://localhost:8080
- Login start: http://localhost:8080/bff/login
- Keycloak: http://localhost:8081

### Automatisch herbouwen tijdens lokaal ontwikkelen

Docker Compose Watch (Compose 2.22 of nieuwer) bouwt de API opnieuw wanneer `apps/api-dotnet` wijzigt en de BFF opnieuw wanneer `apps/bff` of `apps/calculatie` wijzigt. De BFF serveert de SPA, daarom worden wijzigingen aan de calculatiepagina ook via de BFF-container zichtbaar. De database en Keycloak worden niet opnieuw gebouwd.

Start eerst de stack en voer de database-migraties uit met de opdrachten hierboven. Start daarna in een aparte PowerShell-terminal, vanuit de repository-root, de watcher:

```powershell
docker compose `
  --env-file deploy/env/.env `
  -f deploy/compose/docker-compose.yml `
  -f deploy/compose/docker-compose.dev.yml `
  watch api bff
```

Laat dit terminalvenster open. Bij opslaan wordt de relevante container opnieuw gebouwd en gestart:

- `apps/api-dotnet`: de API-container (`api`)
- `apps/bff`: de BFF-container (`bff`)
- `apps/calculatie`: de BFF-container, die de SPA serveert

De database en Keycloak worden niet opnieuw gebouwd. Stop de watcher met `Ctrl+C`; de containers blijven draaien. Start de watcher opnieuw met hetzelfde commando. Na wijzigingen aan het databaseschema voer je de migratieopdracht hierboven opnieuw uit. Wijzigingen aan `.env`, Compose-configuratie of gedeelde buildbestanden vereisen een nieuwe `docker compose up -d --build` met dezelfde `--env-file` en `-f` opties.

Handige opdrachten vanuit de repository-root:

```powershell
# Status bekijken
docker compose --env-file deploy/env/.env -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml ps

# Logs volgen (bijvoorbeeld de API)
docker compose --env-file deploy/env/.env -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml logs -f api

# Containers stoppen; data-volumes blijven behouden
docker compose --env-file deploy/env/.env -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml down
```

Als `docker` in PowerShell nog niet wordt herkend, herstart Docker Desktop en PowerShell na installatie. Je kunt tijdelijk het volledige pad naar `docker.exe` gebruiken, bijvoorbeeld `& 'C:\Users\reini\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' compose ...`.

De Keycloak-image bevat het VSVK-login-thema. Een nieuwe realm krijgt dit thema via de realm-import. Voor een bestaande realm moet je het eenmalig activeren in Keycloak: **Realm settings → Themes → Login theme → `vsvk` → Save**. De keuze blijft opgeslagen in de Keycloak-database.

Voor OIDC-logout moet de Keycloak-client `vsvk-bff` ook `http://localhost:8080/signout-callback-oidc` toestaan als **Valid post logout redirect URI**. De realm-import bevat deze callback voor nieuwe realms. Bij een al bestaande realm moet je deze URI handmatig toevoegen via **Clients → vsvk-bff → Settings → Logout settings**; een bestaande Keycloak-database wordt niet automatisch bijgewerkt door de import.

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

## Rollen en rechten

De VSVK-realm gebruikt de rollen `development`, `directie`, `finance`, `operationeel` en `planning`. Laat alle vijf rollen `default-roles-vsvk` erven. De API controleert deze gemeenschappelijke rol voor applicatietoegang; de afzonderlijke rollen bepalen aanvullende rechten:

| Recht | Rollen |
| --- | --- |
| Applicatietoegang en calculaties binnen de eigen vestiging | `default-roles-vsvk` (geërfd door alle vijf rollen) en een `vestiging`-claim |
| Alle vestigingen en calculaties beheren; instellingen wijzigen; status wijzigen/verwijderen | `directie` |
| IBAN- en btw-gegevens van vestigingen inzien | `directie`, `finance` |

Ontbreekt bij een gebruiker buiten `directie` de vestigingsclaim, dan weigert de API de vestigingsgebonden calculatie-endpoints (`403`) in plaats van alle vestigingen te tonen. Ontbreekt `default-roles-vsvk` in het JWT, dan wordt applicatietoegang geweigerd. De API gebruikt de Keycloak-realmrol dus als expliciete gemeenschappelijke toegangspoort.

De realm-import definieert rollen en voorbeeldgebruikers alleen bij het initialiseren van een nieuwe realm. Een al bestaande realm met persistente Keycloak-database wordt niet automatisch bijgewerkt: voeg de rollen toe via **Realm roles** en wijs ze via **Users → Role mapping** toe. De voorbeeldaccounts zijn `employee1` (`operationeel`) en `manager1` (`directie`); de accountnamen zijn alleen voorbeelden en bepalen zelf geen rechten.

## CI/CD (GHCR)

Workflow: `.github/workflows/build-and-deploy.yml`

Benodigde GitHub Environment secrets:
- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_DIR`

Images:
- `ghcr.io/<owner>/vsvk-calc-bff:<tag>`
- `ghcr.io/<owner>/vsvk-calc-api:<tag>`
- `ghcr.io/<owner>/vsvk-keycloak:<tag>` (bevat het VSVK-login-thema)
