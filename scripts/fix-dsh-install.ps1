<#
.SYNOPSIS
  诊断并修复「npm 上已发新版，但本机装不上 / 装到旧版 / 插件链接失效」。

.DESCRIPTION
  覆盖三类已知阻塞（任一条都会让 dsh-db-tool 装不上或停在旧版）：

   1) 本地 link 残留：node_modules\dsh-db-tool 是指向开发目录的符号链接。
      - 链接目标存在  → 插件加载的是那个目录，npm 更新永远不生效；
      - 链接目标不存在 → 安装/加载直接失败（"无法正确链接"最常见的原因）。
   2) minimumReleaseAge：profile 启用了「最小发布年龄」（本机实测为 24 小时）。
      版本发布未满窗口时，pnpm 会静默保留旧版并以 exit 0 结束，dshmarket 提示
      「已安装，但不是最新版」。修法是把目标版本加进 minimumReleaseAgeExclude——
      注意 pnpm 对同名包只认第一条规则，必须改原有那一行，不要新增行。
   3) allowBuilds：oracledb / better-sqlite3 的构建脚本未获允许时，
      安装会以 ERR_PNPM_IGNORED_BUILDS 失败。

.PARAMETER Apply
  实际写入修改。默认只诊断，不碰任何文件。写入前自动备份。

.PARAMETER Version
  期望安装的版本，默认 1.7.1。

.EXAMPLE
  pwsh -File scripts\fix-dsh-install.ps1            # 只诊断
  pwsh -File scripts\fix-dsh-install.ps1 -Apply     # 修复
#>
[CmdletBinding()]
param(
  [string]$Version = '1.7.1',
  [string]$ProfileDir,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'

$prof = if ($ProfileDir) { $ProfileDir } else { Join-Path $env:USERPROFILE '.dsh\profiles\desktop' }
if (-not (Test-Path -LiteralPath $prof)) {
  throw "找不到 DSH profile：$prof（请确认 DSH 桌面端已安装并至少启动过一次）"
}
$ws   = Join-Path $prof 'pnpm-workspace.yaml'
$link = Join-Path $prof 'node_modules\dsh-db-tool'
if (-not (Test-Path -LiteralPath $ws)) {
  throw "找不到 $ws（profile 尚未初始化）"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$fix = @()

Write-Host "`n[1/3] 插件链接形态" -ForegroundColor Cyan
if (Test-Path -LiteralPath $link) {
  $it = Get-Item -LiteralPath $link -Force
  Write-Host ("      node_modules\dsh-db-tool -> {0} : {1}" -f $it.LinkType, $it.Target)
  if ($it.LinkType -eq 'SymbolicLink' -or $it.LinkType -eq 'Junction') {
    if (Test-Path -LiteralPath $it.Target) {
      Write-Host "      [!] 这是指向真实目录的 link：npm 更新不会生效" -ForegroundColor Yellow
      Write-Host "          如该机不做本地开发，应先 remove 再 add 改用 npm 包（见结尾）" -ForegroundColor Yellow
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
$text = Get-Content -LiteralPath $ws -Raw
$m = [regex]::Match($text, '(?m)^([ \t]*-[ \t]*dsh-db-tool@)([^\r\n]*)')
if (-not $m.Success) {
  Write-Host "      [X] 没有 dsh-db-tool 豁免行 -> 新版本会被年龄窗口拦住" -ForegroundColor Red
  $fix += 'add-exclude'
} else {
  Write-Host ("      现有：dsh-db-tool@" + $m.Groups[2].Value.TrimEnd())
  if ($m.Groups[2].Value -match [regex]::Escape($Version)) {
    Write-Host "      OK：已豁免 $Version" -ForegroundColor Green
  } else {
    Write-Host "      [X] 未豁免 $Version -> pnpm 会静默装旧版或报 MINIMUM_RELEASE_AGE_VIOLATION" -ForegroundColor Red
    $fix += 'extend-exclude'
  }
}

Write-Host "`n[3/3] allowBuilds 原生模块白名单" -ForegroundColor Cyan
foreach ($n in 'oracledb', 'better-sqlite3') {
  if ($text -match ('(?m)^[ \t]*' + [regex]::Escape($n) + ':[ \t]*true')) {
    Write-Host "      OK：$n" -ForegroundColor Green
  } else {
    Write-Host "      [X] $n 未获允许 -> 安装会以 ERR_PNPM_IGNORED_BUILDS 失败" -ForegroundColor Red
    $fix += "allow-$n"
  }
}

Write-Host "`n===== 结论 =====" -ForegroundColor Cyan
if ($fix.Count -eq 0) {
  Write-Host "未发现阻塞项。" -ForegroundColor Green
} else {
  Write-Host ("待处理：" + ($fix -join ', ')) -ForegroundColor Yellow
}

if (-not $Apply) {
  Write-Host "`n（诊断模式：未做任何修改。确认后加 -Apply 执行修复）"
  return
}

Write-Host "`n===== 执行修复 =====" -ForegroundColor Cyan
Copy-Item -LiteralPath $ws -Destination "$ws.bak-$stamp" -Force
Write-Host "  已备份 -> pnpm-workspace.yaml.bak-$stamp"

if ($fix -contains 'del-dead-link') {
  Remove-Item -LiteralPath $link -Force
  Write-Host "  已删除失效链接"
}

$new = $text
if ($fix -contains 'extend-exclude') {
  $new = [regex]::Replace($new, '(?m)^([ \t]*-[ \t]*dsh-db-tool@[^\r\n]*?)[ \t]*$', ('$1 || ' + $Version))
}
if ($fix -contains 'add-exclude') {
  $new = [regex]::Replace($new, '(?m)^(minimumReleaseAgeExclude:[ \t]*)$', ('$1' + "`r`n  - dsh-db-tool@$Version"))
}
$missingAllow = @('oracledb', 'better-sqlite3') | Where-Object { $fix -contains "allow-$_" }
if ($missingAllow.Count -gt 0) {
  # 一次性补齐：逐项插入会在每个包后面各插一次 allowBuilds 段头，产出重复 YAML 键
  $block = ($missingAllow | ForEach-Object { '  ' + $_ + ': true' }) -join "`r`n"
  if ($new -match '(?m)^allowBuilds:[ \t]*$') {
    # allowBuilds 段头在文件里唯一，-replace 只会命中一处
    $new = $new -replace '(?m)^(allowBuilds:[ \t]*)$', ('$1' + "`r`n" + $block)
  } else {
    $new = $new.TrimEnd() + "`r`nallowBuilds:`r`n" + $block + "`r`n"
  }
}
if ($new -ne $text) {
  Set-Content -LiteralPath $ws -Value $new -NoNewline
  Write-Host "  已更新 pnpm-workspace.yaml"
} else {
  Write-Host "  无需写入"
}

Write-Host "`n===== 下一步 =====" -ForegroundColor Cyan
Write-Host "  1) 完全退出并重启 DSH 桌面端"
Write-Host "  2) 若上面提示过 link，先移除再安装："
Write-Host '     & "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-db-tool'
Write-Host "  3) 安装目标版本："
Write-Host ('     & "<DSH安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add dsh-db-tool@' + $Version + ' --registry=https://registry.npmjs.org/')
