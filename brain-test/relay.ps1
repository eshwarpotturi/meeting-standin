# Relay: lets the AI stand-in in your Meet tab ask LLM Foundry, without the key ever entering the page.
# Listens on this laptop only (127.0.0.1) and answers only to https://meet.google.com. Stop it with Ctrl+C.
param(
  [string]$TokenFile = "$PSScriptRoot\..\..\Innovation\AIA-Gov\.foundry-token.txt",
  [string]$PackFile = "$PSScriptRoot\brain-pack.txt",
  [string]$Base = "https://llmfoundry.straivedemo.com",
  [string]$Model = "gpt-4.1-mini",
  [int]$Port = 8765
)
$ErrorActionPreference = "Stop"
function Log($m) { Write-Host ("{0} [relay] {1}" -f (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffzzz"), $m) }
if (-not (Test-Path $TokenFile)) { throw "Token file not found: $TokenFile (pass -TokenFile)" }
$token = (Get-Content $TokenFile -Raw).Trim()
$pack = Get-Content $PackFile -Raw
function Send($res, $code, $text, $type = "application/json; charset=utf-8") {
  $b = [Text.Encoding]::UTF8.GetBytes($text)
  $res.StatusCode = $code; $res.ContentType = $type; $res.ContentLength64 = $b.Length
  $res.OutputStream.Write($b, 0, $b.Length)
}
function Decide($question, $recent, $name) {
  $system = "You are the decision brain of a labelled AI stand-in that attends a meeting for $name. You answer only yes/no questions put to $name. Use only the context pack below. If the context pack does not clearly settle the question, answer `"unsure`" with low confidence. Confidence is how sure you are that $name himself would give this answer. Reply with JSON only: {`"answer`":`"yes`"|`"no`"|`"unsure`",`"confidence`":0-100,`"reason`":`"one plain sentence, first person, at most 25 words`"}."
  $user = "Context pack:`n$pack`n`nRecent meeting lines:`n$recent`n`nQuestion for ${name}: $question"
  $body = @{ model = $Model; temperature = 0; messages = @(@{ role = "system"; content = $system }, @{ role = "user"; content = $user }) } | ConvertTo-Json -Depth 6
  $r = Invoke-RestMethod -Uri "$Base/openai/v1/chat/completions" -Method Post -TimeoutSec 20 -ContentType "application/json; charset=utf-8" `
    -Headers @{ Authorization = "Bearer ${token}:meeting-standin" } -Body ([Text.Encoding]::UTF8.GetBytes($body))
  $text = $r.choices[0].message.content
  if ($text -match "\{[\s\S]*\}") { return $Matches[0] }
  return '{"answer":"unsure","confidence":0,"reason":"I could not read the answer."}'
}
function Answer($question, $recent, $name) {
  $system = "You are the brain of a labelled AI stand-in that attends a meeting for $name. Someone asked $name an open question. Use only the context pack below. If it does not clearly cover the question, reply {`"answer`":`"unsure`",`"confidence`":0}. Otherwise reply with JSON only: {`"answer`":`"open`",`"confidence`":0-100,`"chat`":`"at most 2 short sentences, first person`",`"slides`":[{`"title`":`"at most 6 words`",`"text`":`"at most 25 words`"}],`"chart`":null or {`"type`":`"pie`" or `"bar`",`"title`":`"...`",`"items`":[{`"label`":`"...`",`"value`":number}]}}. Use 1 to 3 slides. Add a chart only if the context pack has real numbers for it; never invent numbers. Confidence is how sure you are that $name himself would say this."
  $user = "Context pack:`n$pack`n`nRecent meeting lines:`n$recent`n`nQuestion for ${name}: $question"
  $body = @{ model = $Model; temperature = 0; messages = @(@{ role = "system"; content = $system }, @{ role = "user"; content = $user }) } | ConvertTo-Json -Depth 6
  $r = Invoke-RestMethod -Uri "$Base/openai/v1/chat/completions" -Method Post -TimeoutSec 25 -ContentType "application/json; charset=utf-8" `
    -Headers @{ Authorization = "Bearer ${token}:meeting-standin" } -Body ([Text.Encoding]::UTF8.GetBytes($body))
  $text = $r.choices[0].message.content
  if ($text -match "\{[\s\S]*\}") { return $Matches[0] }
  return '{"answer":"unsure","confidence":0}'
}
Add-Type -AssemblyName System.Speech
function Speak($text) {
  $tmp = [IO.Path]::Combine([IO.Path]::GetTempPath(), "standin-" + [guid]::NewGuid().ToString("N") + ".wav")
  $syn = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try { $syn.Rate = 0; $syn.SetOutputToWaveFile($tmp); $syn.Speak($text); $syn.SetOutputToNull() } finally { $syn.Dispose() }
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tmp)); Remove-Item $tmp -Force
  return $b64
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Log "Listening on http://127.0.0.1:$Port (Meet only). Leave this window open. Ctrl+C to stop."
$n = 0
while ($listener.IsListening) {
  $ctx = $listener.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  try {
    $origin = $req.Headers["Origin"]
    if ($origin -and $origin -ne "https://meet.google.com" -and $origin -ne "http://127.0.0.1:$Port") { Send $res 403 '{"error":"not allowed"}'; continue }
    if ($origin) {
      $res.Headers.Add("Access-Control-Allow-Origin", $origin)
      $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
      $res.Headers.Add("Access-Control-Allow-Headers", "content-type")
      $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
    }
    if ($req.HttpMethod -eq "OPTIONS") { $res.StatusCode = 204; continue }
    if ($req.Url.AbsolutePath -eq "/ping") { Send $res 200 "pong"; continue }
    if ($req.Url.AbsolutePath -eq "/bridge") {
      $page = (Get-Content "$PSScriptRoot\relay-bridge.html" -Raw).Replace("__ALLOWED_ORIGIN__", "https://meet.google.com")
      Send $res 200 $page "text/html; charset=utf-8"; continue
    }
    if ($req.Url.AbsolutePath -eq "/decide" -and $req.HttpMethod -eq "POST") {
      $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8); $in = $sr.ReadToEnd() | ConvertFrom-Json
      $n++; $sw = [Diagnostics.Stopwatch]::StartNew()
      $out = Decide $in.question $in.recent $in.userName
      Log ("question {0}: {1} -> {2} ({3} ms)" -f $n, $in.question, ($out -replace "\s+", " "), $sw.ElapsedMilliseconds)
      Send $res 200 $out; continue
    }
    if ($req.Url.AbsolutePath -eq "/answer" -and $req.HttpMethod -eq "POST") {
      $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8); $in = $sr.ReadToEnd() | ConvertFrom-Json
      $n++; $sw = [Diagnostics.Stopwatch]::StartNew()
      $out = Answer $in.question $in.recent $in.userName
      Log ("open question {0}: {1} -> {2} ({3} ms)" -f $n, $in.question, ($out -replace "\s+", " "), $sw.ElapsedMilliseconds)
      Send $res 200 $out; continue
    }
    if ($req.Url.AbsolutePath -eq "/tts" -and $req.HttpMethod -eq "POST") {
      $sr = New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8); $in = $sr.ReadToEnd() | ConvertFrom-Json
      $text = [string]$in.text; if ($text.Length -gt 400) { $text = $text.Substring(0, 400) }
      $sw = [Diagnostics.Stopwatch]::StartNew(); $b64 = Speak $text
      Log ("voice: {0} chars -> {1} ms" -f $text.Length, $sw.ElapsedMilliseconds)
      Send $res 200 (@{ wav = $b64 } | ConvertTo-Json -Compress); continue
    }
    Send $res 404 '{"error":"not found"}'
  } catch {
    $msg = $_.Exception.Message -replace "eyJ[\w\-\.:]+", "[token hidden]"
    Log "error: $msg"
    try { Send $res 502 ('{"error":"' + ($msg -replace '"', "'") + '"}') } catch {}
  } finally { $res.Close() }
}
