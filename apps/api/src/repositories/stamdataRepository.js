const ARTICLE_SELECT = `
  select
    a.id,
    a.artikelnummer,
    a.omschrijving,
    a.korte_omschrijving,
    ge.code as gebruikseenheid,
    ks.code as kostensoort,
    av.vestiging_id,
    av.actief
  from catalogus.artikel a
  join catalogus.artikel_vestiging av on av.artikel_id = a.id
  left join catalogus.eenheid ge on ge.id = a.gebruikseenheid_id
  left join catalogus.kostensoort ks on ks.id = a.kostensoort_id
`;

const DEBTOR_SELECT = `
  select
    d.id,
    d.debiteurnummer,
    d.naam,
    d.emailadres,
    o.naam as organisatie_naam,
    o.btw_nummer,
    dv.vestiging_id,
    dv.actief
  from relatie.debiteur d
  join relatie.organisatie o on o.id = d.organisatie_id
  join relatie.debiteur_vestiging dv on dv.debiteur_id = d.id
`;

const EMPLOYEE_SELECT = `
  select
    m.id,
    m.medewerkercode,
    m.weergavenaam,
    d.id as dienstverband_id,
    d.vestiging_id,
    d.functie,
    d.type,
    d.fte,
    d.geldig_van,
    d.geldig_tot
  from resource.medewerker m
  join resource.dienstverband d on d.medewerker_id = m.id
`;

export async function listArtikelen(client) {
  const result = await client.query(`${ARTICLE_SELECT} where av.actief = true order by a.artikelnummer`);
  return result.rows;
}

export async function listDebiteuren(client) {
  const result = await client.query(`${DEBTOR_SELECT} where dv.actief = true order by d.debiteurnummer`);
  return result.rows;
}

export async function listWerknemers(client) {
  const result = await client.query(`${EMPLOYEE_SELECT} order by m.weergavenaam`);
  return result.rows;
}
