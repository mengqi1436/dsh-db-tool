<#
.SYNOPSIS
  诊断并修复「npm 上已发新版，但本机装不上 / 装到旧版 / 插件链接失效」。
.DESCRIPTION
  三类阻塞：① node_modules\dsh-db-tool 是 link 残留或死链；② minimumReleaseAge
  未豁免目标版本（pnpm 会静默保留旧版并 exit 0）；③ allowBuilds 缺 oracledb /
  better-sqlite3（安装报 ERR_PNPM_IGNORED_BUILDS）。默认只诊断，-Apply 才写入。
.PARAMETER Version
  目标版本；省略时读包内 package.json 的 version。
.PARAMETER ProfileDir
  profile 目录；默认 %USERPROFILE%\.dsh\profiles\desktop。
.PARAMETER Apply
  执行修复（默认仅诊断）。写入前自动备份。
.EXAMPLE
  pwsh -File scripts\fix-dsh-install.ps1
  pwsh -File scripts\fix-dsh-install.ps1 -Apply
#>
[CmdletBinding()]
param(
  [string]$Version,
  [string]$ProfileDir,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$prof = if ($ProfileDir) { $ProfileDir } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
if (-not (Test-Path -LiteralPath $prof)) { throw "找不到 DSH profile：$prof（DSH 桌面端是否装过并启动过？）" }
$ws = Join-Path $prof 'pnpm-workspace.yaml'
if (-not (Test-Path -LiteralPath $ws)) { throw "找不到 $ws（profile 尚未初始化）" }

if (-not $Version) {
  $pkg = Join-Path $PSScriptRoot '..\package.json'
  $Version = if (Test-Path -LiteralPath $pkg) { (Get-Content -LiteralPath $pkg -Raw | ConvertFrom-Json).version } else { '0.0.0' }
}

# 固定编码，不依赖各 PowerShell 版本的默认值：5.1 的 Get-Content/Set-Content 走 ANSI
# （会把非 ASCII 写坏），且两者默认都丢 BOM。这两个函数只在脚本自己的读写路径上使用。
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
function Read-Yaml([string]$p) { [System.IO.File]::ReadAllText($p, $utf8NoBom) }
function Write-Yaml([string]$p, [string]$t) { [System.IO.File]::WriteAllText($p, $t, $utf8NoBom) }

# 换行归一化为 LF：CRLF 文件会让 `(?m)$` 锚点全部失效——豁免静默丢失，并写出重复的
# YAML 段头（pnpm 报 duplicate mapping key，配置直接不可用）。插入统一用 `n。
$text = (Read-Yaml $ws) -replace "`r`n", "`n"

$link = Join-Path $prof 'node_modules\dsh-db-tool'
$pkgs = @('oracledb', 'better-sqlite3')  # 需要执行构建脚本的原生依赖
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fix = @()

Write-Host "`n[1/3] 插件链接形态" -ForegroundColor Cyan
if (Test-Path -LiteralPath $link) {
  $it = Get-Item -LiteralPath $link -Force
  $target = [string]$it.Target
  Write-Host ("      node_modules\dsh-db-tool -> {0} : {1}" -f $it.LinkType, $target)
  if ($it.LinkType -eq 'SymbolicLink' -or $it.LinkType -eq 'Junction') {
    # Target 是「as defined」的原样字符串，可能是相对路径；必须按链接所在目录解析，
    # 否则会按当前工作目录误判为死链并删掉一个完好的链接。
    $resolved = if ($target -and -not [System.IO.Path]::IsPathRooted($target)) {
      Join-Path (Split-Path -LiteralPath $link -Parent) $target
    } else { $target }
    if ($resolved -and (Test-Path -LiteralPath $resolved)) {
      Write-Host "      [!] 指向真实目录的 link：npm 更新不会生效（加载的是该目录）" -ForegroundColor Yellow
      Write-Host "          如该机不做本地开发，先 remove 再 add 改用 npm 包（见结尾）" -ForegroundColor Yellow
    } else {
      Write-Host "      [X] link 目标不存在 -> 安装/加载必定失败" -ForegroundColor Red
      $fix += 'del-dead-link'
    }
  } else {
    Write-Host "      OK：正常安装目录（非链接）" -ForegroundColor Green
  }
} else {
  Write-Host "      未安装（无 node_modules\dsh-db-tool）"
}

Write-Host "`n[2/3] minimumReleaseAge 豁免" -ForegroundColor Cyan
$m = [regex]::Match($text, '(?m)^[ \t]*-[ \t]*[''"]?dsh-db-tool@([^\r\n]*)')
if (-not $m.Success) {
  Write-Host "      [X] 没有 dsh-db-tool 豁免行 -> 新版本会被年龄窗口拦住" -ForegroundColor Red
  $fix += 'add-exclude'
} else {
  Write-Host ("      现有：dsh-db-tool@" + $m.Groups[1].Value.TrimEnd())
  # 版本边界：否则 1.7.1 会命中 1.7.10
  $bound = '(?<![\d.])' + [regex]::Escape($Version) + '(?![\d.])'
  if ($m.Groups[1].Value -match $bound) {
    Write-Host "      OK：已豁免 $Version" -ForegroundColor Green
  } else {
    Write-Host "      [X] 未豁免 $Version -> pnpm 会静默装旧版或报 MINIMUM_RELEASE_AGE_VIOLATION" -ForegroundColor Red
    $fix += 'extend-exclude'
  }
}

Write-Host "`n[3/3] allowBuilds 原生模块白名单" -ForegroundColor Cyan
$missingAllow = @($pkgs | Where-Object { $text -notmatch ('(?m)^[ \t]*' + [regex]::Escape($_) + ':[ \t]*true') })
foreach ($n in $pkgs) {
  if ($missingAllow -contains $n) {
    Write-Host "      [X] $n 未获允许 -> 安装会以 ERR_PNPM_IGNORED_BUILDS 失败" -ForegroundColor Red
    $fix += "allow-$n"
  } else {
    Write-Host "      OK：$n" -ForegroundColor Green
  }
}

Write-Host "`n===== 结论 =====" -ForegroundColor Cyan
if ($fix.Count -eq 0) {
  Write-Host "未发现阻塞项。" -ForegroundColor Green
} else {
  Write-Host ("待处理 $($fix.Count) 项（见上方 [X]）") -ForegroundColor Yellow
}

if (-not $Apply) {
  Write-Host "`n（诊断模式：未做任何修改。确认后加 -Apply 执行修复）"
  return
}

$new = $text
if ($fix -contains 'del-dead-link') { Remove-Item -LiteralPath $link -Force }

if ($fix -contains 'extend-exclude') {
  # 保留原行的引号与前缀，只追加版本（pnpm 对同名包只认第一条，故必须改原行）
  $new = $new -replace '(?m)^([ \t]*-[ \t]*[''"]?dsh-db-tool@[^\r\n]*?)[ \t]*$', ('$1 || ' + $Version)
}
if ($fix -contains 'add-exclude') {
  if ($new -match '(?m)^minimumReleaseAgeExclude:[ \t]*$') {
    $new = $new -replace '(?m)^(minimumReleaseAgeExclude:[ \t]*)$', ('$1' + "`n  - dsh-db-tool@$Version")
  } else {
    # 段头缺失：插入无处可落，必须整段追加，否则静默无变更却报告成功
    $new = $new.TrimEnd() + "`nminimumReleaseAgeExclude:`n  - dsh-db-tool@$Version`n"
  }
}
if ($missingAllow.Count -gt 0) {
  # 一次性补齐：逐项插入会各插一次段头，产出重复的 YAML 键
  $block = ($missingAllow | ForEach-Object { '  ' + $_ + ': true' }) -join "`n"
  if ($new -match '(?m)^allowBuilds:[ \t]*$') {
    $new = $new -replace '(?m)^(allowBuilds:[ \t]*)$', ('$1' + "`n" + $block)
  } else {
    $new = $new.TrimEnd() + "`nallowBuilds:`n" + $block + "`n"
  }
}

if ($new -eq $text) {
  Write-Host "`n无需写入（配置已是目标状态）。" -ForegroundColor Green
} else {
  Copy-Item -LiteralPath $ws -Destination "$ws.bak-$stamp" -Force
  Write-Yaml $ws $new
  Write-Host "`n已更新 pnpm-workspace.yaml（备份：pnpm-workspace.yaml.bak-$stamp）" -ForegroundColor Green
}

Write-Host "`n===== 下一步 =====" -ForegroundColor Cyan
Write-Host "  1) 完全退出并重启 DSH 桌面端"
Write-Host "  2) 若上面提示过 link，先移除再安装："
Write-Host '     & "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-db-tool'
Write-Host "  3) 安装目标版本："
Write-Host ('     & "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add dsh-db-tool@' + $Version + ' --registry=https://registry.npmjs.org/')
