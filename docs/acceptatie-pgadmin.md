# Acceptatiedatabase bekijken met pgAdmin

Deze instructie gebruikt pgAdmin in een Docker-container en de ingebouwde
SSH-tunnel. De PostgreSQL-poort hoeft niet op de server te worden gepubliceerd.

## 1. Gegevens opzoeken

Verbind de computer met de bedrijfs-VPN en maak verbinding met de server:

```powershell
ssh vsvktools@10.139.15.100
```

Zoek op de server het huidige IP-adres van de PostgreSQL-container:

```bash
docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{"\n"}}{{end}}' vsvk-calc-postgres-1
```

Het container-IP kan veranderen na het opnieuw aanmaken van de container. Bij
meerdere adressen: vraag de beheerder welk adres bij het database-netwerk hoort.

De oorspronkelijke databasegebruiker en -naam zijn op te vragen met:

```bash
docker exec vsvk-calc-postgres-1 printenv POSTGRES_USER POSTGRES_DB
```

In de bestaande installatie waren dit respectievelijk `vsvk_acc` en
`vsvk_calc_acc`. Vraag de beheerder bij voorkeur om een afzonderlijk
alleen-lezen databaseaccount. De oorspronkelijke gebruiker kan meer rechten
hebben en de ingestelde gegevens kunnen later zijn gewijzigd.

## 2. Verbinden in pgAdmin

Kies **Register > Server** en vul in:

| Tabblad | Veld | Waarde |
| --- | --- | --- |
| General | Name | Bijvoorbeeld `VSVK acceptatie` |
| Connection | Host name/address | Het gevonden PostgreSQL-container-IP |
| Connection | Port | `5432` |
| Connection | Maintenance database | `vsvk_calc_acc`, of de actuele databasenaam |
| Connection | Username | De databasegebruiker |
| Connection | Password | Het wachtwoord van die databasegebruiker |
| SSH Tunnel | Use SSH tunneling | Yes |
| SSH Tunnel | Tunnel host | `10.139.15.100` |
| SSH Tunnel | Tunnel port | `22` |
| SSH Tunnel | Username | `vsvktools` |
| SSH Tunnel | Authentication | De toegestane SSH-authenticatiemethode |

Klik op **Save**. pgAdmin opent zelf de tunnel; een afzonderlijk
`ssh -L`-commando is niet nodig. Gebruik je een privésleutel, dan moet die
veilig beschikbaar zijn binnen de pgAdmin-container.

De SSH-gebruiker en het SSH-wachtwoord zijn niet hetzelfde als de
databasegebruiker en het databasewachtwoord. Vraag wachtwoorden aan de
beheerder; deel ze niet en sla ze niet op in deze documentatie.

## 3. Tabellen bekijken

Open in pgAdmin **Databases > vsvk_calc_acc > Schemas > public > Tables**.
Gebruik bij voorkeur het alleen-lezen account om gegevens te bekijken.

Bij een timeout: controleer de VPN, of de pgAdmin-container de SSH-server kan
bereiken, en of het container-IP nog klopt. Bij `password authentication
failed`: controleer de databasegebruiker en het bijbehorende wachtwoord bij
**Connection**, niet alleen de SSH-gegevens.
