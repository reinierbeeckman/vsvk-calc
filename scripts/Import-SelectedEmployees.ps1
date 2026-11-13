# Invoerformaat: naam;naam;naam,rij,personeelsnummer
# Preview (default): .\scripts\Import-SelectedEmployees.ps1 -WorkbookPath <bestand.xlsx>
# Import:           .\scripts\Import-SelectedEmployees.ps1 -WorkbookPath <bestand.xlsx> -Apply
[CmdletBinding()]
param(
  [Parameter()]
  [string] $WorkbookPath,

  [Parameter()]
  [string] $EmployeeInput = 'Stan van Dijk;Arthur Burg;Robin van Well;Lennard Overdevest,278,74;Marc van Nassau;Dylan Leyendekkers;Remko Vriend;Mandy Ammerlaan;Tessa Tettero;Jauke vd Burg;Peter van Kester',

  [Parameter()]
  [string] $KeycloakBaseUrl = 'http://localhost:8081',

  [Parameter()]
  [string] $Realm = 'vsvk',

  # Without -Apply the script only reads the workbook and prints its plan.
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
$appDbUser = 'vsvk'
$appDbName = 'vsvk_calc'
$realmRoleName = 'default-roles-vsvk'
$groupName = 'VSVK Pijnacker BV'

if ([string]::IsNullOrWhiteSpace($WorkbookPath)) {
  $WorkbookPath = Read-Host 'Pad naar Werknemers alle kolommen.xlsx'
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

function Normalize-Name {
  param([AllowNull()] [string] $Value)

  if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
  $decomposed = $Value.Normalize([Text.NormalizationForm]::FormD)
  $withoutMarks = [regex]::Replace($decomposed, '\p{Mn}', '')
  return ([regex]::Replace($withoutMarks.ToLowerInvariant(), '[^\p{L}\p{N}]+', ' ')).Trim()
}

function Read-EmployeeWorkbook {
  param([Parameter(Mandatory)] [string] $Path)

  $archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Path).Path)
  try {
    $workbook = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/workbook.xml')
    $workbookNs = [System.Xml.XmlNamespaceManager]::new($workbook.NameTable)
    $workbookNs.AddNamespace('x', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
    $workbookNs.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relationships = [xml](Get-ZipEntryText -Archive $archive -Name 'xl/_rels/workbook.xml.rels')
    $relationshipNs = [System.Xml.XmlNamespaceManager]::new($relationships.NameTable)
    $relationshipNs.AddNamespace('p', 'http://schemas.openxmlformats.org/package/2006/relationships')

    $sheet = $workbook.SelectSingleNode("/x:workbook/x:sheets/x:sheet[@name='Werknemer']", $workbookNs)
    if ($null -eq $sheet) { throw "Werkblad 'Werknemer' niet gevonden." }
    $relationshipId = $sheet.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $relationship = $relationships.SelectSingleNode("/p:Relationships/p:Relationship[@Id='$relationshipId']", $relationshipNs)
    if ($null -eq $relationship) { throw "Relatie voor werkblad 'Werknemer' ontbreekt." }
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
          $value = $sharedStrings[[int]$valueNode.InnerText]
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

    if ($rows.Count -lt 2) { throw "Werkblad 'Werknemer' bevat geen gegevensrijen." }
    $header = $rows[0].Values
    $headerMap = @{}
    foreach ($column in $header.Keys) { $headerMap[(Normalize-Name $header[$column])] = [int]$column }
    $requiredHeaders = @{
      'zoeknaam' = 1
      'roepnaam' = 2
      'personeelsnr' = 4
      'telnr prive' = 10
      'e mail adres prive' = 83
      'naam voluit' = $null
    }
    foreach ($key in $requiredHeaders.Keys) {
      if (-not $headerMap.ContainsKey($key)) { throw "Verwachte kolomkop ontbreekt: '$key'." }
      if ($null -ne $requiredHeaders[$key] -and $headerMap[$key] -ne $requiredHeaders[$key]) {
        throw "Kolom '$key' staat niet meer op de verwachte plek. Werkmap niet verwerkt."
      }
    }

    return [pscustomobject]@{
      Rows = @($rows | Select-Object -Skip 1)
      FullNameColumn = $headerMap['naam voluit']
      Headers = $header
    }
  }
  finally { $archive.Dispose() }
}

function Get-CellText {
  param([Parameter(Mandatory)] $Row, [Parameter(Mandatory)] [int] $Column)
  if ($Row.Values.ContainsKey($Column)) { return ([string]$Row.Values[$Column]).Trim() }
  return ''
}

function ConvertFrom-EmployeeInput {
  param([Parameter(Mandatory)] [string] $InputString)

  $entries = [System.Collections.Generic.List[object]]::new()
  foreach ($entryText in $InputString.Split(';')) {
    $entry = $entryText.Trim()
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    $parts = @($entry.Split(',') | ForEach-Object { $_.Trim() })
    if ($parts.Count -ne 1 -and $parts.Count -ne 3) {
      throw "Ongeldige invoer '$entry'. Gebruik 'Naam' of 'Naam,Rijnummer,Personeelsnummer'."
    }
    if ([string]::IsNullOrWhiteSpace($parts[0])) { throw "Naam ontbreekt in invoer '$entry'." }

    $rowNumber = $null
    $employeeNumber = ''
    if ($parts.Count -eq 3) {
      $parsedRowNumber = 0
      if (-not [int]::TryParse($parts[1], [ref]$parsedRowNumber) -or $parsedRowNumber -lt 1 -or
          [string]::IsNullOrWhiteSpace($parts[2])) {
        throw "Ongeldige rij/personeelsnummer in invoer '$entry'."
      }
      $rowNumber = $parsedRowNumber
      $employeeNumber = $parts[2]
    }

    $entries.Add([pscustomobject]@{
      RequestedName = $parts[0]
      ForcedRow = $rowNumber
      ExpectedEmployeeNumber = $employeeNumber
    })
  }
  if ($entries.Count -eq 0) { throw 'De invoer bevat geen namen.' }
  return @($entries)
}

function ConvertTo-Username {
  param([Parameter(Mandatory)] [string] $FullName)

  $decomposed = $FullName.Normalize([Text.NormalizationForm]::FormD)
  $withoutMarks = [regex]::Replace($decomposed, '\p{Mn}', '')
  $parts = [regex]::Matches($withoutMarks, '[\p{L}\p{N}]+') |
    ForEach-Object { $_.Value.ToLowerInvariant() }
  if (@($parts).Count -lt 2) { throw "Kan geen gebruikersnaam afleiden uit '$FullName'." }
  return (@($parts) -join '.')
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

function Invoke-AppDatabaseQuery {
  param([Parameter(Mandatory)] [string] $Sql)

  $composeArguments = @('compose')
  if (Test-Path -LiteralPath $envFile -PathType Leaf) {
    $composeArguments += @('--env-file', $envFile)
  }
  $composeArguments += @(
    '-f', $composeBase,
    '-f', $composeDev,
    'exec', '-T', 'postgres',
    'psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-U', $appDbUser, '-d', $appDbName, '-c', $Sql
  )
  $output = & docker @composeArguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "App-databaseactie mislukt: $($output -join ' ')"
  }
  $resultLines = @($output | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ -ne '' })
  if ($resultLines.Count -eq 0) { return '' }
  return $resultLines[-1]
}

