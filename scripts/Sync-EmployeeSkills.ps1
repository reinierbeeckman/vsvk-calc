# Synchroniseert de medewerker-opleidingen uit "Opleidingen alle kolommen.xlsx"
# naar de koppeltabel public.user_skills. Zonder -Apply wordt alleen een preview getoond.
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

$workbook = Read-TrainingWorkbook -Path $WorkbookPath
$sourceByEmployee = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
$rowsWithoutEmployeeNumber = [System.Collections.Generic.List[int]]::new()
$duplicateTrainingPairs = 0
foreach ($row in $workbook.Rows) {
  $employeeNumber = Get-CellText -Row $row -Column $workbook.EmployeeNumberColumn
  $courseName = Get-CellText -Row $row -Column $workbook.CourseColumn
  if ([string]::IsNullOrWhiteSpace($employeeNumber) -and [string]::IsNullOrWhiteSpace($courseName)) { continue }
  if ([string]::IsNullOrWhiteSpace($employeeNumber) -and -not [string]::IsNullOrWhiteSpace($courseName)) {
    $rowsWithoutEmployeeNumber.Add($row.RowNumber)
    continue
  }
  if ([string]::IsNullOrWhiteSpace($courseName)) { continue }
  $training = [pscustomobject]@{
    Name = $courseName
    DiplomaOn = ConvertTo-ExcelDate -Value (Get-CellText -Row $row -Column $workbook.DiplomaDateColumn) -RowNumber $row.RowNumber -ColumnName 'Diploma op'
    ValidUntil = ConvertTo-ExcelDate -Value (Get-CellText -Row $row -Column $workbook.ValidUntilColumn) -RowNumber $row.RowNumber -ColumnName 'Geldig tot'
    SourceRow = $row.RowNumber
  }
  if (-not $sourceByEmployee.ContainsKey($employeeNumber)) {
    $sourceByEmployee[$employeeNumber] = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  }
  $employeeTrainings = $sourceByEmployee[$employeeNumber]
  if ($employeeTrainings.ContainsKey($courseName)) {
    $duplicateTrainingPairs++
    if (Test-NewerTrainingRecord -Candidate $training -Existing $employeeTrainings[$courseName]) {
      $employeeTrainings[$courseName] = $training
    }
  }
  else {
    $employeeTrainings[$courseName] = $training
  }
}

$script:appDbUser = Read-DotEnvValue -Path $envFile -Name 'PGUSER' -Default $defaultDbUser
$script:appDbName = Read-DotEnvValue -Path $envFile -Name 'PGDATABASE' -Default $defaultDbName
$columnsPresentSql = @'
select (count(*) = 2)::text
from information_schema.columns
where table_schema = 'public'
  and table_name = 'user_skills'
  and column_name in ('diploma_on', 'valid_until');
'@
$columnsPresentLines = @(Invoke-AppDatabaseCommand -Sql $columnsPresentSql)
$dateColumnsPresent = $columnsPresentLines.Count -gt 0 -and $columnsPresentLines[-1] -in @('t', 'true')
$skillJsonSql = if ($dateColumnsPresent) {
  @'
         coalesce((
           select json_agg(json_build_object(
             'name', skill.name,
             'diploma_on', link.diploma_on,
             'valid_until', link.valid_until
           ) order by skill.name)
           from public.user_skills link
           join public.skills skill on skill.id = link.skill_id
           where link.keycloak_sub = profile.keycloak_sub
         ), '[]'::json) as skills
'@
}
else {
  @'
         coalesce((
           select json_agg(json_build_object(
             'name', skill.name,
             'diploma_on', null,
             'valid_until', null
           ) order by skill.name)
           from public.user_skills link
           join public.skills skill on skill.id = link.skill_id
           where link.keycloak_sub = profile.keycloak_sub
         ), '[]'::json) as skills
'@
}
$profileSql = @'
select coalesce(json_agg(row_to_json(snapshot) order by snapshot.employee_number), '[]'::json)::text
from (
  select profile.keycloak_sub::text as keycloak_sub,
         profile.employee_number,
         coalesce(profile.display_name, '') as display_name,
         profile.version,
         __SKILL_JSON__
  from public.user_information profile
  where profile.employee_number is not null
    and btrim(profile.employee_number) <> ''
) snapshot;
'@
$profileSql = $profileSql.Replace('__SKILL_JSON__', $skillJsonSql.Trim())
$profileJsonLines = @(Invoke-AppDatabaseCommand -Sql $profileSql)
if ($profileJsonLines.Count -eq 0) { throw 'De database gaf geen profieloverzicht terug.' }
$profileJson = $profileJsonLines[-1]
try {
  $parsedProfiles = ConvertFrom-Json -InputObject $profileJson
  $profiles = if ($parsedProfiles -is [array]) { $parsedProfiles } else { @($parsedProfiles) }
}
catch { throw "Het profieloverzicht uit PostgreSQL kon niet worden gelezen: $($_.Exception.Message)" }

