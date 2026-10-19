[CmdletBinding()]
param(
  [string]$OutputRoot = (Join-Path (Get-Location) "migration-artifacts"),
  [string]$ComposeFile = "docker-compose.yml",
  [string]$DatabaseService = "postgres",
  [string]$ApplicationService = "app",
  [string]$DatabaseName = "vocero",
  [string]$DatabaseUser = "postgres"
)

$ErrorActionPreference = "Stop"
$stamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$destination = Join-Path $OutputRoot "nexora-$stamp"
$temporaryDatabase = "/tmp/nexora-$stamp-$PID.dump"
$temporaryMedia = "/tmp/nexora-media-$stamp-$PID.tar.gz"

function Assert-LastExitCode([string]$Step) {
  if ($LASTEXITCODE -ne 0) { throw "$Step fallo con codigo $LASTEXITCODE" }
}

if (Test-Path -LiteralPath $destination) { throw "El destino ya existe: $destination" }
New-Item -ItemType Directory -Path $destination | Out-Null

$postgresContainer = (& docker compose -f $ComposeFile ps -q $DatabaseService).Trim()
Assert-LastExitCode "Localizar PostgreSQL"
$applicationContainer = (& docker compose -f $ComposeFile ps -q $ApplicationService).Trim()
Assert-LastExitCode "Localizar la aplicacion"
if (-not $postgresContainer -or -not $applicationContainer) {
  throw "PostgreSQL y la aplicacion deben estar en ejecucion"
}

$databaseFile = Join-Path $destination "nexora-database-$stamp.sql.gz"
$mediaFile = Join-Path $destination "nexora-media-$stamp.tar.gz"
$reportFile = Join-Path $destination "source-integrity.txt"

try {
  & docker exec $postgresContainer pg_dump -U $DatabaseUser -d $DatabaseName `
    --format=custom --compress=0 --no-owner --no-acl --file=$temporaryDatabase
  Assert-LastExitCode "Crear pg_dump"
  & docker exec $postgresContainer gzip -9 $temporaryDatabase
  Assert-LastExitCode "Comprimir pg_dump"
  & docker exec $postgresContainer sh -c "gzip -t '$temporaryDatabase.gz' && gunzip -c '$temporaryDatabase.gz' | pg_restore --list >/dev/null"
  Assert-LastExitCode "Validar pg_dump"
  & docker cp "${postgresContainer}:$temporaryDatabase.gz" $databaseFile
  Assert-LastExitCode "Copiar pg_dump"

  & docker exec $applicationContainer tar -C /data -czf $temporaryMedia media
  Assert-LastExitCode "Empaquetar adjuntos"
  & docker exec $applicationContainer tar -tzf $temporaryMedia
  Assert-LastExitCode "Validar adjuntos"
  & docker cp "${applicationContainer}:$temporaryMedia" $mediaFile
  Assert-LastExitCode "Copiar adjuntos"

  Get-Content -Raw (Join-Path $PSScriptRoot "integrity.sql") |
    & docker exec -i $postgresContainer psql -X -U $DatabaseUser -d $DatabaseName |
    Set-Content -LiteralPath $reportFile -Encoding utf8
  Assert-LastExitCode "Generar informe de integridad"

  $postgresVersion = (& docker exec $postgresContainer psql -X -U $DatabaseUser -d $DatabaseName -Atc "SHOW server_version;").Trim()
  Assert-LastExitCode "Leer version de PostgreSQL"
  $sourceCommit = (& git rev-parse HEAD).Trim()
  Assert-LastExitCode "Leer commit de origen"

  $manifest = [ordered]@{
    format = "nexora-easypanel-migration-v1"
    createdAtUtc = [DateTime]::UtcNow.ToString("o")
    sourceCommit = $sourceCommit
    postgresVersion = $postgresVersion
    database = [ordered]@{
      file = [IO.Path]::GetFileName($databaseFile)
      bytes = (Get-Item -LiteralPath $databaseFile).Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $databaseFile).Hash.ToLowerInvariant()
    }
    media = [ordered]@{
      file = [IO.Path]::GetFileName($mediaFile)
      bytes = (Get-Item -LiteralPath $mediaFile).Length
      sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $mediaFile).Hash.ToLowerInvariant()
    }
    integrityReport = [IO.Path]::GetFileName($reportFile)
  }
  $manifestPath = Join-Path $destination "manifest.json"
  [IO.File]::WriteAllText(
    $manifestPath,
    ($manifest | ConvertTo-Json -Depth 5),
    [Text.UTF8Encoding]::new($false)
  )

  Write-Host "Exportacion verificada: $destination"
  Write-Host "No contiene ENCRYPTION_KEY, BETTER_AUTH_SECRET ni archivos .env."
  Write-Host "Conserva este directorio fuera de Git y subelo solo a almacenamiento privado."
}
finally {
  & docker exec $postgresContainer rm -f "$temporaryDatabase" "$temporaryDatabase.gz" 2>$null
  & docker exec $applicationContainer rm -f "$temporaryMedia" 2>$null
}
