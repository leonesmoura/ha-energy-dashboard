$ErrorActionPreference = 'Stop'

function Read-DotEnv([string]$Name) {
  $line = Get-Content (Join-Path $PSScriptRoot '..\.env') | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) { throw "Variável $Name não encontrada no .env" }
  return $line.Substring($Name.Length + 1)
}

function Receive-HaMessage($Socket, [byte[]]$Buffer) {
  $stream = New-Object System.IO.MemoryStream
  do {
    $segment = [ArraySegment[byte]]::new($Buffer)
    $result = $Socket.ReceiveAsync($segment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw 'Home Assistant fechou a conexão WebSocket' }
    $stream.Write($Buffer, 0, $result.Count)
  } until ($result.EndOfMessage)
  $text = [Text.Encoding]::UTF8.GetString($stream.ToArray())
  return $text | ConvertFrom-Json -Depth 100
}

function Send-HaMessage($Socket, $Message) {
  $json = $Message | ConvertTo-Json -Depth 100 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
}

function Invoke-HaCommand($Socket, [byte[]]$Buffer, [ref]$Sequence, [string]$Type, $Payload = @{}) {
  $Sequence.Value++
  $message = @{ id = $Sequence.Value; type = $Type }
  foreach ($key in $Payload.Keys) { $message[$key] = $Payload[$key] }
  Send-HaMessage $Socket $message
  do { $reply = Receive-HaMessage $Socket $Buffer } until ($reply.id -eq $Sequence.Value)
  if (-not $reply.success) { throw "$Type falhou: $($reply.error.message)" }
  return $reply.result
}

function Metric-Card([string]$Entity, [string]$Name, [string]$Icon) {
  return @{ type = 'tile'; entity = $Entity; name = $Name; icon = $Icon; vertical = $false; hide_state = $false }
}

function Sector-View([string]$Path, [string]$Title, [string]$Prefix, [string]$Color) {
  $phaseEntities = @()
  foreach ($phase in @('a', 'b', 'c')) {
    $upper = $phase.ToUpper()
    $phaseEntities += @{ entity = "$Prefix`_tensao_$phase"; name = "Tensão $upper" }
    $phaseEntities += @{ entity = "$Prefix`_corrente_$phase"; name = "Corrente $upper" }
    $phaseEntities += @{ entity = "$Prefix`_potencia_$phase"; name = "Potência $upper" }
  }
  return @{
    title = $Title; path = $Path; icon = 'mdi:flash'; type = 'sections'; max_columns = 4
    sections = @(
      @{ type = 'grid'; title = 'Resumo em tempo real'; cards = @(
        (Metric-Card "$Prefix`_energia_2" 'Potência atual' 'mdi:lightning-bolt'),
        (Metric-Card "$Prefix`_energia" 'Energia acumulada' 'mdi:counter'),
        (Metric-Card "$Prefix`_fator_de_potencia" 'Fator de potência' 'mdi:angle-acute'),
        (Metric-Card "$Prefix`_frequencia" 'Frequência' 'mdi:sine-wave')
      ) },
      @{ type = 'grid'; title = 'Potência — últimas 24 horas'; column_span = 2; cards = @(
        @{ type = 'history-graph'; hours_to_show = 24; entities = @(@{ entity = "$Prefix`_energia_2"; name = "Potência $Title" }) }
      ) },
      @{ type = 'grid'; title = 'Medições por fase'; column_span = 2; cards = @(
        @{ type = 'entities'; state_color = $true; entities = $phaseEntities }
      ) },
      @{ type = 'grid'; title = 'Estado do medidor'; cards = @(
        (Metric-Card "$Prefix`_status" 'Estado' 'mdi:check-network'),
        (Metric-Card "$Prefix`_temperatura" 'Temperatura' 'mdi:thermometer')
      ) }
    )
    badges = @()
  }
}

$haUrl = (Read-DotEnv 'HA_URL').TrimEnd('/')
$haToken = Read-DotEnv 'HA_TOKEN'
$wsUrl = $haUrl -replace '^http:', 'ws:' -replace '^https:', 'wss:'
$socket = [Net.WebSockets.ClientWebSocket]::new()
$buffer = New-Object byte[] 1048576
$socket.ConnectAsync([Uri]"$wsUrl/api/websocket", [Threading.CancellationToken]::None).GetAwaiter().GetResult()

$hello = Receive-HaMessage $socket $buffer
if ($hello.type -ne 'auth_required') { throw 'Resposta de autenticação inesperada' }
Send-HaMessage $socket @{ type = 'auth'; access_token = $haToken }
$auth = Receive-HaMessage $socket $buffer
if ($auth.type -ne 'auth_ok') { throw 'Token recusado pelo Home Assistant' }

$sequence = 0
$dashboards = Invoke-HaCommand $socket $buffer ([ref]$sequence) 'lovelace/dashboards/list'
$urlPath = 'energia-setores'
$existing = $dashboards | Where-Object { $_.url_path -eq $urlPath }
if (-not $existing) {
  Invoke-HaCommand $socket $buffer ([ref]$sequence) 'lovelace/dashboards/create' @{
    url_path = $urlPath; title = 'Energia — Setores'; icon = 'mdi:transmission-tower'; show_in_sidebar = $true; require_admin = $false
  } | Out-Null
}

$config = @{
  title = 'Energia — Setores'
  views = @(
    (Sector-View 'dti' 'DTI' 'sensor.geral_sala_tecnica_dti' '#42d3a3'),
    (Sector-View 'cope' 'COPE' 'sensor.cope_energy_meter' '#56a8ff'),
    (Sector-View 'emgetis' 'EMGETIS' 'sensor.geral_sala_tecnica_emgetis' '#a98bff')
  )
}
Invoke-HaCommand $socket $buffer ([ref]$sequence) 'lovelace/config/save' @{ url_path = $urlPath; config = $config } | Out-Null
$socket.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'Concluído', [Threading.CancellationToken]::None).GetAwaiter().GetResult()
Write-Output "INSTALLED_URL=$haUrl/$urlPath/dti"
Write-Output 'DASHBOARD=Energia — Setores'
Write-Output 'VIEWS=DTI,COPE,EMGETIS'
