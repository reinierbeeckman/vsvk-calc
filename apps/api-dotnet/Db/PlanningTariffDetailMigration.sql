create or replace function planning_bump_shared_rate_versions() returns trigger
language plpgsql as $$
begin
  if new.naam is distinct from old.naam or new.aan is distinct from old.aan then
    execute format('update %I.standaard_tarieven set version = version + 1 where functie_id = $1', tg_table_schema)
      using new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists planning_bump_shared_rate_versions on functies;
create trigger planning_bump_shared_rate_versions
  after update of naam, aan on functies
  for each row execute function planning_bump_shared_rate_versions();