function Invoke-KeycloakAdmin {
  param(
    [Parameter(Mandatory)] [ValidateSet('GET', 'POST', 'PUT')] [string] $Method,
    [Parameter(Mandatory)] [string] $Path,
    [AllowNull()] $Body
  )

  $request = @{
    Uri = "$adminApi$Path"
    Method = $Method
    Headers = @{ Authorization = "Bearer $accessToken" }
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json'
    $request.Body = ConvertTo-Json -InputObject $Body -Depth 10 -Compress
  }
  try {
    # Emit API array items individually; a raw empty array can appear as one
    # nested object to callers that collect the function result with @(...).
    $response = Invoke-RestMethod @request
    if ($response -is [System.Array]) {
      foreach ($responseItem in $response) { Write-Output $responseItem }
    }
    elseif ($null -ne $response) {
      Write-Output $response
    }
  }
  catch {
    $statusCode = $null
    if ($null -ne $_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { }
    }
    $statusText = if ($null -ne $statusCode) { "HTTP $statusCode" } else { 'transportfout' }
    throw "Keycloak Admin API $Method $Path faalde ($statusText): $($_.Exception.Message)"
  }
}

function Test-KeycloakUserExists {
  param([Parameter(Mandatory)] [string] $UserId)

  $encodedUserId = [uri]::EscapeDataString($UserId)
  try {
    Invoke-KeycloakAdmin -Method GET -Path "/users/$encodedUserId" -Body $null | Out-Null
    return $true
  }
  catch {
    if ($_.Exception.Message -match '\(HTTP 404\)') { return $false }
    throw
  }
}

