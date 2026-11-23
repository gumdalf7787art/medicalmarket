[CmdletBinding()]
param(
    [ValidateSet('pair', 'connection-status', 'status', 'draft', 'publish')]
    [string]$Action = 'status',

    [ValidatePattern('^[a-z0-9][a-z0-9-]{0,119}$')]
    [string]$Slug,

    [string]$InputPath,

    [switch]$UsePairedConnection
)

$ErrorActionPreference = 'Stop'
$origin = 'https://medicalmarket.co.kr'
$api = "$origin/api/guides"
$connect = "$origin/api/guide-connections"
$pairedPath = Join-Path $env:LOCALAPPDATA 'MedicalMarket\guide-connection-token.dpapi'
function Read-LocalToken($path) {
    try {
        $secure = (Get-Content -LiteralPath $path -Raw).Trim() | ConvertTo-SecureString
        return [System.Net.NetworkCredential]::new('', $secure).Password
    } catch {
        throw 'The publishing token could not be read by this Windows account. Use the account that enrolled it.'
    }
}

if ($Action -in 'pair','connection-status' -or $UsePairedConnection) {
    if ($Action -eq 'pair' -and !(Test-Path -LiteralPath $pairedPath -PathType Leaf)) {
        $bytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $token = 'mm_guide_' + ([BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant())
        [IO.Directory]::CreateDirectory((Split-Path -Parent $pairedPath)) | Out-Null
        $encrypted = ConvertTo-SecureString -AsPlainText -Force -String $token | ConvertFrom-SecureString
        New-Item -Path $pairedPath -ItemType File -Value $encrypted | Out-Null
    }
    $token = Read-LocalToken $pairedPath
    if ($token -cnotmatch '^mm_guide_[0-9a-f]{64}$') { throw 'The paired publishing token is invalid.' }
    if ($Action -eq 'pair') {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try { $hash = [BitConverter]::ToString($sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($token))).Replace('-', '').ToLowerInvariant() } finally { $sha256.Dispose() }
        $payload = @{token_hash=$hash; client='메디컬마켓 Windows 발행 도구'} | ConvertTo-Json -Compress
        Invoke-RestMethod -Uri "$connect/pair" -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -ContentType 'application/json; charset=utf-8' -MaximumRedirection 0 -TimeoutSec 25
        return
    }
    if ($Action -eq 'connection-status') {
        Invoke-RestMethod -Uri "$connect/status" -Headers @{Authorization="Bearer $token"} -MaximumRedirection 0 -TimeoutSec 25
        return
    }
} else {
    $token = $env:GUIDE_PUBLISH_TOKEN
    if (!$token) {
        $secretPath = Join-Path $env:LOCALAPPDATA 'MedicalMarket\guide-publish-token.dpapi'
        if (!(Test-Path -LiteralPath $secretPath -PathType Leaf)) {
            throw 'The Medical Market encrypted publishing token was not found for this Windows user.'
        }
        $token = Read-LocalToken $secretPath
    }
    if ($token -cnotmatch '^[0-9a-f]{64}$') {
        throw 'The local publishing token is invalid.'
    }
}

$request = @{
    Headers = @{ Authorization = "Bearer $token" }
    MaximumRedirection = 0
    TimeoutSec = 25
}

if ($Action -eq 'status') {
    $uri = if ($Slug) { "$api/${Slug}?admin=1" } else { "${api}?admin=1" }
    $result = Invoke-RestMethod @request -Uri $uri
    if ($Slug) {
        $result | Select-Object slug, title, revision, published
    } else {
        [PSCustomObject]@{ authenticated = $true }
    }
    return
}

if (!$Slug -or !$InputPath) {
    throw 'Provide -Slug and -InputPath for draft or publish.'
}

$uri = "$api/$Slug"
$adminUri = "${uri}?admin=1"
$guide = Get-Content -LiteralPath $InputPath -Encoding UTF8 -Raw | ConvertFrom-Json
if ($null -eq $guide.revision -or $guide.revision -isnot [ValueType] -or
    $guide.revision -is [bool] -or $guide.revision -lt 0 -or
    $guide.revision -ne [Math]::Floor($guide.revision)) {
    throw 'Specify revision 0 for a new guide or the current revision when editing.'
}

$current = $null
try {
    $current = Invoke-RestMethod @request -Uri $adminUri
} catch {
    if ($null -eq $_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 404) {
        throw
    }
}

if ($current -and $current.published -eq 1 -and $Action -eq 'draft') {
    throw 'This guide is already public. Use a new slug for a private draft.'
}
$currentRevision = if ($current) { $current.revision } else { 0 }
if ($guide.revision -ne $currentRevision) {
    throw 'The supplied revision does not match the current guide. Review the latest version first.'
}

$payload = @{
    productId = $guide.productId
    title = $guide.title
    summary = $guide.summary
    body = $guide.body
    images = @($guide.images | Where-Object { $null -ne $_ })
    revision = $guide.revision
    published = $Action -eq 'publish'
}
$json = $payload | ConvertTo-Json -Depth 5 -Compress
try {
    $written = Invoke-RestMethod @request -Method Put -Uri $uri -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
} catch {
    Write-Warning "Check the saved state with -Action status -Slug $Slug before retrying."
    throw
}

$saved = Invoke-RestMethod @request -Uri $adminUri
if ($saved.slug -cne $Slug -or $saved.revision -ne $written.revision -or
    $saved.product_id -cne $payload.productId -or $null -eq $saved.published -or
    [int]$saved.published -ne [int]$payload.published) {
    throw 'The saved guide did not match the API response. Review it before retrying.'
}
if ($Action -eq 'publish') {
    try {
        $public = Invoke-RestMethod -Uri $uri -MaximumRedirection 0 -TimeoutSec 25
        if ($public.slug -cne $Slug -or $public.product_id -cne $payload.productId -or
            $public.revision -ne $saved.revision -or $public.title -cne $saved.title -or
            $public.published -ne 1) {
            throw 'The unauthenticated API does not show the saved revision.'
        }
        $searchText = if ($public.model) { $public.model } else { $saved.title }
        $term = [Uri]::EscapeDataString($searchText.Substring(0, [Math]::Min(100, $searchText.Length)))
        $matches = Invoke-RestMethod -Uri "${api}?q=$term&page=1" -MaximumRedirection 0 -TimeoutSec 25
        if ($Slug -cnotin $matches.guides.slug) {
            throw 'The public search did not return the guide.'
        }
        $pageUrl = "$origin/guide/$Slug"
        $page = Invoke-WebRequest -Uri $pageUrl -MaximumRedirection 0 -TimeoutSec 25 -UseBasicParsing
        $productLink = '/product.html?id=' + [Uri]::EscapeDataString('managed-' + $payload.productId)
        if (!$page.Content.Contains($productLink)) {
            throw 'The public page does not link to the selected product.'
        }
        foreach ($image in $payload.images) {
            $imageUrl = [Uri]::new([Uri]$origin, $image).AbsoluteUri
            if (!$page.Content.Contains([Net.WebUtility]::HtmlEncode($imageUrl))) {
                throw 'A selected photo was missing from the public page.'
            }
        }
    } catch {
        throw "The save succeeded at revision $($saved.revision), but public verification failed. Check the public URL before retrying the write. $($_.Exception.Message)"
    }
    $saved | Select-Object slug, title, revision, published, @{Name='url'; Expression={$pageUrl}}
} else {
    $saved | Select-Object slug, title, revision, published
}

