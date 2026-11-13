# Importeert de materieelstamdata uit "Materieel alle kolommen.xlsx".
# Zonder -Apply toont het script alleen een preview. Met -Apply vervangt het
# de volledige inhoud van public.materieel en public.materieelgroep atomair.
[CmdletBinding()]
param(
  [Parameter()]
  [string] $WorkbookPath,

  [Parameter()]
  [switch] $Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeBase = Join-Path $repoRoot 'deploy/compose/docker-compose.yml'
$composeDev = Join-Path $repoRoot 'deploy/compose/docker-compose.dev.yml'
$envFile = Join-Path $repoRoot 'deploy/env/.env'
$defaultDbUser = 'vsvk'
$defaultDbName = 'vsvk_calc'

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) {
  $downloadFolder = Join-Path $env:USERPROFILE 'Downloads/fwtabellenvoorapp'
  $normalName = Join-Path $downloadFolder 'Materieel alle kolommen.xlsx'
  $observedName = Join-Path $downloadFolder 'Materieel alle kolommmen.xlsx'
  if (Test-Path -LiteralPath $normalName -PathType Leaf) { $WorkbookPath = $normalName }
  elseif (Test-Path -LiteralPath $observedName -PathType Leaf) { $WorkbookPath = $observedName }
  else { $WorkbookPath = Read-Host 'Pad naar Materieel alle kolommen.xlsx' }
}
if (-not (Test-Path -LiteralPath $WorkbookPath -PathType Leaf)) {
  throw "Werkmap niet gevonden: $WorkbookPath"
}
if (-not (Test-Path -LiteralPath $composeBase -PathType Leaf) -or
    -not (Test-Path -LiteralPath $composeDev -PathType Leaf)) {
  throw 'De Docker Compose-bestanden voor de solution ontbreken.'
}

function Get-ZipEntryText {
  param(
    [Parameter(Mandatory)] [System.IO.Compression.ZipArchive] $Archive,
    [Parameter(Mandatory)] [string] $Name
  )

  $entry = $Archive.GetEntry($Name)
  if ($null -eq $entry) { throw "XLSX-onderdeel ontbreekt: $Name" }
  $reader = [System.IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() }
  finally { $reader.Dispose() }
}

function Get-ColumnNumber {
  param([Parameter(Mandatory)] [string] $CellReference)

  $letters = [regex]::Match($CellReference, '^[A-Z]+').Value
  if ([string]::IsNullOrWhiteSpace($letters)) { throw "Ongeldige XLSX-celverwijzing: $CellReference" }
  $number = 0
  foreach ($letter in $letters.ToCharArray()) {
    $number = ($number * 26) + ([int]$letter - [int][char]'A' + 1)
  }
  return $number
}

function Normalize-Header {
  param([AllowNull()] [string] $Value)

  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  $decomposed = $Value.Normalize([Text.NormalizationForm]::FormD)
  $withoutMarks = [regex]::Replace($decomposed, '\p{Mn}', '')
  return ([regex]::Replace($withoutMarks.ToLowerInvariant(), '[^\p{L}\p{N}]+', ' ')).Trim()
}

