param(
  [string]$FreeCadCmd = 'D:\Program Files\FreeCAD 1.0\bin\freecadcmd.exe',
  [double]$Tolerance = 0.03,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Converter = Join-Path $PSScriptRoot 'convert-step-models.py'

if (-not (Test-Path -LiteralPath $FreeCadCmd -PathType Leaf)) {
  throw "FreeCAD command-line executable not found: $FreeCadCmd"
}

$PreviousRoot = $env:GERBER3D_PROJECT_ROOT
$PreviousTolerance = $env:GERBER3D_TOLERANCE
$PreviousForce = $env:GERBER3D_FORCE
try {
  $env:GERBER3D_PROJECT_ROOT = $ProjectRoot
  $env:GERBER3D_TOLERANCE = $Tolerance.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  $env:GERBER3D_FORCE = if ($Force) { '1' } else { '0' }
  $EscapedConverter = $Converter.Replace("'", "\'")
  $PythonCommand = "exec(compile(open(r'$EscapedConverter', encoding='utf-8').read(), r'$EscapedConverter', 'exec'))"
  & $FreeCadCmd -c $PythonCommand
  if ($LASTEXITCODE -ne 0) {
    throw "STEP to GLB conversion failed with exit code $LASTEXITCODE"
  }
} finally {
  $env:GERBER3D_PROJECT_ROOT = $PreviousRoot
  $env:GERBER3D_TOLERANCE = $PreviousTolerance
  $env:GERBER3D_FORCE = $PreviousForce
}
