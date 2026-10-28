# Opslag-naad in `apps/calculatie/index.html`

Analyse van de huidige opslag, bedoeld als startpunt voor de `DataStore`-interface.
Regelnummers zijn indicatief (baseline).

## Huidige situatie

Er zijn twee opslagpaden, gekozen in `store.init()`:

- **cloud**: `window.claude.use("db")` (Firestore-achtige API: `collection().doc().set/get/update/delete/onSnapshot/acquire`)
- **local**: `localStorage` (sleutels `vsvk-calc-2027`, `vsvk-calc-2027-overzicht`, `vsvk-calc-2027-tab`)

### Aanroepen die vervangen moeten worden

| Functie | Doet nu | Nodig in de API |
|---|---|---|
| `store.init` | kiest cloud/local, abonneert op `calculaties` en `instellingen/algemeen` | `GET /calculaties`, `GET /instellingen` + wijzigingsnotificatie |
| `store.save(rec)` | `set` op `calculaties/{nummer}`, retry bij `unavailable` | `PUT /calculaties/{nummer}` met versie-controle |
| `store.del(nr)` | `delete` | `DELETE /calculaties/{nummer}` (overweeg soft delete + audit) |
| `store.setStatus` | `update` van status + data | `PATCH /calculaties/{nummer}` |
| `store.claim` | nummer toekennen met `acquire` (lock, ttl 5 s) | **server-side sequence**: `POST /calculaties` geeft het volgende nummer terug |
| `writeSettings` / `applySettings` / `scheduleSettings` | document `instellingen/algemeen` (max ca. 240 kB) | aparte entiteiten, zie hieronder |
| `makeBackup` / `restoreBackup` | `claude.use("downloads")`, JSON-export | gewone browser-download of server-side export |
| `onSnapshot` (realtime) | live bijwerken van het overzicht | polling, SSE of websocket |

### Datavorm van een calculatie-record

```
nummer, projectnaam, klant, datum, door, vestiging, status, bedrag, bijgewerkt,
data   (JSON-string met project, klant, blocks, offerte, teksten, plan, planning, status, afronding)
```

`data` is nu een JSON-string. Voor een echte datalaag: opsplitsen in entiteiten
(Klant, Project/Calculatie, Blok, Regel, Offerte, Planningsitem) en `bedrag` niet
opslaan maar afleiden, of bewust als snapshot bij status `Verstuurd`.

### Instellingen die eigenlijk stamdata zijn

`artikelen`, `vestigingen`, `medewerkers`, `onderdelen`, `sugg`, `teksten`, `standaard`
(btw, website, geldig, betaal). Deze zitten nu in een gedeeld document. In de datalaag worden
dit eigen entiteiten met eigen autorisatie. Let op: de melding over "handtekeningen" in
`writeSettings` wijst erop dat medewerker-handtekeningen (afbeeldingen) in de instellingen zitten.
Dat zijn persoonsgegevens en horen niet in een JSON-blob van 240 kB.

## Voorgestelde interface

```js
const DataStore = {
  async list(collection, query),
  async get(collection, id),
  async save(collection, record, { ifVersion }),
  async remove(collection, id),
  async nextNumber(collection),          // vervangt claim()
  subscribe(collection, callback),       // vervangt onSnapshot
};
```

Implementaties: `LocalStore` (huidig), `GatewayStore` (HTTP naar API gateway).
`ClaudeDbStore` is niet nodig in deze repo, de cloud-db wordt verwijderd.

## Overige externe afhankelijkheden

- `cdnjs.cloudflare.com/.../pdfmake@0.2.10` (pdf-export): voor corporate gebruik lokaal vendoren of via eigen artifact-registry
- `fonts.googleapis.com` (Archivo Black, Overpass): idem, en privacy-technisch aandachtspunt (IP naar Google)