$nameAliases = @{}
$nameAliases[(Normalize-Name 'Arthur Burg')] = 'Arthur van der Burg'
$nameAliases[(Normalize-Name 'Robin van Well')] = 'Robin van der Welle'
$nameAliases[(Normalize-Name 'Dylan Leyendekkers')] = 'Dylan Leijendekker'
$nameAliases[(Normalize-Name 'Jauke vd Burg')] = 'Jauke van der Burg-Mastenbroek'

$targets = ConvertFrom-EmployeeInput -InputString $EmployeeInput

$workbook = Read-EmployeeWorkbook -Path $WorkbookPath
$prepared = [System.Collections.Generic.List[object]]::new()
foreach ($target in $targets) {
  $found = @()
  $matchLabel = ''
  if ($null -ne $target.ForcedRow) {
    $found = @($workbook.Rows | Where-Object RowNumber -eq $target.ForcedRow)
    if ($found.Count -eq 0) {
      $prepared.Add([pscustomobject]@{
        RequestedName = $target.RequestedName; SourceName = ''; Row = $target.ForcedRow; EmployeeNumber = ''
        ExpectedEmployeeNumber = $target.ExpectedEmployeeNumber; Username = ''; EmailPresent = $false; PhonePresent = $false
        Match = 'Rij niet gevonden'; Include = $false; FirstName = ''; LastName = ''; Email = ''; Phone = ''; DisplayName = ''
      })
      continue
    }
    $rowEmployeeNumber = Get-CellText -Row $found[0] -Column 4
    if ($rowEmployeeNumber -cne $target.ExpectedEmployeeNumber) {
      $rowDisplayName = Get-CellText -Row $found[0] -Column $workbook.FullNameColumn
      $prepared.Add([pscustomobject]@{
        RequestedName = $target.RequestedName; SourceName = $rowDisplayName; Row = $target.ForcedRow
        EmployeeNumber = $rowEmployeeNumber; ExpectedEmployeeNumber = $target.ExpectedEmployeeNumber
        Username = ''; EmailPresent = $false; PhonePresent = $false; Match = 'Personeelsnummer komt niet overeen'
        Include = $false; FirstName = ''; LastName = ''; Email = ''; Phone = ''; DisplayName = ''
      })
      continue
    }
    $matchLabel = 'Handmatige match gevalideerd'
  }
  else {
    $expected = Normalize-Name $target.RequestedName
    $found = @($workbook.Rows | Where-Object {
      (Normalize-Name (Get-CellText -Row $_ -Column $workbook.FullNameColumn)) -eq $expected
    })
    if ($found.Count -eq 0 -and $nameAliases.ContainsKey($expected)) {
      $alias = $nameAliases[$expected]
      $expected = Normalize-Name $alias
      $found = @($workbook.Rows | Where-Object {
        (Normalize-Name (Get-CellText -Row $_ -Column $workbook.FullNameColumn)) -eq $expected
      })
    }
  }

  if ($found.Count -eq 0) {
    $prepared.Add([pscustomobject]@{
      RequestedName = $target.RequestedName; SourceName = ''; Row = ''; EmployeeNumber = ''; ExpectedEmployeeNumber = ''
      Username = ''; EmailPresent = $false; PhonePresent = $false; Match = 'Geen match'; Include = $false
      FirstName = ''; LastName = ''; Email = ''; Phone = ''; DisplayName = ''
    })
    continue
  }
  if ($found.Count -gt 1) {
    $prepared.Add([pscustomobject]@{
      RequestedName = $target.RequestedName; SourceName = ''; Row = (@($found | ForEach-Object RowNumber) -join ',')
      EmployeeNumber = ''; ExpectedEmployeeNumber = ''; Username = ''; EmailPresent = $false; PhonePresent = $false
      Match = 'Meerdere bronrijen'; Include = $false; FirstName = ''; LastName = ''; Email = ''; Phone = ''; DisplayName = ''
    })
    continue
  }

  $row = $found[0]
  $firstName = Get-CellText -Row $row -Column 2
  $displayName = Get-CellText -Row $row -Column $workbook.FullNameColumn
  $email = Get-CellText -Row $row -Column 83
  $phone = Get-CellText -Row $row -Column 10
  $employeeNumber = Get-CellText -Row $row -Column 4
  $lastName = ''
  if ($displayName.StartsWith($firstName, [StringComparison]::OrdinalIgnoreCase)) {
    $lastName = $displayName.Substring($firstName.Length).Trim()
  }

  if ([string]::IsNullOrWhiteSpace($matchLabel)) {
    $matchLabel = if ((Normalize-Name $target.RequestedName) -eq (Normalize-Name $displayName)) { 'Exact' }
      else { 'Systeemmatch' }
  }
  $isUsable = -not [string]::IsNullOrWhiteSpace($firstName) -and
    -not [string]::IsNullOrWhiteSpace($lastName) -and
    $email -match '^[^\s@]+@[^\s@]+\.[^\s@]+$'
  $include = $isUsable
  if (-not $isUsable) { $matchLabel = 'Ontbrekende/ongeldige bronvelden' }

  $username = ''
  if ($isUsable) { $username = ConvertTo-Username -FullName $displayName }
  $prepared.Add([pscustomobject]@{
    RequestedName = $target.RequestedName
    SourceName = $displayName
    Row = $row.RowNumber
    EmployeeNumber = $employeeNumber
    ExpectedEmployeeNumber = $target.ExpectedEmployeeNumber
    Username = $username
    EmailPresent = -not [string]::IsNullOrWhiteSpace($email)
    PhonePresent = -not [string]::IsNullOrWhiteSpace($phone)
    Match = $matchLabel
    Include = $include
    FirstName = $firstName
    LastName = $lastName
    Email = $email
    Phone = $phone
    DisplayName = $displayName
  })
}

