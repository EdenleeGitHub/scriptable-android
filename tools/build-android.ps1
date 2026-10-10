param([switch]$Debug, [switch]$InitializeSigning)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:JAVA_HOME) {
    throw '请设置 JAVA_HOME 为 JDK 17 路径。'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'local.properties'))) {
    $sdkLocation = $env:ANDROID_HOME
    if (-not $sdkLocation) { $sdkLocation = $env:ANDROID_SDK_ROOT }
    if (-not $sdkLocation) { throw '请设置 ANDROID_HOME 或创建 local.properties。' }
    Set-Content -LiteralPath (Join-Path $projectRoot 'local.properties') -Value ('sdk.dir=' + $sdkLocation.Replace('\','/')) -Encoding ascii
}
$signingFolder = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.android\scriptable-android'
$signingConfig = Join-Path $signingFolder 'signing.properties'
if ($env:SCRIPTABLE_SIGNING_PROPERTIES) { $signingConfig = $env:SCRIPTABLE_SIGNING_PROPERTIES }
if ($InitializeSigning -and -not (Test-Path -LiteralPath $signingConfig)) {
    New-Item -ItemType Directory -Force -Path $signingFolder | Out-Null
    $keyFile = Join-Path $signingFolder 'release.jks'
    if (Test-Path -LiteralPath $keyFile) { throw '已有签名文件但没有签名配置；请恢复配置，不能覆盖签名身份。' }
    $secretBytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
    $signingPassword = [Convert]::ToHexString($secretBytes)
    & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $keyFile -storetype JKS -alias scriptable-android -storepass $signingPassword -keypass $signingPassword -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Scriptable Android, O=Independent Development, C=CN' 2>$null
    if ($LASTEXITCODE -ne 0) { throw '签名生成失败。' }
    $configLines = @("storeFile=$($keyFile.Replace('\','/'))", "storePassword=$signingPassword", 'keyAlias=scriptable-android', "keyPassword=$signingPassword")
    Set-Content -LiteralPath $signingConfig -Value $configLines -Encoding ascii
    $signingPassword = $null
}
if (-not $Debug -and -not (Test-Path -LiteralPath $signingConfig)) { throw 'Release 需要持久签名。首次运行加 -InitializeSigning；请备份用户目录下的签名文件。' }
Push-Location $projectRoot
try {
    $buildTask = if ($Debug) { 'assembleDebug' } else { 'assembleRelease' }
    & .\gradlew.bat testDebugUnitTest $buildTask lint --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Android 原生回归测试、构建或 lint 未通过。' }
    $variant = if ($Debug) { 'debug' } else { 'release' }
    $outputDir = Join-Path $projectRoot 'dist'
    New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
    $versionMatch = [regex]::Match((Get-Content -LiteralPath (Join-Path $projectRoot 'app\build.gradle') -Raw), "versionName\s+'([^']+)'")
    $appVersion = $versionMatch.Groups[1].Value
    if (-not $appVersion) { throw '无法读取应用版本。' }
    $apkPath = Join-Path $outputDir "Scriptable-Android-$appVersion-$variant.apk"
    Copy-Item -LiteralPath (Join-Path $projectRoot "app\build\outputs\apk\$variant\app-$variant.apk") -Destination $apkPath
    $hash = (Get-FileHash -LiteralPath $apkPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath (Join-Path $outputDir 'SHA256.txt') -Value "$hash  $([IO.Path]::GetFileName($apkPath))" -Encoding ascii
    Write-Output "APK: $apkPath"
    Write-Output "SHA256: $hash"
} finally { Pop-Location }
