param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageJson = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
if (-not $Version) {
  $Version = $packageJson.version
}

$releaseDir = Join-Path $root "release"
$appDir = Join-Path $releaseDir "win-unpacked"
if (-not (Test-Path $appDir)) {
  throw "Missing packaged app directory: $appDir"
}

$workDir = Join-Path $env:TEMP "KortexInstaller"
$targetInTemp = Join-Path $workDir "Kortex-Setup-$Version.exe"
$targetInstaller = Join-Path $releaseDir "Kortex-Setup-$Version.exe"
$zipPath = Join-Path $workDir "app.zip"
$installScriptPath = Join-Path $workDir "install.ps1"
$sedPath = Join-Path $workDir "installer.sed"
$powershellExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

Compress-Archive -Path (Join-Path $appDir "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

$installScript = @'
$ErrorActionPreference = "Stop"

$installDir = Join-Path $env:LOCALAPPDATA "Kortex"
$desktopDir = [Environment]::GetFolderPath("DesktopDirectory")
$startMenuDir = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"
$tempDir = Join-Path $env:TEMP ("Kortex_" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $PSScriptRoot "app.zip"

function New-AppShortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetPath
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $TargetPath
  $shortcut.WorkingDirectory = Split-Path -Parent $TargetPath
  $shortcut.IconLocation = $TargetPath
  $shortcut.Save()
}

New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $tempDir -Force

if (Test-Path $installDir) {
  Remove-Item -LiteralPath $installDir -Recurse -Force
}

Move-Item -LiteralPath $tempDir -Destination $installDir

$exePath = Join-Path $installDir "Kortex.exe"
New-AppShortcut -ShortcutPath (Join-Path $desktopDir "Kortex.lnk") -TargetPath $exePath
New-AppShortcut -ShortcutPath (Join-Path $startMenuDir "Kortex.lnk") -TargetPath $exePath

$uninstallPath = Join-Path $installDir "Uninstall Kortex.ps1"
$uninstallScript = @"
`$ErrorActionPreference = "SilentlyContinue"
`$installDir = Split-Path -Parent `$MyInvocation.MyCommand.Path
Remove-Item -LiteralPath (Join-Path ([Environment]::GetFolderPath("DesktopDirectory")) "Kortex.lnk") -Force
Remove-Item -LiteralPath (Join-Path (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs") "Kortex.lnk") -Force
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command Start-Sleep -Seconds 1; Remove-Item -LiteralPath ```"`$installDir```" -Recurse -Force"
"@
Set-Content -LiteralPath $uninstallPath -Value $uninstallScript -Encoding UTF8

Write-Host "Kortex installed. Use the desktop shortcut to open it."
'@

Set-Content -LiteralPath $installScriptPath -Value $installScript -Encoding UTF8

$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$targetInTemp
FriendlyName=Kortex
AppLaunched=$powershellExe -NoProfile -ExecutionPolicy Bypass -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=$powershellExe -NoProfile -ExecutionPolicy Bypass -File install.ps1
UserQuietInstCmd=$powershellExe -NoProfile -ExecutionPolicy Bypass -File install.ps1
SourceFiles=SourceFiles
[Strings]
FILE0="app.zip"
FILE1="install.ps1"
[SourceFiles]
SourceFiles0=$workDir\
[SourceFiles0]
%FILE0%=
%FILE1%=
"@

Set-Content -LiteralPath $sedPath -Value $sed -Encoding ASCII

Remove-Item -LiteralPath $targetInTemp -Force -ErrorAction SilentlyContinue
$iexpress = Start-Process -FilePath "iexpress.exe" -ArgumentList @("/N", "/Q", $sedPath) -Wait -PassThru
if (-not (Test-Path $targetInTemp)) {
  throw "IExpress failed with exit code $($iexpress.ExitCode)"
}

Copy-Item -LiteralPath $targetInTemp -Destination $targetInstaller -Force
Write-Host "Installer created: $targetInstaller"
