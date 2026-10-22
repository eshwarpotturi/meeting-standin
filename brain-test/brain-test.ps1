# Brain test for the AI stand-in. Sends 30 questions to LLM Foundry and scores the answers.
# The token is read from the file and sent only to Foundry. It is never printed or saved.
param(
  [string]$TokenFile = "$PSScriptRoot\..\..\Innovation\AIA-Gov\.foundry-token.txt",
  [string]$Base = "https://llmfoundry.straivedemo.com",
  [string]$Model = "gpt-4.1-mini",
  [int]$Threshold = 75
)
$ErrorActionPreference = "Stop"
function Log($msg, $i, $n) { $p = if ($n) { " [$i/$n]" } else { "" }; Write-Host ("{0}{1} {2}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffzzz"), $p, $msg) }
if (-not (Test-Path $TokenFile)) { throw "Token file not found: $TokenFile (pass -TokenFile)" }
$token = (Get-Content $TokenFile -Raw).Trim()
$pack = Get-Content "$PSScriptRoot\brain-pack.txt" -Raw
$qs = Get-Content "$PSScriptRoot\brain-questions.json" -Raw | ConvertFrom-Json
$name = "Eswar"
$system = "You are the decision brain of a labelled AI stand-in that attends a meeting for $name. You answer only yes/no questions put to $name. Use only the context pack below. If the context pack does not clearly settle the question, answer `"unsure`" with low confidence. Confidence is how sure you are that $name himself would give this answer. Reply with JSON only: {`"answer`":`"yes`"|`"no`"|`"unsure`",`"confidence`":0-100,`"reason`":`"one plain sentence, first person, at most 25 words`"}."
$n = $qs.Count; $i = 0; $cost = 0.0; $rows = @(); $lat = @()
Log "Start: $n questions, model $Model, limit $Threshold%" 0 $n
foreach ($item in $qs) {
  $i++
  $user = "Context pack:`n$pack`n`nRecent meeting lines:`n(none)`n`nQuestion for ${name}: $($item.q)"
  $body = @{ model = $Model; temperature = 0; messages = @(@{ role = "system"; content = $system }, @{ role = "user"; content = $user }) } | ConvertTo-Json -Depth 6
  $sw = [Diagnostics.Stopwatch]::StartNew()
  try {
    $r = Invoke-RestMethod -Uri "$Base/openai/v1/chat/completions" -Method Post -TimeoutSec 90 -ContentType "application/json; charset=utf-8" `
      -Headers @{ Authorization = "Bearer ${token}:meeting-standin" } -Body ([Text.Encoding]::UTF8.GetBytes($body))
  } catch {
    $msg = $_.Exception.Message -replace "eyJ[\w\-\.:]+", "[token hidden]"
    if ($msg -match "401|403") { throw "Foundry refused the token (expired or wrong). Get a new one from LLM Foundry and save it in the token file. $msg" }
    throw "Call $i failed: $msg"
  }
  $sw.Stop(); $lat += $sw.ElapsedMilliseconds
  $u = $r.usage; $cost += (($u.prompt_tokens * 0.4) + ($u.completion_tokens * 1.6)) / 1e6
  $text = $r.choices[0].message.content
  $ans = "unsure"; $conf = 0; $why = ""
  if ($text -match "\{[\s\S]*\}") { try { $o = $Matches[0] | ConvertFrom-Json; $ans = "$($o.answer)".ToLower(); $conf = [int]$o.confidence; $why = "$($o.reason)" } catch { $ans = "unsure"; $conf = 0 } }
  if ($ans -eq "unsure" -and $conf -gt 50) { $conf = 50 }
  $answered = ($ans -ne "unsure") -and ($conf -ge $Threshold)
  $truth = $item.truth
  if ($truth -eq "unsure") { $verdict = if ($answered) { "BAD: answered a question the notes cannot settle" } else { "ok: held" } }
  else { $verdict = if (-not $answered) { "missed: held an answerable question" } elseif ($ans -eq $truth) { "ok: correct" } else { "BAD: confident and wrong" } }
  $rows += [pscustomobject]@{ q = $item.q; truth = $truth; answer = $ans; confidence = $conf; verdict = $verdict; reason = $why; ms = $sw.ElapsedMilliseconds }
  Log ("{0} -> {1} {2}% ({3} ms) {4}" -f $item.q, $ans, $conf, $sw.ElapsedMilliseconds, $verdict) $i $n
}
$rows | ConvertTo-Json -Depth 4 | Set-Content "$PSScriptRoot\brain-results.json" -Encoding UTF8
$answerable = $rows | Where-Object { $_.truth -ne "unsure" }; $unans = $rows | Where-Object { $_.truth -eq "unsure" }
$ok = ($answerable | Where-Object { $_.verdict -eq "ok: correct" }).Count
$bad = ($rows | Where-Object { $_.verdict -like "BAD*" }).Count
$held = ($unans | Where-Object { $_.verdict -eq "ok: held" }).Count
$sorted = $lat | Sort-Object
Write-Host ""
Log ("RESULT: answerable questions answered correctly {0}/{1}; unanswerable held {2}/{3}; confident wrong answers {4}" -f $ok, $answerable.Count, $held, $unans.Count, $bad)
Log ("Speed: median {0} ms, slowest {1} ms (target for the whole reply: under 3000 ms)" -f $sorted[[int]($sorted.Count / 2)], $sorted[-1])
Log ("Cost: about {0:N2} INR (1 USD = 100 INR)" -f ($cost * 100))
Log "Details saved in brain-results.json"
