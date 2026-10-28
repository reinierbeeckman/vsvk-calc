# VSVK Calculatie & Offerte

Baseline van de calculatie- en offerte-app, als eerste applicatie op weg naar een
gedeelde enterprise datalaag (entiteiten + API gateway).

> Status: **baseline**. De code in `apps/calculatie/` is ongewijzigd overgenomen uit het
> oorspronkelijke artifact. Wijzigingen volgen in aparte commits/PR's.

## Lokaal draaien

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
| Calculaties, offertes, planning | Werkt, opgeslagen in `localStorage` van de browser |
| Cloud-opslag (`window.claude.use("db")`) | Niet beschikbaar, app valt na ca. 3 s terug op localStorage |
| Back-up downloaden (`"downloads"`) | Niet beschikbaar, geeft een melding |
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
