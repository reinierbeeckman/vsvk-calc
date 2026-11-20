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

De migratie maakt relationele tabellen voor artikelen, artikelcategorieën en artikeleenheden en maakt de tabel `user_information` voor profielgegevens. Bestaande artikelen worden eenmalig uit `instellingen_algemeen.data.artikelen` overgezet; als daar nog geen artikelcatalogus staat, wordt de huidige catalogus als startdata geladen. De oude JSONB-sleutel wordt na een geslaagde import verwijderd. De migratie is versie-geregistreerd en veilig opnieuw uit te voeren.

De SPA leest de catalogus via `GET /api/articles`, `GET /api/article-categories` en `GET /api/article-units`. Alleen `directie` kan artikelen aanpassen of deactiveren; categorieën en eenheden worden als referentiedata via hun eigen opzoektabellen geleverd.

In Planning zijn de bestaande gegevens van medewerkers, vaardigheden, klanten, contactpersonen, materieel, artikelen en tarieven bewerkbaar voor gebruikers met de Keycloak-rol `development` wanneer de ontwikkeltoegang aan staat. Opslaan vereist de laatst opgehaalde ETag; bij een conflict blijft de invoer behouden. Nog niet gekoppelde onderdelen blijven niet beschikbaar.

Planning toont per functie het meest recente standaardtarief met een ingangsdatum op of vóór vandaag (Nederlandse tijd). Gebruikers met de Keycloak-rol `directie` kunnen de prijs in de tarievenlijst wijzigen. In het klantvenster kunnen zij afwijkingen opslaan of verwijderen; een leeg veld betekent het standaardtarief. Bestaande afwijkingen zonder functiekoppeling blijven als historische tarieven zichtbaar en worden niet automatisch gekoppeld of overschreven.

De API biedt `GET`/`POST /api/planning/leveranciers`, `GET`/`PUT /api/planning/leveranciers/{id}`, `GET /api/planning/tarieven`, `GET`/`PUT /api/planning/tarieven/{id}/prijs` en `GET`/`PUT /api/planning/klanten/{id}/tarieven`. De leverancierslijst en -details zijn alleen beschikbaar voor Directie; alleen de lijst beperkt zich tot niet-gevoelige kerngegevens. Toevoegen en wijzigen van leveranciers is uitsluitend toegestaan in Development met `DevelopmentAccess:Enabled`, een geauthenticeerde applicatiegebruiker en de rol `development`. Leverancierswijzigingen gebruiken een sterke ETag uit GET als `If-Match`; ontbrekende, ongeldige of verouderde precondities worden niet als onbeperkte write geaccepteerd. Standaardprijzen en klanttarieven zijn afzonderlijk versiebeheerd: gebruik de sterke ETag uit de desbetreffende GET-response als `If-Match` bij PUT. Alle wijzigingen in `standaard_tarieven` en `klant_afwijkende_tarieven` moeten via deze versiecontrole lopen; directe databasewijzigingen omzeilen die beveiliging. Voer na het uitrollen de migratie uit voordat de nieuwe API wordt gebruikt. Op een bestaande database met de klanttabellen kan alleen de tariefmigratie worden uitgevoerd met dezelfde Compose-opties als hierboven en `--profile migrate run --rm --no-deps migrate --migrate-planning-tarieven`.

Voor uitsluitend de klant- en tariefstructuur, inclusief versiebeheer, gebruik `--profile migrate run --rm --no-deps migrate --migrate-planning-records` met dezelfde Compose-opties. Deze migratie voert geen overige kernmigraties uit.

Het weekplanbord gebruikt relationele tabellen voor `werkopdrachten`, `klussen`, `inzet`, `inhuurmedewerkers` en `werkbonnen`. De volledige `--migrate` voert deze uit nadat klanten, leveranciers en medewerkers zijn gemigreerd. Op een bestaande kerninstallatie kan de migratie gericht worden uitgevoerd met `--profile migrate run --rm --no-deps migrate --migrate-planning-board`. De oude `--migrate-planning-records` blijft bewust onafhankelijk van die kerntabellen. Lezen van het planbord is beschikbaar voor `planning` en `directie`; aanmaken en wijzigen, inclusief inhuurmedewerkers, vereist de Keycloak-rol `planning` in iedere omgeving. Werkopdrachten zijn versiebeheerde aggregates: PUT vereist de sterke ETag uit GET als `If-Match`, en klussen, inzet en werkbonnen worden atomair opgeslagen of teruggedraaid.

Bij de eerste aanmelding maakt `GET /api/user/profile` een leeg profiel aan met de UUID uit het gevalideerde Keycloak-token. De SPA stuurt gebruikers met een onvolledig profiel direct naar **Mijn profiel** en laat de overige tabbladen pas zien nadat het telefoonnummer en alternatieve e-mailadres zijn opgeslagen. Een digitale handtekening is optioneel. Profielwijzigingen gebruiken een strong ETag en vereisen `If-Match`, net als andere updates van bestaande gegevens.

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
| Artikelcatalogus lezen; artikelen toevoegen, wijzigen of deactiveren | Lezen: `default-roles-vsvk`; schrijven: `directie` |
| IBAN- en btw-gegevens van vestigingen inzien | `directie`, `finance` |

Ontbreekt bij een gebruiker buiten `directie` de vestigingsclaim, dan weigert de API de vestigingsgebonden calculatie-endpoints (`403`) in plaats van alle vestigingen te tonen. Ontbreekt `default-roles-vsvk` in het JWT, dan wordt applicatietoegang geweigerd. De API gebruikt de Keycloak-realmrol dus als expliciete gemeenschappelijke toegangspoort.

De realm-import definieert rollen en voorbeeldgebruikers alleen bij het initialiseren van een nieuwe realm. Een al bestaande realm met persistente Keycloak-database wordt niet automatisch bijgewerkt: voeg de rollen toe via **Realm roles** en wijs ze via **Users → Role mapping** toe. De voorbeeldaccounts zijn `employee1` (`operationeel`) en `manager1` (`directie`); de accountnamen zijn alleen voorbeelden en bepalen zelf geen rechten.

In de lokale Compose-ontwikkelomgeving krijgt een ingelogde gebruiker met `development` en `default-roles-vsvk` tijdelijk dezelfde effectieve rechten als `directie`, inclusief alle vestigingen en financiële gegevens. De API kent deze rechten centraal toe; de werkelijke Keycloak-rollen blijven ongewijzigd. BFF en API vereisen hiervoor zowel `ASPNETCORE_ENVIRONMENT=Development` als `DevelopmentAccess__Enabled=true`. De ontwikkel-BFF is uitsluitend op `127.0.0.1:8080` gepubliceerd; de API heeft geen gepubliceerde poort. Schakel deze ontwikkeloptie niet in voor een publiek bereikbare omgeving. In acceptatie en productie geldt de gebruikelijke rolverdeling. Alleen bestaande mutaties zijn beschikbaar; rechten creëren geen ontbrekende functionaliteit.

## CI/CD (GHCR)

Workflow: `.github/workflows/build-and-deploy.yml`

Benodigde GitHub Environment secrets:
- `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `DEPLOY_DIR`

Images:
- `ghcr.io/<owner>/vsvk-calc-bff:<tag>`
- `ghcr.io/<owner>/vsvk-calc-api:<tag>`
- `ghcr.io/<owner>/vsvk-keycloak:<tag>` (bevat het VSVK-login-thema)
