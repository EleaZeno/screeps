# Auto-retry: place spawn back into E9N52 (24,28) the moment it unblocks.
$token='3456b576-97ec-41bb-90a3-5951670ba79b'
$h=@{'X-Token'=$token}
# 1) Is E9N52 still prohibited?
try {
  $p = Invoke-RestMethod -Uri 'https://screeps.com/api/user/respawn-prohibited-rooms' -Method Get -Headers $h
} catch { Write-Output "ERR prohibited-check: $($_.Exception.Message)"; exit 1 }
if ($p.rooms -contains 'E9N52') {
  Write-Output "STILL_PROHIBITED E9N52 (prohibited rooms: $($p.rooms -join ','))"
  exit 0
}
# 2) Confirm still need spawn (world empty)
try {
  $w = Invoke-RestMethod -Uri 'https://screeps.com/api/user/world-status' -Method Get -Headers $h
} catch { Write-Output "ERR world-status: $($_.Exception.Message)"; exit 1 }
if ($w.status -ne 'empty') {
  Write-Output "WORLD_NOT_EMPTY status=$($w.status) (already have a spawn?) -- aborting auto-place"
  exit 0
}
# 3) Place spawn at (24,28)
$body = @{room='E9N52';x=24;y=28;name='Spawn1';shard='shard3'} | ConvertTo-Json
try {
  $r = Invoke-RestMethod -Uri 'https://screeps.com/api/game/place-spawn' -Method Post -Headers $h -ContentType 'application/json' -Body $body
  Write-Output ("PLACE_RESULT: " + ($r | ConvertTo-Json -Compress))
} catch {
  Write-Output ("PLACE_ERR: " + $_.Exception.Message + " | " + $_.ErrorDetails.Message)
}
