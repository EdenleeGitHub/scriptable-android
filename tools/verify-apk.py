"""Verify the delivered APK contains the exact final bundled UI/runtime assets."""
import hashlib
import json
from pathlib import Path
import zipfile
import re

project = Path(__file__).resolve().parent.parent
version = re.search(r"versionName\s+'([^']+)'", (project/'app/build.gradle').read_text()).group(1)
apk = project / f'dist/Scriptable-Android-{version}-release.apk'
assets = project / 'app/src/main/assets'
with zipfile.ZipFile(apk) as archive:
    for asset in assets.rglob('*'):
        if asset.is_file():
            assert archive.read('assets/' + str(asset.relative_to(assets)).replace('\\','/')) == asset.read_bytes(), f'APK asset differs: {asset.name}'
    assert 'classes.dex' in archive.namelist()
    assert 'AndroidManifest.xml' in archive.namelist()
    assert not any(name.endswith(('.jks', '.keystore', 'signing.properties')) for name in archive.namelist())
files = sorted((project / 'app/src/main').rglob('*'))
manifest = {
    'version': version,
    'applicationId': 'dev.scriptable.android',
    'minimumAndroid': '8.0 (API 26)',
    'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
    'apkBytes': apk.stat().st_size,
    'assetsVerifiedAgainstSource': True,
    'sourceSha256': {str(file.relative_to(project)).replace('\\', '/'): hashlib.sha256(file.read_bytes()).hexdigest() for file in files if file.is_file()},
}
(project / 'dist/build-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print('Verified final APK assets, manifest, compiled code and absence of signing secrets.')
print('APK SHA256:', manifest['apkSha256'])
