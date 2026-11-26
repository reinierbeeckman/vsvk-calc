# Acceptatie bijwerken via SSH en GHCR

Deze handleiding werkt de bestaande acceptatie-installatie bij naar de nieuwste
commit op GitHub `main`. De images voor die commit moeten eerst door de GitHub
Actions-build zijn gepubliceerd. De automatische deploy-job en zijn
SSH-secrets zijn hiervoor niet nodig.

## Vooraf

- Maak gecontroleerde back-ups van de applicatie- en Keycloak-database en
  spreek een onderhoudsmoment af. Controleer dat er tijdens de migratie geen
  andere processen naar de applicatiedatabase schrijven.
- Laat de beheerder de poortbinding beoordelen: op de bestaande server zijn
  8080 en 8081 op alle interfaces gepubliceerd, terwijl de oorspronkelijke
  handleiding een binding op `127.0.0.1` beschrijft.
- Verbind via VPN en SSH. Git moet de repository zonder interactieve prompt
  kunnen lezen en Docker moet toegang tot de GHCR-images hebben.
- Controleer dat de bestaande installatie de Compose-bestanden en deploymentmap
  uit onderstaande opdracht gebruikt. De lokale-only overlay wordt hierin niet
  toegepast; wijzig de poortconfiguratie niet ongemerkt.

## Update

Plak het volledige blok in de SSH-terminal:

```bash
(
set -eu
cd /home/vsvktools/vsvk-planning

compose() {
  docker compose --env-file .env -f docker-compose.yml -f docker-compose.staging.yml "$@"
}

if [ ! -w .env ] || [ "$(grep -c '^IMAGE_TAG=' .env || true)" -ne 1 ]; then
  echo "De .env moet schrijfbaar zijn en precies één IMAGE_TAG-regel bevatten." >&2
  exit 1
fi

ref=$(GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code https://github.com/reinierbeeckman/vsvk-calc.git refs/heads/main)
sha=${ref%%[[:space:]]*}
if ! printf '%s\n' "$sha" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Kon de commit-SHA van main niet bepalen." >&2
  exit 1
fi

unset GITHUB_REPOSITORY_OWNER
export IMAGE_TAG="$sha"

images=$(compose --profile migrate config --images)
for image in vsvk-calc-api vsvk-calc-bff vsvk-keycloak; do
  if ! printf '%s\n' "$images" | grep -Fxq "ghcr.io/reinierbeeckman/$image:$sha"; then
    echo "De Compose-configuratie gebruikt niet de verwachte image voor $image." >&2
    exit 1
  fi
done

echo "Release: $sha"
compose --profile migrate pull api bff keycloak migrate
compose stop bff api
compose --profile migrate run --rm --no-deps migrate

sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$sha/" .env
unset IMAGE_TAG

compose up -d --no-build
compose ps
)
```

Controleer daarna het inloggen en de gewijzigde functionaliteit in acceptatie.
Deel nooit de inhoud van `.env`, tokens, wachtwoorden of privésleutels.

Het blok stopt bij een fout. Als de nieuwste images ontbreken of GHCR-toegang
ontbreekt, faalt `pull` voordat de applicatie wordt gestopt. Als de migratie
faalt, kunnen BFF en API gestopt blijven: overleg over databaseherstel voordat
je opnieuw start. Zet niet automatisch de oude images terug na een migratie;
de databasestructuur kan inmiddels gewijzigd zijn.

PGAdmin benaderen

docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{"\n"}}{{end}}' vsvk-calc-postgres-1

ssh -N -L 127.0.0.1:15432:172.18.0.2:5432 vsvktools@vit-nlpij-ai-1

wachtwoord opvragen
cd /home/vsvktools/vsvk-planning
nano .env

Voor pgAdmin in Docker, gebruik de ingebouwde SSH-tunnel zoals beschreven in
[Acceptatiedatabase bekijken met pgAdmin](./acceptatie-pgadmin.md).

Claims user tonen
https://vsvk-acc.vsvk.nl/bff/user