function Read-MaterieelWorkbook {
  param([Parameter(Mandatory)] [string] $Path)

  $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  try {
    $workbook = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/workbook.xml')
    $workbookNs = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
    $workbookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $relationshipXml = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/_rels/workbook.xml.rels')
    $relationshipNs = [System.Xml.XmlNamespaceManager]::new($relationshipXml.NameTable)
    $relationshipNs.AddNamespace('p', 'http://schemas.openxmlformats.org/package/2006/relationships')

    $sheet = $workbook.SelectSingleNode('/x:workbook/x:sheets/x:sheet[1]', $workbookNs)
    if ($null -eq $sheet) { throw 'De werkmap bevat geen werkblad.' }
    $relationshipId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relationship = $relationshipXml.SelectSingleNode("/p:Relationships/p:Relationship[@Id='$relationshipId']", $relationshipNs)
    if ($null -eq $relationship) { throw 'De relatie voor het eerste werkblad ontbreekt.' }
    $sheetPath = $relationship.GetAttribute('Target').TrimStart('/')
    if (-not $sheetPath.StartsWith('xl/', [StringComparison]::OrdinalIgnoreCase)) {
      $sheetPath = "xl/$sheetPath"
    }

    $sharedStrings = [System.Collections.Generic.List[string]]::new()
    if ($null -ne $archive.GetEntry('xl/sharedStrings.xml')) {
      $shared = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/sharedStrings.xml')
      $sharedNs = [System.Xml.XmlNamespaceManager]::new($shared.NameTable)
      $sharedNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
      foreach ($item in $shared.SelectNodes('/x:sst/x:si', $sharedNs)) {
        $parts = foreach ($textNode in $item.SelectNodes('.//x:t', $sharedNs)) { $textNode.InnerText }
        $sharedStrings.Add(($parts -join ''))
      }
    }

    $sheetXml = [xml](Get-ZipEntryText -Archive $archive -Name $sheetPath)
    $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
    $sheetNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $rows = [System.Collections.Generic.List[object]]::new()
    foreach ($rowNode in $sheetXml.SelectNodes('/x:worksheet/x:sheetData/x:row', $sheetNs)) {
      $values = @{}
      foreach ($cell in $rowNode.SelectNodes('x:c', $sheetNs)) {
        $column = Get-ColumnNumber -CellReference $cell.GetAttribute('r')
        $type = $cell.GetAttribute('t')
        $valueNode = $cell.SelectSingleNode('x:v', $sheetNs)
        $value = ''
        if ($type -eq 's' -and $null -ne $valueNode) {
          $sharedIndex = [int]$valueNode.InnerText
          if ($sharedIndex -lt 0 -or $sharedIndex -ge $sharedStrings.Count) {
            throw "Ongeldige shared-stringindex in cel $($cell.GetAttribute('r'))."
          }
          $value = $sharedStrings[$sharedIndex]
        }
        elseif ($type -eq 'inlineStr') {
          $textParts = foreach ($textNode in $cell.SelectNodes('x:is//x:t', $sheetNs)) { $textNode.InnerText }
          $value = $textParts -join ''
        }
        elseif ($null -ne $valueNode) {
          $value = $valueNode.InnerText
        }
        $values[$column] = [string]$value
      }
      $rows.Add([pscustomobject]@{ RowNumber = [int]$rowNode.GetAttribute('r'); Values = $values })
    }

    if ($rows.Count -lt 2) { throw 'Het eerste werkblad bevat geen materieelgegevens.' }
    $headerMap = @{}
    foreach ($column in $rows[0].Values.Keys) {
      $headerMap[(Normalize-Header $rows[0].Values[$column])] = [int]$column
    }
    $requiredColumns = @{
      'zoeknaam' = 1
      'omschrijving' = 3
      'merk' = 6
      'standplaats' = 8
      'kenteken' = 11
      'serienummer' = 18
      'materieelgroep' = 27
    }
    foreach ($header in $requiredColumns.Keys) {
      if (-not $headerMap.ContainsKey($header) -or $headerMap[$header] -ne $requiredColumns[$header]) {
        throw "Kolom '$header' ontbreekt of staat niet op de verwachte plek. Verwacht A, C, F, H, K, R en AA conform de bronopzet."
      }
    }

    return [pscustomobject]@{
      SheetName = $sheet.GetAttribute('name')
      Rows = @($rows | Select-Object -Skip 1)
    }
  }
  finally { $archive.Dispose() }
}

function Get-CellText {
  param([Parameter(Mandatory)] $Row, [Parameter(Mandatory)] [int] $Column)
  if ($Row.Values.ContainsKey($Column)) { return ([string]$Row.Values[$Column]).Trim() }
  return ''
}

