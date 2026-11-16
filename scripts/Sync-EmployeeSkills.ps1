# Synchroniseert de medewerker-opleidingen uit "Opleidingen alle kolommen.xlsx"
# naar de koppeltabel public.user_skills. Zonder -Apply wordt alleen een preview getoond.
[CmdletBinding()]
param(
  [Parameter()]
  [string] $WorkbookPath,

  [Parameter()]
  [string] $MappingPath = 'employee-skills-koppelingen.csv',

  [Parameter()]
  [switch] $MaakKoppelingen,

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
  $WorkbookPath = Read-Host 'Pad naar Opleidingen alle kolommen.xlsx'
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

function Read-TrainingWorkbook {
  param([Parameter(Mandatory)] [string] $Path)

  $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  try {
    $workbook = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/workbook.xml')
    $workbookNs = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
    $workbookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $relationshipXml = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/_rels/workbook.xml.rels')
    $relationshipNs = [System.Xml.XmlNamespaceManager]::new($relationshipXml.NameTable)
    $relationshipNs.AddNamespace('p', 'http://schemas.openxmlformats.org/package/2006/relationships')

    $sheet = $workbook.SelectSingleNode("/x:workbook/x:sheets/x:sheet[@name='Opleiding']", $workbookNs)
    if ($null -eq $sheet) { throw "Werkblad 'Opleiding' niet gevonden." }
    $relationshipId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relationship = $relationshipXml.SelectSingleNode("/p:Relationships/p:Relationship[@Id='$relationshipId']", $relationshipNs)
    if ($null -eq $relationship) { throw "Relatie voor werkblad 'Opleiding' ontbreekt." }
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

    if ($rows.Count -lt 2) { throw "Werkblad 'Opleiding' bevat geen gegevensrijen." }
    $headerMap = @{}
    foreach ($column in $rows[0].Values.Keys) {
      $headerMap[(Normalize-Header $rows[0].Values[$column])] = [int]$column
    }
    foreach ($header in @('omschrijving', 'personeelnr', 'diploma op', 'geldig tot')) {
      if (-not $headerMap.ContainsKey($header)) { throw "Verwachte kolomkop ontbreekt: '$header'." }
    }
    if ($headerMap['omschrijving'] -ne 3 -or $headerMap['personeelnr'] -ne 5 -or
        $headerMap['diploma op'] -ne 10 -or $headerMap['geldig tot'] -ne 11) {
      throw 'De kolommen zijn gewijzigd: verwacht Omschrijving in C, Personeelnr in E, Diploma op in J en Geldig tot in K.'
    }

    return [pscustomobject]@{
      Rows = @($rows | Select-Object -Skip 1)
      CourseColumn = $headerMap['omschrijving']
      EmployeeNumberColumn = $headerMap['personeelnr']
      EmployeeNameColumn = 4
      CompanyColumn = 16
      DiplomaDateColumn = $headerMap['diploma op']
      ValidUntilColumn = $headerMap['geldig tot']
    }
  }
  finally { $archive.Dispose() }
}

function Get-CellText {
  param([Parameter(Mandatory)] $Row, [Parameter(Mandatory)] [int] $Column)
  if ($Row.Values.ContainsKey($Column)) { return ([string]$Row.Values[$Column]).Trim() }
  return ''
}

function ConvertTo-ExcelDate {
  param([AllowNull()] [string] $Value, [Parameter(Mandatory)] [int] $RowNumber, [Parameter(Mandatory)] [string] $ColumnName)

  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $trimmed = $Value.Trim()
  $serial = 0.0
  if ([double]::TryParse($trimmed, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$serial)) {
    try { return [DateTime]::FromOADate($serial).ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture) }
    catch { throw "Ongeldige Excel-datum in rij $RowNumber, kolom '$ColumnName': '$Value'." }
  }

  $date = [DateTime]::MinValue
  $culture = [Globalization.CultureInfo]::GetCultureInfo('nl-NL')
  if ([DateTime]::TryParse($trimmed, $culture, [Globalization.DateTimeStyles]::None, [ref]$date) -or
      [DateTime]::TryParse($trimmed, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$date)) {
    return $date.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  }
  throw "Ongeldige datum in rij $RowNumber, kolom '$ColumnName': '$Value'."
}

