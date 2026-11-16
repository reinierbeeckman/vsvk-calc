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
- Planning-lijsten: http://localhost:8080/planning/
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
- `apps/planning/` — beperkte planning-lijsten-SPA
- `apps/shared/` — gedeelde header en stijlen voor de applicaties
- `apps/bff/` — YARP BFF
- `apps/api-dotnet/` — REST API
- `deploy/compose/` — compose files per environment
- `deploy/env/` — environment templates

## Security-afspraken

- Geen secrets in code of git.
- Gebruik altijd `--env-file deploy/env/.env` bij compose.
- Scheid app-database en Keycloak-database credentials.

Meer deployment-details: `deploy/README.md`.

## Applicatielayout

Gebruik voor nieuwe applicaties de gedeelde `/shared/layout.css` en `/shared/header.js`. Plaats een element met `data-vsvk-header`, `data-application` en `data-title` vóór het headerscript en zet de applicatienavigatie daarin als `nav.tabs`. Voeg applicaties en hun URL toe aan de applicatiewisselaar in het gedeelde headerscript. De header haalt de ingelogde gebruiker via de BFF op; applicaties met een eigen authenticatie-initialisatie kunnen `data-account="external"` gebruiken. Plaats algemene headeropmaak in de gedeelde stylesheet en schermspecifieke opmaak in een afzonderlijke stylesheet van de applicatie.

Lijsten met een `table` direct binnen `.scroll` krijgen automatisch de gedeelde hoverkleur. Offerteprijstabellen (`.price`), planningstabellen (`.plan`) en bevestigingsregels (`.confirm-row`) zijn hiervan uitgezonderd.

`npm run dev` serveert de statische bestanden voor ontwikkeling; voor authenticatie en databasegegevens is de BFF-stack nodig. Controleer de gedeelde header met `npm test`.

## Planning-lijsten

De lijsten tonen bestaande medewerkersprofielen, klanten, materieel en artikelen via de BFF. Planning en directie met applicatietoegang kunnen medewerkers en materieel binnen hun vestigingsscope zien; directie ziet alle vestigingen. Omdat klanten nog niet aan een vestiging zijn gekoppeld, zijn de klantenlijst en klantdetails voorlopig alleen toegankelijk voor directie. Klantdetails bevatten contactpersonen en facturatiegegevens; de afwijkende tarieven zijn nog niet gekoppeld. Alleen de medewerkerstatus kan in dit scherm worden gewijzigd. Artikelen gebruiken de bestaande catalogus en toegangsregels. Een medewerker verschijnt pas nadat zijn Keycloak-profiel in de database bestaat. Nieuwe medewerkers, overige medewerkergegevens, klant- en materieelbewerkingen en aanvullende planningvelden volgen later.

Voer na deployment de migratie uit zoals hierboven beschreven. Deze maakt ook de klanttabellen als ze nog niet bestaan en laat bestaande records intact. De migratie voegt `user_information.is_active` toe met standaardwaarde `true`; eerder verwijderde statuswaarden kunnen niet automatisch worden hersteld. Controleer daarom de status van bestaande medewerkers. Bij een gelijktijdige wijziging blijft de gemaakte statuskeuze staan en moet de gebruiker na vergelijking zelf opnieuw opslaan.
