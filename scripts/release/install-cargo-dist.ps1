$ErrorActionPreference = "Stop"

# The Windows ARM runner can execute the signed x64 build under emulation. The
# pinned digest keeps the release tool immutable even if a mutable installer
# script or release metadata changes later.
$Version = "0.31.0"
$Asset = "cargo-dist-x86_64-pc-windows-msvc.zip"
$ExpectedSha256 = "a14e17557b269b101405e0cc6b647581d56313c954a51c7fddd423bba21e17b2"
$DownloadDirectory = Join-Path ([IO.Path]::GetTempPath()) ("gpt-image-2-cargo-dist-" + [Guid]::NewGuid())
$ArchivePath = Join-Path $DownloadDirectory $Asset

New-Item -ItemType Directory -Path $DownloadDirectory | Out-Null
try {
  $Uri = "https://github.com/axodotdev/cargo-dist/releases/download/v$Version/$Asset"
  Invoke-WebRequest -Uri $Uri -OutFile $ArchivePath

  $ActualSha256 = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualSha256 -ne $ExpectedSha256) {
    throw "cargo-dist archive checksum mismatch for $Asset"
  }

  Expand-Archive -Path $ArchivePath -DestinationPath $DownloadDirectory -Force
  $Binary = Get-ChildItem -Path $DownloadDirectory -Filter dist.exe -File -Recurse | Select-Object -First 1
  if (-not $Binary) {
    throw "Verified cargo-dist archive did not contain dist.exe"
  }

  $CargoRoot = if ($env:CARGO_HOME) { $env:CARGO_HOME } else { Join-Path $env:USERPROFILE ".cargo" }
  $CargoBinDirectory = Join-Path $CargoRoot "bin"
  New-Item -ItemType Directory -Path $CargoBinDirectory -Force | Out-Null
  Copy-Item -Path $Binary.FullName -Destination (Join-Path $CargoBinDirectory "dist.exe") -Force
  if ($env:GITHUB_PATH) {
    Add-Content -Path $env:GITHUB_PATH -Value $CargoBinDirectory
  }
  & (Join-Path $CargoBinDirectory "dist.exe") --version
}
finally {
  Remove-Item -Path $DownloadDirectory -Recurse -Force -ErrorAction SilentlyContinue
}
