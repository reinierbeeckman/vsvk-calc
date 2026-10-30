# VSVK Calculatie & Offerte

Baseline van de calculatie- en offerte-app, als eerste applicatie op weg naar een
gedeelde enterprise datalaag (entiteiten + API gateway).

> Status: **in ontwikkeling**. `apps/calculatie/` is aangepast om via de BFF `/api/*`
> te praten met de .NET API en data in Postgres op te slaan.

## Lokaal draaien

Er zijn nu 2 manieren om lokaal te draaien:

1. **Volledige stack (aanrader)** via Docker Compose: SPA + YARP BFF + .NET API + Keycloak + PostgreSQL.
2. **Alleen de SPA** (snelle frontend iteratie) via Node of een static server.

### Optie 1: Volledige stack (Docker Compose)

Vereist Docker Desktop (met Docker Compose v2).

Vanuit repo-root:

```bash
docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml up -d --build
docker compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml --profile migrate run --rm migrate
```

Als PowerShell meldt dat `docker` niet herkend wordt, herstart je terminal (of voeg Docker toe aan je PATH). Als workaround kun je ook het pad naar `docker.exe` direct aanroepen, bijvoorbeeld:

```powershell
& "C:\Users\<you>\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe" compose -f deploy/compose/docker-compose.yml -f deploy/compose/docker-compose.dev.yml up -d --build
```

Open daarna:

- App/BFF: http://localhost:8080
- Login start: http://localhost:8080/bff/login
- Keycloak: http://localhost:8081

Meer details staan in `deploy/README.md`.

### Optie 2: Alleen de SPA (zonder backend)

Vereist Node.js 20 of nieuwer.

```bash
npm install
npm run dev
# open http://localhost:8080
```

Alternatief zonder Node: `python3 -m http.server 8080 --directory apps/calculatie`.

Open de app **niet** via `file://`: de pdf-export haalt fonts op met `fetch("fonts/...")`
en dat werkt alleen via http.

## Wat werkt lokaal en wat niet

| Onderdeel | Lokaal gedrag |
|---|---|
| Calculaties, offertes, planning | Werkt. In de volledige stack opgeslagen in Postgres; zonder backend in `localStorage`. |
| Cloud-opslag (`window.claude.use("db")`) | Niet meer gebruikt; de app praat via `/api/*` met de backend. |
| Back-up downloaden | Werkt (normale browser-download). |
| PDF-export | Werkt als `cdnjs.cloudflare.com` bereikbaar is |
| Google Fonts | Optioneel, valt terug op Arial |

## Structuur

```
apps/calculatie/     de app (index.html + fonts/)
docs/storage-seam.md waar de opslag in de code zit en hoe die vervangen wordt
```

## Roadmap richting datalaag

1. Baseline vastleggen (deze commit)
2. Opslag achter een `DataStore`-interface (zie `docs/storage-seam.md`)
3. `GatewayStore` die via HTTP met de API gateway praat
4. Cloud-db-code verwijderen
5. Architectuurprincipes, security (authenticatie, MFA, autorisatie), beheer en CI/CD

## Werkafspraken (voorstel)

- `main` is beschermd: wijzigen via pull request met review
- Geen klantdata of back-ups in de repository
- Geen secrets in de code, gebruik `.env` (zie `.gitignore`)