$profilesByEmployee = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
foreach ($profile in $profiles) {
  $employeeNumber = ([string]$profile.employee_number).Trim()
  if ($profilesByEmployee.ContainsKey($employeeNumber)) {
    throw "Personeelsnummer '$employeeNumber' komt meer dan één keer voor in user_information."
  }
  $profilesByEmployee[$employeeNumber] = $profile
}

$changedProfiles = [System.Collections.Generic.List[object]]::new()
$matchedSourceNumbers = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$previewRows = [System.Collections.Generic.List[object]]::new()
foreach ($profile in $profiles) {
  $employeeNumber = ([string]$profile.employee_number).Trim()
  $currentSkills = [System.Collections.Generic.Dictionary[string, object]]::new([StringComparer]::Ordinal)
  foreach ($skill in $profile.skills) {
    $currentSkills[[string]$skill.name] = [pscustomobject]@{
      DiplomaOn = ConvertTo-DateText $skill.diploma_on
      ValidUntil = ConvertTo-DateText $skill.valid_until
    }
  }
  $desiredSkills = @()
  if ($sourceByEmployee.ContainsKey($employeeNumber)) {
    [void]$matchedSourceNumbers.Add($employeeNumber)
    $desiredSkills = @($sourceByEmployee[$employeeNumber].Values | Sort-Object Name)
  }
  $desiredNames = @($desiredSkills | ForEach-Object { [string]$_.Name })
  $toAdd = @($desiredSkills | Where-Object { -not $currentSkills.ContainsKey([string]$_.Name) })
  $toRemove = @($currentSkills.Keys | Where-Object { $desiredNames -cnotcontains $_ })
  $dateUpdates = [System.Collections.Generic.List[string]]::new()
  foreach ($skill in $desiredSkills) {
    if (-not $currentSkills.ContainsKey([string]$skill.Name)) { continue }
    $current = $currentSkills[[string]$skill.Name]
    if ($current.DiplomaOn -cne $skill.DiplomaOn -or $current.ValidUntil -cne $skill.ValidUntil) {
      $oldDiploma = if ($null -eq $current.DiplomaOn) { 'leeg' } else { $current.DiplomaOn }
      $oldValidUntil = if ($null -eq $current.ValidUntil) { 'leeg' } else { $current.ValidUntil }
      $newDiploma = if ($null -eq $skill.DiplomaOn) { 'leeg' } else { $skill.DiplomaOn }
      $newValidUntil = if ($null -eq $skill.ValidUntil) { 'leeg' } else { $skill.ValidUntil }
      $oldDates = "diploma $oldDiploma, geldig tot $oldValidUntil"
      $newDates = "diploma $newDiploma, geldig tot $newValidUntil"
      $dateUpdates.Add("$($skill.Name): $oldDates -> $newDates")
    }
  }
  if ($toAdd.Count -eq 0 -and $toRemove.Count -eq 0 -and $dateUpdates.Count -eq 0) { continue }

  $changedProfiles.Add([pscustomobject]@{
    KeycloakSubject = [string]$profile.keycloak_sub
    EmployeeNumber = $employeeNumber
    Version = [long]$profile.version
    DesiredSkills = $desiredSkills
    Added = $toAdd
    Removed = $toRemove
    DateUpdates = @($dateUpdates)
  })
  $previewRows.Add([pscustomobject]@{
    Naam = [string]$profile.display_name
    Personeelsnummer = $employeeNumber
    Toevoegen = @($toAdd | ForEach-Object { [string]$_.Name }) -join '; '
    Verwijderen = $toRemove -join '; '
    DatumsBijwerken = $dateUpdates -join '; '
  })
}

$unmatchedSourceNumbers = @($sourceByEmployee.Keys | Where-Object { -not $profilesByEmployee.ContainsKey($_) } | Sort-Object)
$profilesWithoutSourceRows = @($profiles | Where-Object { -not $sourceByEmployee.ContainsKey(([string]$_.employee_number).Trim()) })
$sourceRecordCount = ($sourceByEmployee.Values | ForEach-Object { $_.Count } | Measure-Object -Sum).Sum
if ($null -eq $sourceRecordCount) { $sourceRecordCount = 0 }

