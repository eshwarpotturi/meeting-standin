# Refreshes brain-context\repos with the README of every public repo of a GitHub user, so the stand-in knows your latest projects.
# Run it before a meeting. Needs internet access to api.github.com and raw.githubusercontent.com.
param([string]$User = "eshwarpotturi", [string]$Dir = "$PSScriptRoot\brain-context\repos")
$ErrorActionPreference = "Stop"
function Log($m) { Write-Host ("{0} [sync] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffzzz"), $m) }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$repos = Invoke-RestMethod -Uri "https://api.github.com/users/$User/repos?per_page=100&sort=pushed" -Headers @{ "User-Agent" = "meeting-standin-sync" }
$done = 0
foreach ($r in $repos) {
  $done++
  $got = $false
  foreach ($b in @($r.default_branch, "main", "master")) {
    try {
      $text = (Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$User/$($r.name)/$b/README.md").Content
      $head = "# $($r.name)`n`n$($r.description)`n`nRepo: $($r.html_url)`n`n"
      [IO.File]::WriteAllText((Join-Path $Dir ($r.name + ".md")), $head + $text, (New-Object Text.UTF8Encoding($false)))
      $got = $true; break
    } catch { }
  }
  Log ("{0}/{1} {2}: {3}" -f $done, $repos.Count, $r.name, $(if ($got) { "saved" } else { "no README" }))
}
Log "done"
