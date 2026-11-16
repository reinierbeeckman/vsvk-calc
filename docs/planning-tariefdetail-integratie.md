# Planning-tariefdetail: integratie

Het tariefdetail is aangesloten op de API en Planning. De migratie `--migrate-planning-records` voert [PlanningTariffDetailMigration.sql](../apps/api-dotnet/Db/PlanningTariffDetailMigration.sql) uit nadat de tarieftabellen bestaan. Zonder deze trigger zijn versies van tarieven met dezelfde functie niet veilig. Stop schrijvers tijdens de uitrol en activeer de nieuwe route pas na succesvolle migratie.

Het endpoint vereist een geauthenticeerde gebruiker met `development` en applicatietoegang (`default-roles-vsvk`), de ASP.NET-omgeving `Development` en `DevelopmentAccess:Enabled=true` in de API. Een directierol alleen verleent geen toegang. Bij een conflict blijft de invoer behouden en kan de gebruiker de laatste waarden vergelijken en zelf opnieuw opslaan.

## HTTP-contract

`GET /api/planning/tarieven/{standaardTariefId}/detail` geeft `200`, `Cache-Control: private, no-store`, een sterke `ETag`-header en bijvoorbeeld:

```json
{"id": 12, "functieId": 3, "functie": "Machinist", "actief": true, "prijs": 55.25, "eenheid": "uur", "geldigVanaf": "2026-01-01", "version": 2, "eTag": "\"2\""}
```

`PUT` naar dezelfde URL vereist de exact ontvangen `If-Match`-header en alle velden:

```json
{"functie": "Machinist", "actief": true, "prijs": 55.25, "eenheid": "uur", "geldigVanaf": "2026-01-01"}
```

Functie en eenheid zijn verplicht en worden bij opslaan getrimd; maximaal 255 respectievelijk 50 tekens, zonder controletekens. Prijs is verplicht, niet negatief, kleiner dan 100000000 en heeft maximaal twee decimalen. Actief en geldigVanaf zijn verplicht; geldigVanaf gebruikt `YYYY-MM-DD`. Een geslaagde update geeft het volledige detail met de nieuwe `ETag`-header. `400`: ongeldige invoer, ID of ETag; `401`: niet aangemeld; `403`: geen toegang; `404`: tarief bestaat niet; `412`: verouderde versie; `428`: `If-Match` ontbreekt.

De ETag is een ondoorzichtige waarde. Detail en de bestaande `/prijs`-route gebruiken dezelfde tariefversie. Een functienaam- of statuswijziging verhoogt óók de versies van alle andere tarieven met die functie. De versie kan meer dan één keer stijgen. Controleer nooit op een specifieke increment. `functieId` wordt niet gewijzigd; de functie zelf wordt gedeeld, inclusief eventuele klanttarieven die ernaar verwijzen.

Alle toekomstige of externe schrijvers van functies en tarieven moeten dezelfde regels volgen: vergrendel bij functiewijzigingen eerst de functie, controleer vervolgens atomair de tariefversie en update het gehele aggregaat in één transactie. De trigger invalideert betrokken tariefversies, maar is geen vervanging voor een `If-Match`-controle bij een eigen schrijfpad. Voorkom ongecontroleerde SQL-schrijvers en wijzigingen van functie-id zonder versiecontrole. Breng geen oude instance zonder deze migratie of met onvoorwaardelijke schrijfpaden online naast deze versie.

## Testen

De HTTP-tests gebruiken een geïsoleerde in-memory service en starten geen Docker. De PostgreSQL-test gebruikt uitsluitend een expliciet ingestelde `VSVK_TARIFF_TEST_POSTGRES`-connectionstring, maakt een tijdelijk schema aan en verwijdert dat weer. Gebruik een wegwerpdatabase en een account dat schema's mag maken en verwijderen. Draai de `PlanningTariffDetail`-tests tegen een lokale PostgreSQL; zij controleren ook de bestaande prijsupdate, gedeelde functies, twee gelijktijdige schrijvers en rollback.