Write-Host "Bron: $((Resolve-Path -LiteralPath $WorkbookPath).Path)"
Write-Host 'Kolom A is "Zoeknaam"; voor de Keycloak-achternaam gebruikt dit script de volledige naam uit "Naam voluit".'
Write-Host 'Voornaam komt uit kolom B (Roepnaam), telefoon uit J en e-mail/alternative_email uit CE.'
Write-Host "Invoer: $EmployeeInput"

$preview = foreach ($item in $prepared) {
  $action = if ($item.Match -eq 'Geen match') { 'Niet uitvoeren' }
    elseif ($item.Match -eq 'Meerdere bronrijen') { 'Niet uitvoeren' }
    elseif ($item.Match -eq 'Ontbrekende/ongeldige bronvelden') { 'Niet uitvoeren' }
    elseif ($item.Include) { if ($Apply) { 'Verwerken' } else { 'Preview' } }
    else { 'Review nodig' }
  [pscustomobject]@{
    Naam = $item.RequestedName
    Bronnaam = $item.SourceName
    Rij = $item.Row
    Personeelsnummer = $item.EmployeeNumber
    OpgegevenPersoneelsnummer = $item.ExpectedEmployeeNumber
    Gebruikersnaam = $item.Username
    EmailAanwezig = $item.EmailPresent
    TelefoonAanwezig = $item.PhonePresent
    Match = $item.Match
    Actie = $action
  }
}
$preview | Format-Table Naam, Rij, Personeelsnummer, OpgegevenPersoneelsnummer, Gebruikersnaam, Match, Actie -AutoSize -Wrap | Out-String -Width 240 | Write-Host

