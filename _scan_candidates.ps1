# Scan a grid of rooms around the old region for source count + ownership.
$token='3456b576-97ec-41bb-90a3-5951670ba79b'
$h=@{'X-Token'=$token}
# Build room list: E0..E20, N45..N60 (wide net around old E9N52)
$rooms=@()
foreach($ex in 0..20){ foreach($ny in 45..60){ $rooms += "E${ex}N${ny}" } }
"Total rooms to scan: $($rooms.Count)"
$body = @{ rooms=$rooms; shard='shard3'; statName='owner0' } | ConvertTo-Json
$res = Invoke-RestMethod -Uri 'https://screeps.com/api/game/map-stats' -Method Post -Headers $h -ContentType 'application/json' -Body $body
$out=@()
foreach($k in $res.stats.PSObject.Properties.Name){
  $r=$res.stats.$k
  $owner = if($r.own){$r.own.user}else{''}
  $status = $r.status
  $sk = if($r.sourceKeeper){'SK'}else{''}
  $novice = $r.novice
  $out += [pscustomobject]@{room=$k; status=$status; owner=$owner; sk=$sk; novice=$novice}
}
$out | Where-Object { $_.status -eq 'normal' -and -not $_.owner -and -not $_.sk } | Format-Table -AutoSize
"=== owned/SK (skip) count: " + ($out | Where-Object { $_.owner -or $_.sk }).Count