function Get-BranchKey {
  param([AllowNull()] [string] $Name)
  if ([string]::IsNullOrWhiteSpace($Name)) { return '' }
  $normalized = [regex]::Replace($Name.Trim(), '^vsvk\s+', '', 'IgnoreCase')
  $normalized = [regex]::Replace($normalized, '\s+b\.?v\.?$', '', 'IgnoreCase')
  return $normalized.Trim().ToLowerInvariant()
}

function ConvertTo-SqlLiteral {
  param([AllowNull()] [string] $Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return 'NULL' }
  return "'$(($Value.Trim()).Replace("'", "''"))'"
}

function Read-DotEnvValue {
  param([Parameter(Mandatory)] [string] $Path, [Parameter(Mandatory)] [string] $Name, [string] $Default)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $Default }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$") {
      return $matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $Default
}

function Invoke-AppDatabaseCommand {
  param([Parameter(Mandatory)] [string] $Sql)

  $composeArguments = @('compose')
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $composeArguments += @('--env-file', $envFile)
  }
  $composeArguments += @(
    '-f', $composeBase,
    '-f', $composeDev,
    'exec', '-T', 'postgres',
    'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', $script:appDbUser, '-d', $script:appDbName, '--file=-'
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = $Sql | & docker @composeArguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "PostgreSQL-actie mislukt: $($output -join ' ')"
  }
  return @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
}

function Invoke-AppMigrations {
  $composeArguments = @('compose')
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $composeArguments += @('--env-file', $envFile)
  }
  $composeArguments += @(
    '-f', $composeBase,
    '-f', $composeDev,
    'run', '--rm', '--build', 'migrate'
  )

  Write-Host 'De materieeltabellen ontbreken. De actuele API-migratie wordt nu gebouwd en uitgevoerd.'
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @composeArguments 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($exitCode -ne 0) {
    throw "De databasemigratie is mislukt: $($output -join ' ')"
  }
  foreach ($line in $output) { Write-Host ([string]$line) }
}

$script:appDbUser = Read-DotEnvValue -Path $envFile -Name 'PGUSER' -Default $defaultDbUser
$script:appDbName = Read-DotEnvValue -Path $envFile -Name 'PGDATABASE' -Default $defaultDbName
$workbook = Read-MaterieelWorkbook -Path $WorkbookPath
$records = [System.Collections.Generic.List[object]]::new()
$skippedEmptyRows = 0
foreach ($row in $workbook.Rows) {
  $record = [pscustomobject]@{
    SourceRow = $row.RowNumber
    Zoeknaam = Get-CellText -Row $row -Column 1
    Omschrijving = Get-CellText -Row $row -Column 3
    Merk = Get-CellText -Row $row -Column 6
    Standplaats = Get-CellText -Row $row -Column 8
    Kenteken = Get-CellText -Row $row -Column 11
    Serienummer = Get-CellText -Row $row -Column 18
    Materieelgroep = Get-CellText -Row $row -Column 27
  }
  if (@($record.Zoeknaam, $record.Omschrijving, $record.Merk, $record.Standplaats, $record.Kenteken, $record.Serienummer, $record.Materieelgroep | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -eq 0) {
    $skippedEmptyRows++
    continue
  }
  $records.Add($record)
}
if ($records.Count -eq 0) { throw 'De werkmap bevat geen importeerbare materieelregels; de database blijft ongewijzigd.' }

$schemaSql = @'
select (to_regclass('public.materieel') is not null
    and to_regclass('public.materieelgroep') is not null)::text;
'@
$schemaLines = @(Invoke-AppDatabaseCommand -Sql $schemaSql)
if ($schemaLines.Count -eq 0 -or $schemaLines[-1] -notin @('t', 'true')) {
  Invoke-AppMigrations
  $schemaLines = @(Invoke-AppDatabaseCommand -Sql $schemaSql)
  if ($schemaLines.Count -eq 0 -or $schemaLines[-1] -notin @('t', 'true')) {
    throw "De API-migratie is uitgevoerd, maar de materieeltabellen ontbreken nog steeds in database '$script:appDbName'. Controleer of de API en dit script dezelfde PostgreSQL-database gebruiken."
  }
}

$branchSql = @'
select coalesce(json_agg(json_build_object('id', id::text, 'naam', naam))::text, '[]')
from public.vestigingen;
'@
$branchLines = @(Invoke-AppDatabaseCommand -Sql $branchSql)
if ($branchLines.Count -eq 0) { throw 'De vestigingen konden niet uit PostgreSQL worden gelezen.' }
try {
  $parsedBranches = ConvertFrom-Json -InputObject $branchLines[-1]
  if ($parsedBranches -is [array]) { $branches = $parsedBranches }
  else { $branches = @($parsedBranches) }
}
catch { throw "Vestigingen uit PostgreSQL konden niet worden gelezen: $($_.Exception.Message)" }
$branchIdsByName = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($branch in $branches) {
  $key = Get-BranchKey -Name ([string]$branch.naam)
  if ($branchIdsByName.ContainsKey($key)) { throw "Meerdere vestigingen hebben dezelfde standplaatsnaam '$key'." }
  $branchIdsByName[$key] = [string]$branch.id
}
$unknownLocations = @(
  $records |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_.Standplaats) } |
    ForEach-Object { $_.Standplaats } |
    Sort-Object -Unique |
    Where-Object { -not $branchIdsByName.ContainsKey((Get-BranchKey -Name $_)) }
)
if ($unknownLocations.Count -gt 0) {
  throw "Standplaatsen zonder vestiging-match: $($unknownLocations -join ', '). De import is niet uitgevoerd."
}