if (-not $Apply) {
  Write-Host 'Preview klaar; Keycloak en PostgreSQL zijn niet gewijzigd. Voeg -Apply toe om de import te starten.'
  return
}

$selected = @($prepared | Where-Object Include)
if ($selected.Count -eq 0) { throw 'Geen eenduidige, complete medewerkers om te verwerken.' }

$dbConfiguredUser = Read-DotEnvValue -Path $envFile -Name 'PGUSER' -Default $appDbUser
$dbConfiguredName = Read-DotEnvValue -Path $envFile -Name 'PGDATABASE' -Default $appDbName
$appDbUser = $dbConfiguredUser
$appDbName = $dbConfiguredName
try {
  $tableCheck = Invoke-AppDatabaseQuery -Sql "select to_regclass('public.user_information')::text;"
  if ($tableCheck -ne 'user_information') { throw 'Tabel public.user_information niet gevonden.' }
}
catch {
  throw "Database-preflight mislukt; er zijn nog geen Keycloak-gebruikers aangemaakt. $($_.Exception.Message)"
}

$adminUsername = Read-Host 'Keycloak admin gebruikersnaam'
$adminPasswordSecure = Read-Host 'Keycloak admin wachtwoord' -AsSecureString
$adminPassword = [System.Net.NetworkCredential]::new('', $adminPasswordSecure).Password
$initialPasswordSecure = Read-Host 'Tijdelijk wachtwoord voor nieuwe accounts (voer VSVK in)' -AsSecureString
$initialPassword = [System.Net.NetworkCredential]::new('', $initialPasswordSecure).Password
if ([string]::IsNullOrWhiteSpace($adminUsername) -or [string]::IsNullOrWhiteSpace($adminPassword) -or
    [string]::IsNullOrWhiteSpace($initialPassword)) {
  throw 'Admin- en tijdelijke wachtwoorden zijn verplicht.'
}

$KeycloakBaseUrl = $KeycloakBaseUrl.TrimEnd('/')
$adminApi = "$KeycloakBaseUrl/admin/realms/$Realm"
$tokenUri = "$KeycloakBaseUrl/realms/master/protocol/openid-connect/token"
try {
  $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Post -ContentType 'application/x-www-form-urlencoded' -Body @{
    grant_type = 'password'; client_id = 'admin-cli'; username = $adminUsername; password = $adminPassword
  }
  $accessToken = $tokenResponse.access_token
}
finally { $adminPassword = $null }
if ([string]::IsNullOrWhiteSpace($accessToken)) { throw 'Keycloak gaf geen beheertoken terug.' }

try {
  $role = Invoke-KeycloakAdmin -Method GET -Path "/roles/$([uri]::EscapeDataString($realmRoleName))" -Body $null
}
catch { throw "Realmrol '$realmRoleName' niet gevonden; er zijn nog geen gebruikers aangemaakt. $($_.Exception.Message)" }

try {
  Invoke-KeycloakAdmin -Method GET -Path '/users?max=1' -Body $null | Out-Null
  $groupSearch = [uri]::EscapeDataString($groupName)
  Invoke-KeycloakAdmin -Method GET -Path "/groups?search=$groupSearch&briefRepresentation=true" -Body $null | Out-Null
}
catch {
  throw "Keycloak-autorisatiecontrole mislukt; er zijn nog geen gebruikers aangemaakt. Controleer dat de ingevoerde beheerder toegang heeft tot de realm '$Realm' en de Keycloak Admin API. $($_.Exception.Message)"
}