Write-Host "Bron: $((Resolve-Path -LiteralPath $WorkbookPath).Path)"
Write-Host 'Werkblad: Opleiding; omschrijving uit kolom C; personeelsnummer uit E; diploma op uit J; geldig tot uit K.'
Write-Host "Opleidingskoppelingen na deduplicatie: $sourceRecordCount verdeeld over $($sourceByEmployee.Count) personeelsnummers."
Write-Host "Dubbele medewerker-opleidingregels samengevoegd op de nieuwste diploma-/geldigheidsdatum: $duplicateTrainingPairs."
Write-Host "Bronrijen met opleiding maar zonder personeelsnummer (overgeslagen): $($rowsWithoutEmployeeNumber.Count)."
Write-Host "Profielen met gevuld employee_number: $($profiles.Count); profielen zonder bronrij (doel: 0 opleidingen): $($profilesWithoutSourceRows.Count)."
if (-not $dateColumnsPresent) {
  Write-Host 'De datumkolommen ontbreken nog in user_skills; -Apply maakt ze aan en vult ze in dezelfde transactie.'
}
Write-Host "Bronpersoneelsnummers zonder profiel in user_information: $($unmatchedSourceNumbers.Count)."
if ($unmatchedSourceNumbers.Count -gt 0) {
  Write-Host "Niet gekoppeld (wordt overgeslagen): $($unmatchedSourceNumbers -join ', ')"
}
if ($previewRows.Count -gt 0) {
  $previewRows | Format-Table Naam, Personeelsnummer, Toevoegen, Verwijderen, DatumsBijwerken -AutoSize -Wrap | Out-String -Width 240 | Write-Host
}
else {
  Write-Host 'Geen verschillen gevonden; user_skills is al gelijk aan de stamdata.'
}

if (-not $Apply) {
  Write-Host 'Preview klaar; PostgreSQL is niet gewijzigd. Voeg -Apply toe om de verschillen toe te passen.'
  return
}
if (-not $Apply) {
  Write-Host 'Preview klaar; PostgreSQL is niet gewijzigd. Voeg -Apply toe om de verschillen toe te passen.'
  return
}

$confirmation = "Controleer en synchroniseer $($profiles.Count) medewerkerprofielen met de stamdata; alleen afwijkingen worden aangepast en koppelingen zonder bronopleiding worden verwijderd. Typ JA om door te gaan"
if ((Read-Host $confirmation) -cne 'JA') {
  Write-Host 'Afgebroken; PostgreSQL is niet gewijzigd.'
  return
}

$values = [System.Collections.Generic.List[string]]::new()
foreach ($employeeNumber in $sourceByEmployee.Keys) {
  foreach ($skill in $sourceByEmployee[$employeeNumber].Values) {
    $values.Add("($(ConvertTo-SqlLiteral $employeeNumber), $(ConvertTo-SqlLiteral $skill.Name), $(ConvertTo-SqlDateLiteral $skill.DiplomaOn), $(ConvertTo-SqlDateLiteral $skill.ValidUntil))")
  }
}
$targetValues = foreach ($profile in $profiles) {
  "($(ConvertTo-SqlLiteral ([string]$profile.keycloak_sub))::uuid, $(ConvertTo-SqlLiteral ([string]$profile.employee_number)), $([long]$profile.version))"
}

$sql = @'
begin;
set local client_min_messages = warning;
alter table public.user_skills
  add column if not exists diploma_on date null,
  add column if not exists valid_until date null;
create temporary table import_employee_skill (
  employee_number text not null,
  skill_name text not null,
  diploma_on date null,
  valid_until date null,
  primary key (employee_number, skill_name)
) on commit drop;
create temporary table import_sync_profiles (
  keycloak_sub uuid primary key,
  employee_number text not null unique,
  expected_version bigint not null
) on commit drop;
'@
if ($values.Count -gt 0) {
  $sql += "`ninsert into import_employee_skill(employee_number, skill_name, diploma_on, valid_until) values $($values -join ', ');"
}
if ($profiles.Count -gt 0) {
  $sql += "`ninsert into import_sync_profiles(keycloak_sub, employee_number, expected_version) values $($targetValues -join ', ');"
}
$sql += @'

do $sync$
declare
  expected_count integer;
  updated_count integer;
  matched_count integer;