$countsSql = @'
select (select count(*) from public.materieel)::text || '|' ||
       (select count(*) from public.materieelgroep)::text;
'@
$countLines = @(Invoke-AppDatabaseCommand -Sql $countsSql)
$existingCounts = if ($countLines.Count -gt 0) { $countLines[-1].Split('|') } else { @('0', '0') }
$uniqueGroups = @($records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Materieelgroep) } | ForEach-Object { $_.Materieelgroep.Trim() } | Sort-Object -Unique)
$blankLocations = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.Standplaats) }).Count
$blankGroups = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.Materieelgroep) }).Count
$blankDescriptions = @($records | Where-Object { [string]::IsNullOrWhiteSpace($_.Omschrijving) }).Count

Write-Host "Bron: $((Resolve-Path -LiteralPath $WorkbookPath).Path)"
Write-Host "Werkblad: $($workbook.SheetName); zoeknaam A; omschrijving C; merk F; standplaats H; kenteken K; serienummer R; materieelgroep-omschrijving AA."
Write-Host "In te lezen materieelregels: $($records.Count); lege regels overgeslagen: $skippedEmptyRows."
Write-Host "Materieelgroepen uit kolom AA: $($uniqueGroups.Count); zonder groep: $blankGroups; zonder omschrijving: $blankDescriptions; zonder standplaats: $blankLocations."
Write-Host "Standplaatswaarden gekoppeld aan bestaande vestigingen: $(@($records | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Standplaats) } | ForEach-Object { Get-BranchKey -Name $_.Standplaats } | Sort-Object -Unique).Count)."
Write-Host "Huidige database: $($existingCounts[0]) materieelregels en $($existingCounts[1]) materieelgroepen."
Write-Host 'Bij -Apply worden beide tabellen volledig vervangen in een transactie; materieel-id en materieelgroep-id worden door PostgreSQL gegenereerd.'

if (-not $Apply) {
  Write-Host 'Preview klaar; PostgreSQL is niet gewijzigd. Voeg -Apply toe om de volledige vervanging uit te voeren.'
  return
}

$confirmation = "Verwijder $($existingCounts[0]) bestaande materieelregels en $($existingCounts[1]) materieelgroepen en importeer $($records.Count) regels met $($uniqueGroups.Count) groepen? Typ JA om door te gaan"
if ((Read-Host $confirmation) -cne 'JA') {
  Write-Host 'Afgebroken; PostgreSQL is niet gewijzigd.'
  return
}