$selectedNames = ($selected | ForEach-Object { $_.RequestedName }) -join ', '
$confirmText = "Maak/verwerk $($selected.Count) accounts ($selectedNames) in realm '$Realm' en maak de profielrecords aan? Typ JA om door te gaan"
if ((Read-Host $confirmText) -cne 'JA') {
  Write-Host 'Afgebroken; Keycloak en PostgreSQL zijn niet gewijzigd.'
  return
}

$runResults = [System.Collections.Generic.List[object]]::new()
$groupId = $null
try {
  $groupSearch = [uri]::EscapeDataString($groupName)
  $groups = @(Invoke-KeycloakAdmin -Method GET -Path "/groups?search=$groupSearch&briefRepresentation=true" -Body $null)
  $group = @($groups | Where-Object { $_.name -ceq $groupName } | Select-Object -First 1)
  if ($group.Count -gt 0) {
    $groupId = $group[0].id
  }
  else {
    Invoke-KeycloakAdmin -Method POST -Path '/groups' -Body @{ name = $groupName } | Out-Null
    $groups = @(Invoke-KeycloakAdmin -Method GET -Path "/groups?search=$groupSearch&briefRepresentation=true" -Body $null)
    $group = @($groups | Where-Object { $_.name -ceq $groupName } | Select-Object -First 1)
    if ($group.Count -eq 0) { throw "Keycloak-groep '$groupName' kon niet worden aangemaakt of gevonden." }
    $groupId = $group[0].id
  }
  $groupGuid = [guid]::Empty
  if (-not [guid]::TryParse([string]$groupId, [ref]$groupGuid)) { throw 'Keycloak heeft geen geldig UUID voor de groep teruggegeven.' }
  $groupId = $groupGuid.ToString()
}
catch {
  $groupError = $_.Exception.Message
  foreach ($item in $selected) {
    $runResults.Add([pscustomobject]@{ Naam = $item.RequestedName; Rij = $item.Row; Gebruikersnaam = $item.Username; Keycloak = 'Niet gestart'; Rol = 'Niet gestart'; Groep = 'Mislukt'; Profiel = 'Niet gestart'; Details = $groupError })
  }
}

