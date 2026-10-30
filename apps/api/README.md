> **LEGACY / referentie-implementatie**
>
> Deze map (`apps/api`) bevat de oorspronkelijke Node/Express API.
> De huidige BFF-architectuur gebruikt:
>
> - YARP BFF: `apps/bff`
> - Downstream .NET API: `apps/api-dotnet`
>
> Voor lokaal draaien: zie `deploy/README.md`.
# VSVK API (stamdata + databaselaag)

Deze map bevat een minimale API-laag die **stamdata** uitleest uit PostgreSQL, conform het technisch ontwerp:

- Geen directe database-toegang vanuit een browser/app
- Vestigings- en bedrijfsscope enforced in de backend
- Row Level Security (RLS) actief in de database

## Snel starten

1) Installeer dependencies:

```bash
cd apps/api
npm install
```

2) Zet environment variabelen:

- `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- `JWT_SECRET`

3) Run migraties:

```bash
npm run migrate
```

4) Start API:

```bash
npm run dev
```

## AuthZ / scope

De API verwacht een `Authorization: Bearer <jwt>`.

JWT payload (minimaal):

```json
{
  "sub": "user-123",
  "company_id": "<uuid>",
  "branch_ids": ["<uuid>", "<uuid>"],
  "permissions": ["stamdata.read"]
}
```

De backend zet deze waarden per request in PostgreSQL session settings:

- `app.company_id`
- `app.branch_ids`

RLS policies gebruiken deze om rijen buiten scope te blokkeren.

## Endpoints

- `GET /health`
- `GET /api/stamdata/artikelen`
- `GET /api/stamdata/debiteuren`
- `GET /api/stamdata/werknemers`

