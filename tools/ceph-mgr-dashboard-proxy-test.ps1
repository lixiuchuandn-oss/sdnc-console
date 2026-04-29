<#
.SYNOPSIS
  测试经 Rancher/Harvester K8s Service Proxy 访问 rook-ceph-mgr-dashboard 的 REST。

.DESCRIPTION
  使用 curl.exe：
  1) 仅用 Rancher Bearer 调 GET /api/summary
  2) 若填写 Dashboard 用户名密码：POST /api/auth（带 Rancher Bearer），再 GET /api/summary（仅 Dashboard token，再试 Rancher+Dashboard 双 Bearer）
  3) GET /api/orchestrator/inventory（404 常见）

  编辑「必填 / 选填」后执行:
    .\tools\ceph-mgr-dashboard-proxy-test.ps1

  勿将含真实 Token/密码的脚本提交到 Git。
#>

#region ============ 必填 ============
$RancherBaseUrl = "https://10.20.5.10"   # 不要尾斜杠
$ClusterId      = "local"
$BearerToken    = ""                      # Rancher API Token

$CephNamespace   = "rook-ceph"
$CephServiceName = "rook-ceph-mgr-dashboard"
$CephServicePort  = 7000
#endregion

#region ============ 选填（① 非 200 时再填）===========
$DashboardUsername = ""
$DashboardPassword = ""
#endregion

#region ============ 选填 ============
$SkipCertificateCheck = $true             # 等价 curl -k
#endregion

$SummaryPath   = "/api/summary"
$AuthPath      = "/api/auth"
$InventoryPath = "/api/orchestrator/inventory"

function Get-ProxyRoot {
    param([string]$Base, [string]$Cluster, [string]$Ns, [string]$Svc, [int]$Port)
    $b = $Base.TrimEnd('/')
    return "$b/k8s/clusters/$Cluster/api/v1/namespaces/$Ns/services/http:${Svc}:$Port/proxy"
}

function Invoke-CurlFile {
    param(
        [string]$Method,
        [string]$Url,
        [string[]]$ExtraHeaders,   # 例如 @('Authorization: Bearer xxx')
        [string]$BodyFile          # $null 表示无 body
    )
    if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
        throw "未找到 curl.exe。"
    }
    $args = @('-s', '-S')
    if ($SkipCertificateCheck) { $args += '-k' }
    $args += '-w', "`n__HTTP_CODE__:%{http_code}`n", '-X', $Method
    foreach ($h in $ExtraHeaders) {
        if (-not [string]::IsNullOrWhiteSpace($h)) {
            $args += '-H', $h
        }
    }
    if ($Method -eq 'POST' -and -not [string]::IsNullOrWhiteSpace($BodyFile)) {
        $args += '-H', 'Content-Type: application/json; charset=utf-8'
        $args += '--data-binary', "@$BodyFile"
    }
    $args += '--url', $Url
    $out = & curl.exe @args 2>&1
    $txt = ($out | Out-String).TrimEnd()
    return $txt
}

Write-Host "=== Ceph mgr-dashboard（K8s Service Proxy）连通性测试 ===" -ForegroundColor Cyan
Write-Host ""

if ([string]::IsNullOrWhiteSpace($RancherBaseUrl) -or [string]::IsNullOrWhiteSpace($BearerToken)) {
    Write-Host "[失败] 请编辑脚本：填写 RancherBaseUrl 与 BearerToken。" -ForegroundColor Red
    exit 1
}

$proxyRoot = Get-ProxyRoot -Base $RancherBaseUrl -Cluster $ClusterId -Ns $CephNamespace -Svc $CephServiceName -Port $CephServicePort
Write-Host "Proxy 根: $proxyRoot" -ForegroundColor Gray
Write-Host ""

# 用拼接避免 Token 中含 $ 时被 PowerShell 误展开
$hdrRancher = 'Authorization: Bearer ' + $BearerToken
$hdrAccept  = 'Accept: application/json'