begin
  select count(*) into matched_count
  from import_sync_profiles target
  join public.user_information profile
    on profile.keycloak_sub = target.keycloak_sub
   and profile.employee_number = target.employee_number
   and profile.version = target.expected_version;
  if matched_count <> (select count(*) from import_sync_profiles) then
    raise exception 'Profiel gewijzigd sinds de preview; geen opleidingen zijn bijgewerkt. Voer het script opnieuw uit.';
  end if;

  select count(*) into expected_count
  from import_sync_profiles target
  join public.user_information profile on profile.keycloak_sub = target.keycloak_sub
  where exists (
    select 1
    from public.user_skills link
    where link.keycloak_sub = profile.keycloak_sub
      and not exists (
        select 1
        from import_employee_skill desired
        join public.skills desired_skill on desired_skill.name = desired.skill_name
        where desired.employee_number = profile.employee_number
          and desired_skill.id = link.skill_id
      )
  )
  or exists (
    select 1
    from import_employee_skill desired
    join public.skills desired_skill on desired_skill.name = desired.skill_name
    left join public.user_skills link
      on link.keycloak_sub = profile.keycloak_sub
     and link.skill_id = desired_skill.id
    where desired.employee_number = profile.employee_number
      and (
        link.skill_id is null
        or link.diploma_on is distinct from desired.diploma_on
        or link.valid_until is distinct from desired.valid_until
      )
  );

  update public.user_information profile
  set version = profile.version + 1,
      updated_at = now()
  from import_sync_profiles target
  where profile.keycloak_sub = target.keycloak_sub
    and profile.employee_number = target.employee_number
    and profile.version = target.expected_version
    and (
      exists (
        select 1
        from public.user_skills link
        where link.keycloak_sub = profile.keycloak_sub
          and not exists (
            select 1
            from import_employee_skill desired
            join public.skills desired_skill on desired_skill.name = desired.skill_name
            where desired.employee_number = profile.employee_number
              and desired_skill.id = link.skill_id
          )
      )
      or exists (
        select 1
        from import_employee_skill desired
        join public.skills desired_skill on desired_skill.name = desired.skill_name
        left join public.user_skills link
          on link.keycloak_sub = profile.keycloak_sub
         and link.skill_id = desired_skill.id
        where desired.employee_number = profile.employee_number
          and (
            link.skill_id is null
            or link.diploma_on is distinct from desired.diploma_on
            or link.valid_until is distinct from desired.valid_until
          )
      )
    );
  get diagnostics updated_count = row_count;
  if updated_count <> expected_count then
    raise exception 'Profiel gewijzigd sinds de preview; geen opleidingen zijn bijgewerkt. Voer het script opnieuw uit.';
  end if;
end
$sync$;

insert into public.skills(name)
select distinct source.skill_name
from import_employee_skill source
on conflict (name) do nothing;

delete from public.user_skills link
using import_sync_profiles target, public.user_information profile
where profile.keycloak_sub = target.keycloak_sub
  and link.keycloak_sub = profile.keycloak_sub
  and not exists (
    select 1
    from import_employee_skill desired
    join public.skills desired_skill on desired_skill.name = desired.skill_name
    where desired.employee_number = profile.employee_number
      and desired_skill.id = link.skill_id
  );

update public.user_skills link
set diploma_on = desired.diploma_on,
    valid_until = desired.valid_until
from import_sync_profiles target
join public.user_information profile on profile.keycloak_sub = target.keycloak_sub
join import_employee_skill desired on desired.employee_number = profile.employee_number
join public.skills skill on skill.name = desired.skill_name
where link.keycloak_sub = profile.keycloak_sub
  and link.skill_id = skill.id
  and (
    link.diploma_on is distinct from desired.diploma_on
    or link.valid_until is distinct from desired.valid_until
  );

insert into public.user_skills(keycloak_sub, skill_id, diploma_on, valid_until)
select profile.keycloak_sub, skill.id, desired.diploma_on, desired.valid_until
from import_sync_profiles target
join public.user_information profile on profile.keycloak_sub = target.keycloak_sub
join import_employee_skill desired on desired.employee_number = profile.employee_number
join public.skills skill on skill.name = desired.skill_name
on conflict (keycloak_sub, skill_id) do nothing;

commit;
select 'SYNC_DONE';
'@

$result = Invoke-AppDatabaseCommand -Sql $sql
Write-Host 'Synchronisatie voltooid. PostgreSQL-resultaat:'
$result | ForEach-Object { Write-Host $_ }