if ($null -ne $groupId) {
  foreach ($item in $selected) {
    $keycloakStatus = 'Mislukt'
    $roleStatus = 'Niet gestart'
    $groupStatus = 'Niet gestart'
    $profileStatus = 'Niet gestart'
    $details = [System.Collections.Generic.List[string]]::new()
    $userId = $null

    try {
      $userNameQuery = [uri]::EscapeDataString($item.Username)
      $emailQuery = [uri]::EscapeDataString($item.Email)
      $usernameMatches = @(Invoke-KeycloakAdmin -Method GET -Path "/users?username=$userNameQuery&exact=true" -Body $null)
      $emailMatches = @(Invoke-KeycloakAdmin -Method GET -Path "/users?email=$emailQuery&exact=true" -Body $null)
      if ($usernameMatches.Count -gt 1 -or $emailMatches.Count -gt 1) {
        throw 'Meerdere bestaande Keycloak-accounts gevonden.'
      }
      if ($usernameMatches.Count -eq 1) {
        $userId = [string]$usernameMatches[0].id
        if ([string]::IsNullOrWhiteSpace($userId)) { throw 'Bestaand Keycloak-account heeft geen gebruikers-ID.' }
        $encodedUserId = [uri]::EscapeDataString($userId)
        $existingUser = Invoke-KeycloakAdmin -Method GET -Path "/users/$encodedUserId" -Body $null
        $existingEmailProperty = $existingUser.PSObject.Properties['email']
        $existingEmail = if ($null -ne $existingEmailProperty) { [string]$existingEmailProperty.Value } else { '' }
        if ([string]::IsNullOrWhiteSpace($existingEmail)) {
          $existingUser | Add-Member -MemberType NoteProperty -Name email -Value $item.Email -Force
          Invoke-KeycloakAdmin -Method PUT -Path "/users/$encodedUserId" -Body $existingUser | Out-Null
          $existingUser = Invoke-KeycloakAdmin -Method GET -Path "/users/$encodedUserId" -Body $null
          $existingEmailProperty = $existingUser.PSObject.Properties['email']
          $existingEmail = if ($null -ne $existingEmailProperty) { [string]$existingEmailProperty.Value } else { '' }
          if (-not [string]::Equals($existingEmail, $item.Email, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Het ontbrekende e-mailadres kon niet veilig op het bestaande Keycloak-account worden ingesteld.'
          }
          $keycloakStatus = 'E-mailadres aangevuld'
        }
        elseif (-not [string]::Equals($existingEmail, $item.Email, [StringComparison]::OrdinalIgnoreCase)) {
          throw 'De gebruikersnaam bestaat al met een ander e-mailadres.'
        }
        else { $keycloakStatus = 'Bestond al' }
      }
      elseif ($emailMatches.Count -eq 1) {
        throw 'Het e-mailadres bestaat al onder een andere gebruikersnaam.'
      }
      else {
        $userPayload = @{
          username = $item.Username
          firstName = $item.FirstName
          lastName = $item.LastName
          email = $item.Email
          enabled = $true
          credentials = @(@{ type = 'password'; value = $initialPassword; temporary = $true })
        }
        Invoke-KeycloakAdmin -Method POST -Path '/users' -Body $userPayload | Out-Null
        $usernameMatches = @(Invoke-KeycloakAdmin -Method GET -Path "/users?username=$userNameQuery&exact=true" -Body $null)
        if ($usernameMatches.Count -ne 1) { throw 'Account aangemaakt, maar het nieuwe Keycloak-ID kon niet worden teruggelezen.' }
        $userId = $usernameMatches[0].id
        $keycloakStatus = 'Aangemaakt'
      }
      $subjectGuid = [guid]::Empty
      if (-not [guid]::TryParse([string]$userId, [ref]$subjectGuid)) {
        throw 'Keycloak heeft geen geldig UUID voor deze gebruiker teruggegeven.'
      }
      $userId = $subjectGuid.ToString()
    }
    catch {
      $details.Add("Keycloak: $($_.Exception.Message)")
    }

    if ($null -ne $userId) {
      try {
        $roles = @(Invoke-KeycloakAdmin -Method GET -Path "/users/$userId/role-mappings/realm" -Body $null)
        if (@($roles | Where-Object { $_.id -eq $role.id }).Count -eq 0) {
          Invoke-KeycloakAdmin -Method POST -Path "/users/$userId/role-mappings/realm" -Body @($role) | Out-Null
        }
        $roleStatus = 'OK'
      }
      catch { $roleStatus = 'Mislukt'; $details.Add("Rol: $($_.Exception.Message)") }

      try {
        $userGroups = @(Invoke-KeycloakAdmin -Method GET -Path "/users/$userId/groups" -Body $null)
        if (@($userGroups | Where-Object { $_.id -eq $groupId }).Count -eq 0) {
          Invoke-KeycloakAdmin -Method PUT -Path "/users/$userId/groups/$groupId" -Body $null | Out-Null
        }
        $groupStatus = 'OK'
      }
      catch { $groupStatus = 'Mislukt'; $details.Add("Groep: $($_.Exception.Message)") }

      try {
        $existingSubject = Invoke-AppDatabaseQuery -Sql "select keycloak_sub::text from public.user_information where keycloak_sub = '$userId'::uuid;"
        if ($existingSubject -eq $userId) {
          $profileStatus = 'Bestond al; niet overschreven'
        }
        else {
          $employeeProfile = ''
          if (-not [string]::IsNullOrWhiteSpace($item.EmployeeNumber)) {
            $employeeNumberSql = ConvertTo-SqlLiteral $item.EmployeeNumber
            $employeeProfile = Invoke-AppDatabaseQuery -Sql @"
select profile.keycloak_sub::text || '|' || profile.version::text || '|' ||
       (select count(*)::text from public.user_skills where keycloak_sub = profile.keycloak_sub)
from public.user_information profile
where profile.employee_number = $employeeNumberSql;
"@
          }

          if (-not [string]::IsNullOrWhiteSpace($employeeProfile)) {
            $profileParts = $employeeProfile -split '\|'
            $profileVersion = 0L
            $skillCount = 0
            if ($profileParts.Count -ne 3 -or
                -not [long]::TryParse($profileParts[1], [ref]$profileVersion) -or
                -not [int]::TryParse($profileParts[2], [ref]$skillCount)) {
              throw 'Het bestaande profiel kon niet veilig worden ingelezen voor her-koppeling.'
            }
            $oldSubject = $profileParts[0]
            if ($oldSubject -eq $userId) {
              $profileStatus = 'Bestond al; niet overschreven'
            }
            elseif (Test-KeycloakUserExists -UserId $oldSubject) {
              throw "Personeelsnummer '$($item.EmployeeNumber)' is nog gekoppeld aan een bestaand Keycloak-account; het profiel is niet overgenomen."
            }
            elseif ($skillCount -gt 0) {
              throw "Het verweesde profiel voor personeelsnummer '$($item.EmployeeNumber)' heeft nog vaardigheidskoppelingen; die zijn behouden en vereisen een aparte her-koppeling."
            }
            else {
              $relinkedSubject = Invoke-AppDatabaseQuery -Sql @"
update public.user_information
set keycloak_sub = '$userId'::uuid,
    version = version + 1,
    updated_at = now()
where employee_number = $employeeNumberSql
  and keycloak_sub = '$oldSubject'::uuid
  and version = $profileVersion
  and not exists (select 1 from public.user_skills where keycloak_sub = '$oldSubject'::uuid)
returning keycloak_sub::text;
"@
              if ($relinkedSubject -ne $userId) {
                throw 'Het profiel veranderde tijdens de her-koppeling; de actuele databaseversie is behouden.'
              }
              $profileStatus = 'Bestaand profiel opnieuw gekoppeld'
            }
          }
          else {
            $sql = @"
insert into public.user_information
  (keycloak_sub, employee_number, display_name, email_address, phone_number, alternative_email)
values
  ('$userId'::uuid, $(ConvertTo-SqlLiteral $item.EmployeeNumber), $(ConvertTo-SqlLiteral $item.DisplayName),
   $(ConvertTo-SqlLiteral $item.Email), $(ConvertTo-SqlLiteral $item.Phone), $(ConvertTo-SqlLiteral $item.Email))
on conflict (keycloak_sub) do nothing
returning keycloak_sub::text;
"@
            $insertedSubject = Invoke-AppDatabaseQuery -Sql $sql
            if (-not [string]::IsNullOrWhiteSpace($insertedSubject)) {
              $profileStatus = 'Aangemaakt'
            }
            else {
              $existingSubject = Invoke-AppDatabaseQuery -Sql "select keycloak_sub::text from public.user_information where keycloak_sub = '$userId'::uuid;"
              if ($existingSubject -eq $userId) { $profileStatus = 'Bestond al; niet overschreven' }
              else { throw 'Geen profiel aangemaakt; controleer mogelijk een dubbel personeelsnummer.' }
            }
          }
        }
      }
      catch { $profileStatus = 'Mislukt'; $details.Add("Profiel: $($_.Exception.Message)") }
    }

    $runResults.Add([pscustomobject]@{
      Naam = $item.RequestedName
      Rij = $item.Row
      Gebruikersnaam = $item.Username
      Keycloak = $keycloakStatus
      Rol = $roleStatus
      Groep = $groupStatus
      Profiel = $profileStatus
      Details = ($details -join ' | ')
    })
  }
}

$initialPassword = $null
$runResults | Format-Table -AutoSize -Wrap
$failed = @($runResults | Where-Object { $_.Keycloak -eq 'Mislukt' -or $_.Rol -eq 'Mislukt' -or $_.Groep -eq 'Mislukt' -or $_.Profiel -eq 'Mislukt' }).Count
Write-Host "Klaar: $($runResults.Count - $failed) zonder fouten verwerkt; $failed met fouten. Herhaal veilig om mislukte profiel- of rolstappen af te maken."