# ----- ① -----
$urlSummary = "$proxyRoot$SummaryPath"
Write-Host "① GET $SummaryPath（仅 Rancher Bearer）" -ForegroundColor Yellow
$o1 = Invoke-CurlFile -Method GET -Url $urlSummary -ExtraHeaders @($hdrRancher, $hdrAccept) -BodyFile $null
Write-Host $o1
Write-Host ""

# ----- ②③④ -----
if (-not [string]::IsNullOrWhiteSpace($DashboardUsername) -and -not [string]::IsNullOrWhiteSpace($DashboardPassword)) {
    $urlAuth = "$proxyRoot$AuthPath"
    $authJson = (@{ username = $DashboardUsername; password = $DashboardPassword } | ConvertTo-Json -Compress)
    $tmpAuth = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmpAuth, $authJson, (New-Object System.Text.UTF8Encoding $false))

        Write-Host "② POST $AuthPath（Rancher Bearer + body 用户名密码）" -ForegroundColor Yellow
        $o2 = Invoke-CurlFile -Method POST -Url $urlAuth -ExtraHeaders @($hdrRancher, $hdrAccept) -BodyFile $tmpAuth
        Write-Host $o2
        Write-Host ""

        $body2 = ($o2 -replace '(?s)\n__HTTP_CODE__:\d+\s*$', '').Trim()
        $dashToken = $null
        try {
            $jo = $body2 | ConvertFrom-Json -ErrorAction Stop
            if ($null -ne $jo.token) { $dashToken = [string]$jo.token }
            elseif ($null -ne $jo.Token) { $dashToken = [string]$jo.Token }
        } catch { }

        if (-not [string]::IsNullOrWhiteSpace($dashToken)) {
            Write-Host "已从 JSON 解析到 dashboard token（长度 $($dashToken.Length)）。" -ForegroundColor Green
            $hdrDash = 'Authorization: Bearer ' + $dashToken

            Write-Host "③ GET $SummaryPath（仅 Dashboard Bearer）" -ForegroundColor Yellow
            $o3 = Invoke-CurlFile -Method GET -Url $urlSummary -ExtraHeaders @($hdrDash, $hdrAccept) -BodyFile $null
            Write-Host $o3
            Write-Host ""

            Write-Host "④ GET $SummaryPath（连续两个 Authorization 头：先 Rancher 后 Dashboard；看是否与 ③ 不同）" -ForegroundColor Yellow
            $o4 = Invoke-CurlFile -Method GET -Url $urlSummary -ExtraHeaders @($hdrRancher, $hdrDash, $hdrAccept) -BodyFile $null
            Write-Host $o4
            Write-Host ""
        } else {
            Write-Host "未能从 ② 的 JSON 解析 token；请把 ② 响应（打码）发给人看字段名。" -ForegroundColor DarkYellow
            Write-Host ""
        }
    } finally {
        Remove-Item -LiteralPath $tmpAuth -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "②③④ 跳过（未填 Dashboard 账号）。若 ① 非 200，请填写 DashboardUsername / DashboardPassword 后再跑。" -ForegroundColor DarkGray
    Write-Host ""
}

# ----- ⑤ -----
$urlInv = "$proxyRoot$InventoryPath"
Write-Host "⑤ GET $InventoryPath（仅 Rancher Bearer）" -ForegroundColor Yellow
$o5 = Invoke-CurlFile -Method GET -Url $urlInv -ExtraHeaders @($hdrRancher, $hdrAccept) -BodyFile $null
Write-Host $o5
if ($o5 -match '__HTTP_CODE__:404') {
    Write-Host "（404 常见于未启用 orchestrator，可忽略。）" -ForegroundColor DarkYellow
}
Write-Host ""

Write-Host "=== 请把以下数字发回（不要带 Token/密码）===" -ForegroundColor Cyan
Write-Host "  ① 末尾 __HTTP_CODE__:" -ForegroundColor White
Write-Host "  若跑了 ②：②、③、④ 各自末尾 __HTTP_CODE__" -ForegroundColor White
Write-Host "  ⑤ 末尾 __HTTP_CODE__" -ForegroundColor White