function ConvertTo-DateText {
  param([AllowNull()] $Value)

  if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return $null }
  if ($Value -is [DateTime]) {
    return $Value.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  }
  $date = [DateTime]::MinValue
  if ([DateTime]::TryParse([string]$Value, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None, [ref]$date)) {
    return $date.ToString('yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  }
  throw "Ongeldige datumwaarde in database-uitvoer: '$Value'."
}

function Test-NewerTrainingRecord {
  param([Parameter(Mandatory)] $Candidate, [Parameter(Mandatory)] $Existing)

  if ($null -ne $Candidate.DiplomaOn -and $null -eq $Existing.DiplomaOn) { return $true }
  if ($null -eq $Candidate.DiplomaOn -and $null -ne $Existing.DiplomaOn) { return $false }
  if ($null -ne $Candidate.DiplomaOn -and $Candidate.DiplomaOn -cne $Existing.DiplomaOn) {
    return $Candidate.DiplomaOn -gt $Existing.DiplomaOn
  }
  if ($null -ne $Candidate.ValidUntil -and $null -eq $Existing.ValidUntil) { return $true }
  if ($null -eq $Candidate.ValidUntil -and $null -ne $Existing.ValidUntil) { return $false }
  if ($null -ne $Candidate.ValidUntil -and $Candidate.ValidUntil -cne $Existing.ValidUntil) {
    return $Candidate.ValidUntil -gt $Existing.ValidUntil
  }
  return $Candidate.SourceRow -gt $Existing.SourceRow
}

function ConvertTo-SqlLiteral {
  param([Parameter(Mandatory)] [string] $Value)
  return "'$(($Value).Replace("'", "''"))'"
}

function ConvertTo-SqlDateLiteral {
  param([AllowNull()] [string] $Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return 'NULL' }
  return "DATE $(ConvertTo-SqlLiteral $Value)"
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
  # PowerShell can promote native stderr (including PostgreSQL NOTICE messages)
  # to terminating errors when ErrorActionPreference is Stop. Preserve the
  # caller's preference while allowing docker/psql to report its real exit code.
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

if ($MaakKoppelingen -and $Apply) { throw 'Gebruik -MaakKoppelingen en -Apply niet tegelijk.' }

$workbook = Read-TrainingWorkbook -Path $WorkbookPath
$sources = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$byNumber = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$rowsWithoutNumber = [System.Collections.Generic.List[int]]::new()
foreach ($row in $workbook.Rows) {
  $number = Get-CellText -Row $row -Column $workbook.EmployeeNumberColumn
  $course = Get-CellText -Row $row -Column $workbook.CourseColumn
  if (-not $number -and -not $course) { continue }
  if (-not $number) {
    $rowsWithoutNumber.Add($row.RowNumber)
    continue
  }
  $company = Get-CellText -Row $row -Column $workbook.CompanyColumn
  $name = Get-CellText -Row $row -Column $workbook.EmployeeNameColumn
  if (-not $number -or -not $course -or -not $company -or -not $name) {
    throw "Rij $($row.RowNumber) mist een personeelsnummer, opleiding, bedrijf of naam; import afgebroken."
  }
  $key = "$number" + [char]31 + "$company" + [char]31 + "$name"
  if (-not $sources.ContainsKey($key)) {
    $sources[$key] = [pscustomobject]@{
      Company = $company
      Name = $name
      Trainings = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
    }
    if (-not $byNumber.ContainsKey($number)) { $byNumber[$number] = [System.Collections.Generic.List[string]]::new() }
    $byNumber[$number].Add($key)
  }
  $training = [pscustomobject]@{
    Name = $course
    DiplomaOn = ConvertTo-ExcelDate -Value (Get-CellText -Row $row -Column $workbook.DiplomaDateColumn) -RowNumber $row.RowNumber -ColumnName 'Diploma op'
    ValidUntil = ConvertTo-ExcelDate -Value (Get-CellText -Row $row -Column $workbook.ValidUntilColumn) -RowNumber $row.RowNumber -ColumnName 'Geldig tot'
    SourceRow = $row.RowNumber
  }
  $trainings = $sources[$key].Trainings
  if (-not $trainings.ContainsKey($course) -or (Test-NewerTrainingRecord -Candidate $training -Existing $trainings[$course])) {
    $trainings[$course] = $training
  }
}
if ($sources.Count -eq 0) { throw 'Het werkblad bevat geen opleidingen; import afgebroken.' }

$script:appDbUser = Read-DotEnvValue -Path $envFile -Name 'PGUSER' -Default $defaultDbUser
$script:appDbName = Read-DotEnvValue -Path $envFile -Name 'PGDATABASE' -Default $defaultDbName
$profileSql = @'
select coalesce(json_agg(row_to_json(snapshot) order by snapshot.display_name, snapshot.keycloak_sub), '[]'::json)::text
from (
  select profile.keycloak_sub::text as keycloak_sub,
         coalesce(profile.employee_number, '') as employee_number,
         coalesce(profile.display_name, '') as display_name,
         profile.version,
         coalesce((
           select json_agg(json_build_object('name', skill.name, 'diploma_on', link.diploma_on, 'valid_until', link.valid_until) order by skill.name)
           from public.user_skills link
           join public.skills skill on skill.id = link.skill_id
           where link.keycloak_sub = profile.keycloak_sub
         ), '[]'::json) as skills
  from public.user_information profile
) snapshot;
'@
$profileJson = @(Invoke-AppDatabaseCommand -Sql $profileSql) | Select-Object -Last 1
if ([string]::IsNullOrWhiteSpace($profileJson)) { throw 'De database gaf geen profieloverzicht terug.' }
$parsedProfiles = ConvertFrom-Json -InputObject $profileJson
$profiles = if ($parsedProfiles -is [array]) { $parsedProfiles } else { @($parsedProfiles) }
if ($profiles.Count -eq 0) { throw 'Geen profielen gevonden; import afgebroken.' }

$options = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$mappingRows = [System.Collections.Generic.List[object]]::new()
foreach ($profile in $profiles) {
  $number = ([string]$profile.employee_number).Trim()
  $keys = if ($byNumber.ContainsKey($number)) { $byNumber[$number].ToArray() } else { @('') }
  foreach ($key in $keys) {
    $source = if ($key -ne '') { $sources[$key] } else { $null }
    $company = if ($null -ne $source) { $source.Company } else { '' }
    $name = if ($null -ne $source) { $source.Name } else { '' }
    $optionKey = "$($profile.keycloak_sub)" + [char]31 + $key
    $options[$optionKey] = $profile
    $mappingRows.Add([pscustomobject]@{
      KeycloakSub = [string]$profile.keycloak_sub
      Personeelsnummer = $number
      Profiel = [string]$profile.display_name
      Bedrijf = $company
      ExcelNaam = $name
      Selectie = '?'
    })
  }
}

if ($MaakKoppelingen) {
  if (Test-Path -LiteralPath $MappingPath) { throw "Koppelbestand bestaat al: $MappingPath. Kies een ander pad." }
  $mappingRows | Export-Csv -LiteralPath $MappingPath -Delimiter ';' -Encoding UTF8 -NoTypeInformation
  Write-Host "Koppelbestand aangemaakt: $((Resolve-Path -LiteralPath $MappingPath).Path)"
  Write-Host "Bronregels zonder personeelsnummer overgeslagen: $($rowsWithoutNumber.Count)."
  Write-Host 'Vul elke selectie in: JA voor de juiste persoon, NEE voor de overige rijen; maximaal één JA per profiel.'
  Write-Host 'Er zijn geen databasegegevens gewijzigd.'
  return
}

if (-not (Test-Path -LiteralPath $MappingPath -PathType Leaf)) {
  throw "Koppelbestand ontbreekt: $MappingPath. Maak het eerst met -MaakKoppelingen."
}
$inputRows = @(Import-Csv -LiteralPath $MappingPath -Delimiter ';' -Encoding UTF8)
$seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$selected = [System.Collections.Generic.Dictionary[string, string]]::new([StringComparer]::Ordinal)
$selectedSources = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($row in $inputRows) {
  foreach ($column in @('KeycloakSub', 'Personeelsnummer', 'Profiel', 'Bedrijf', 'ExcelNaam', 'Selectie')) {
    if ($null -eq $row.PSObject.Properties[$column]) { throw "Kolom '$column' ontbreekt in het koppelbestand." }
  }
  $subject = ([string]$row.KeycloakSub).Trim()
  $number = ([string]$row.Personeelsnummer).Trim()
  $company = ([string]$row.Bedrijf).Trim()
  $name = ([string]$row.ExcelNaam).Trim()
  $selection = ([string]$row.Selectie).Trim().ToUpperInvariant()
  if ($selection -notin @('JA', 'NEE')) { throw "Gebruik JA of NEE bij '$($row.Profiel)'." }
  $key = if ($company -eq '' -and $name -eq '') { '' } else { "$number" + [char]31 + "$company" + [char]31 + "$name" }
  $optionKey = "$subject" + [char]31 + $key
  if (-not $options.ContainsKey($optionKey) -or -not $seen.Add($optionKey)) {
    throw "Onbekende of dubbele koppelregel voor '$($row.Profiel)'. Maak een nieuw koppelbestand."
  }
  $profile = $options[$optionKey]
  if ($number -cne ([string]$profile.employee_number).Trim() -or ([string]$row.Profiel).Trim() -cne ([string]$profile.display_name).Trim()) {
    throw "Profielgegevens gewijzigd voor '$($row.Profiel)'. Maak een nieuw koppelbestand."
  }
  if ($selection -eq 'JA') {
    if ($key -eq '' -or $selected.ContainsKey($subject) -or -not $selectedSources.Add($key)) {
      throw "Ongeldige of dubbele JA-keuze voor '$($row.Profiel)'."
    }
    $selected[$subject] = $key
  }
}
if ($seen.Count -ne $options.Count) { throw 'Koppelbestand onvolledig of bron/profielen gewijzigd. Maak een nieuw koppelbestand.' }
if ($selected.Count -eq 0) { throw 'Geen medewerkers geselecteerd; verwijderen en importeren zijn afgebroken.' }

$preview = [System.Collections.Generic.List[object]]::new()
$targetValues = [System.Collections.Generic.List[string]]::new()
$skillValues = [System.Collections.Generic.List[string]]::new()
$existingLinkCount = 0
foreach ($profile in $profiles) {
  $subject = [string]$profile.keycloak_sub
  $number = ([string]$profile.employee_number).Trim()
  $existingLinkCount += @($profile.skills).Count
  $desired = @()
  $sourceName = '(geen koppeling)'
  if ($selected.ContainsKey($subject)) {
    $source = $sources[$selected[$subject]]
    $sourceName = "$($source.Company) / $($source.Name)"
    $desired = @($source.Trainings.Values | Sort-Object Name)
  }
  $targetValues.Add("($(ConvertTo-SqlLiteral $subject)::uuid, $(ConvertTo-SqlLiteral $number), $([long]$profile.version))")
  foreach ($skill in $desired) {
    $skillValues.Add("($(ConvertTo-SqlLiteral $subject)::uuid, $(ConvertTo-SqlLiteral $skill.Name), $(ConvertTo-SqlDateLiteral $skill.DiplomaOn), $(ConvertTo-SqlDateLiteral $skill.ValidUntil))")
  }
  if (@($profile.skills).Count -gt 0 -or $desired.Count -gt 0) {
    $preview.Add([pscustomobject]@{
      Profiel = [string]$profile.display_name
      Personeelsnummer = $number
      ExcelPersoon = $sourceName
      Huidig = @($profile.skills).Count
      Nieuw = $desired.Count
      Opleidingen = @($desired | ForEach-Object { [string]$_.Name }) -join '; '
    })
  }
}

Write-Host "Bron: $((Resolve-Path -LiteralPath $WorkbookPath).Path)"
Write-Host "Koppelbestand: $((Resolve-Path -LiteralPath $MappingPath).Path)"
Write-Host "Bronregels zonder personeelsnummer overgeslagen: $($rowsWithoutNumber.Count)."
Write-Host "Geselecteerde profielen: $($selected.Count); niet-geselecteerde bronpersonen: $($sources.Count - $selectedSources.Count)."
Write-Host "ALLE $existingLinkCount bestaande user_skills-koppelingen worden verwijderd; $($skillValues.Count) geselecteerde koppelingen worden opnieuw aangemaakt."
Write-Host 'Profielen zonder geselecteerde bronpersoon verliezen hun bestaande skills. De tabel skills blijft behouden.'
$preview | Format-Table Profiel, Personeelsnummer, ExcelPersoon, Huidig, Nieuw, Opleidingen -AutoSize -Wrap | Out-String -Width 240 | Write-Host
if (-not $Apply) {
  Write-Host 'Preview klaar; PostgreSQL is niet gewijzigd. Voeg -Apply toe om de herimport uit te voeren.'
  return
}
if ((Read-Host 'ALLE user_skills-koppelingen verwijderen en bovenstaande herimport uitvoeren? Typ JA om door te gaan') -cne 'JA') {
  Write-Host 'Afgebroken; PostgreSQL is niet gewijzigd.'
  return
}

$sql = @'
begin;
set local client_min_messages = warning;
lock table public.user_information in share row exclusive mode;
lock table public.user_skills in share row exclusive mode;
create temporary table import_sync_profiles (
  keycloak_sub uuid primary key,
  employee_number text not null,
  expected_version bigint not null
) on commit drop;
create temporary table import_employee_skill (
  keycloak_sub uuid not null,
  skill_name text not null,
  diploma_on date null,
  valid_until date null,
  primary key (keycloak_sub, skill_name)
) on commit drop;
'@
$sql += [Environment]::NewLine + "insert into import_sync_profiles(keycloak_sub, employee_number, expected_version) values $($targetValues -join ', ');"
if ($skillValues.Count -gt 0) {
  $sql += [Environment]::NewLine + "insert into import_employee_skill(keycloak_sub, skill_name, diploma_on, valid_until) values $($skillValues -join ', ');"
}
$sql += @'

do $sync$
declare
  expected_count integer;
  updated_count integer;
begin
  if (select count(*) from public.user_information) <> (select count(*) from import_sync_profiles)
     or exists (
       select 1
       from import_sync_profiles target
       left join public.user_information profile on profile.keycloak_sub = target.keycloak_sub
       where profile.keycloak_sub is null
          or coalesce(btrim(profile.employee_number), '') <> target.employee_number
          or profile.version <> target.expected_version
     ) then
    raise exception 'Profielen gewijzigd sinds de preview; geen opleidingen bijgewerkt. Voer het script opnieuw uit.';
  end if;

  select count(*) into expected_count
  from import_sync_profiles target
  where exists (select 1 from public.user_skills link where link.keycloak_sub = target.keycloak_sub)
     or exists (select 1 from import_employee_skill desired where desired.keycloak_sub = target.keycloak_sub);

  update public.user_information profile
  set version = profile.version + 1,
      updated_at = now()
  from import_sync_profiles target
  where profile.keycloak_sub = target.keycloak_sub
    and profile.version = target.expected_version
    and (
      exists (select 1 from public.user_skills link where link.keycloak_sub = target.keycloak_sub)
      or exists (select 1 from import_employee_skill desired where desired.keycloak_sub = target.keycloak_sub)
    );
  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'Profiel gewijzigd sinds de preview; geen opleidingen bijgewerkt. Voer het script opnieuw uit.';
  end if;
end
$sync$;

insert into public.skills(name)
select distinct source.skill_name
from import_employee_skill source
on conflict (name) do nothing;

delete from public.user_skills;

insert into public.user_skills(keycloak_sub, skill_id, diploma_on, valid_until)
select desired.keycloak_sub, skill.id, desired.diploma_on, desired.valid_until
from import_employee_skill desired
join public.skills skill on skill.name = desired.skill_name;

commit;
select 'SYNC_DONE';
'@

$result = Invoke-AppDatabaseCommand -Sql $sql
Write-Host 'Herimport voltooid. PostgreSQL-resultaat:'
$result | ForEach-Object { Write-Host $_ }