$values = [System.Collections.Generic.List[string]]::new()
foreach ($record in $records) {
  $values.Add("($($record.SourceRow), $(ConvertTo-SqlLiteral $record.Zoeknaam), $(ConvertTo-SqlLiteral $record.Omschrijving), $(ConvertTo-SqlLiteral $record.Standplaats), $(ConvertTo-SqlLiteral $record.Merk), $(ConvertTo-SqlLiteral $record.Kenteken), $(ConvertTo-SqlLiteral $record.Serienummer), $(ConvertTo-SqlLiteral $record.Materieelgroep))")
}

$sql = @'
begin;
set local client_min_messages = warning;
create temporary table import_materieel (
  source_row integer primary key,
  zoeknaam text null,
  omschrijving text null,
  standplaats text null,
  merk text null,
  kenteken text null,
  serienummer text null,
  materieelgroep_omschrijving text null
) on commit drop;
'@
$sql += "`ninsert into import_materieel(source_row, zoeknaam, omschrijving, standplaats, merk, kenteken, serienummer, materieelgroep_omschrijving) values $($values -join ', ');"
$sql += @'

do $import$
declare
  unmatched_locations text;
begin
  select string_agg(distinct btrim(source.standplaats), ', ')
  into unmatched_locations
  from import_materieel source
  where nullif(btrim(source.standplaats), '') is not null
    and (
      select count(*)
      from public.vestigingen branch
      where lower(regexp_replace(
        regexp_replace(btrim(branch.naam), '^vsvk[[:space:]]+', '', 'i'),
        '[[:space:]]+b\.?v\.?$', '', 'i'
      )) = lower(btrim(source.standplaats))
    ) <> 1;
  if unmatched_locations is not null then
    raise exception 'Standplaatsen zonder unieke vestiging-match: %', unmatched_locations;
  end if;
end
$import$;

delete from public.materieel;
delete from public.materieelgroep;

insert into public.materieelgroep(omschrijving)
select min(btrim(source.materieelgroep_omschrijving))
from import_materieel source
where nullif(btrim(source.materieelgroep_omschrijving), '') is not null
group by lower(btrim(source.materieelgroep_omschrijving));

insert into public.materieel(
  kenteken,
  omschrijving,
  standplaats_id,
  merk,
  zoeknaam,
  serienummer,
  materieelgroep_id
)
select
  nullif(btrim(source.kenteken), ''),
  nullif(btrim(source.omschrijving), ''),
  branch.id,
  nullif(btrim(source.merk), ''),
  nullif(btrim(source.zoeknaam), ''),
  nullif(btrim(source.serienummer), ''),
  materieel_group.id
from import_materieel source
left join lateral (
  select branch_candidate.id
  from public.vestigingen branch_candidate
  where lower(regexp_replace(
    regexp_replace(btrim(branch_candidate.naam), '^vsvk[[:space:]]+', '', 'i'),
    '[[:space:]]+b\.?v\.?$', '', 'i'
  )) = lower(btrim(source.standplaats))
) branch on true
left join public.materieelgroep materieel_group
  on lower(btrim(materieel_group.omschrijving)) = lower(btrim(source.materieelgroep_omschrijving));

commit;
select 'IMPORT_DONE|' || (select count(*)::text from public.materieel) || '|' ||
       (select count(*)::text from public.materieelgroep);
'@

$result = Invoke-AppDatabaseCommand -Sql $sql
$completion = @($result | Where-Object { $_ -match '^IMPORT_DONE\|' })
if ($completion.Count -ne 1) { throw "Import uitgevoerd, maar het resultaat kon niet worden bevestigd: $($result -join ' ')" }
$completionParts = $completion[0].Split('|')
Write-Host "Import voltooid: $($completionParts[1]) materieelregels en $($completionParts[2]) materieelgroepen."
