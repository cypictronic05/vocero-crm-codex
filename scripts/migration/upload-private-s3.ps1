[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ArtifactDirectory,
  [Parameter(Mandatory = $true)][string]$Bucket,
  [Parameter(Mandatory = $true)][string]$Prefix,
  [string]$Region = "auto",
  [string]$EndpointUrl = ""
)

$ErrorActionPreference = "Stop"
if (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY) {
  throw "Define AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY solo en esta sesion"
}
if (-not (Test-Path -LiteralPath $ArtifactDirectory -PathType Container)) {
  throw "No existe el directorio de artefactos"
}
if ($Prefix -match '(^/|\.\.)') { throw "Prefix no es seguro" }

$manifestPath = Join-Path $ArtifactDirectory "manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Falta manifest.json" }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$required = @($manifest.database.file, $manifest.media.file, "manifest.json", $manifest.integrityReport)
$awsBase = @("--region", $Region)
if ($EndpointUrl) { $awsBase += @("--endpoint-url", $EndpointUrl) }

& aws @awsBase s3api head-bucket --bucket $Bucket | Out-Null
if ($LASTEXITCODE -ne 0) { throw "AWS CLI no pudo acceder al bucket privado" }

$normalizedPrefix = $Prefix.Trim("/")
foreach ($name in $required) {
  $local = Join-Path $ArtifactDirectory $name
  if (-not (Test-Path -LiteralPath $local -PathType Leaf)) { throw "Falta $name" }
  $remote = "s3://$Bucket/$normalizedPrefix/$name"
  & aws @awsBase s3 cp $local $remote --only-show-errors
  if ($LASTEXITCODE -ne 0) { throw "Fallo la carga privada de $name" }
}

Write-Host "Carga completada en el prefijo privado: $normalizedPrefix"
Write-Host "Ruta para Restore de EasyPanel: $normalizedPrefix/$($manifest.database.file)"
Write-Host "No habilites acceso publico ni generes una URL permanente."
