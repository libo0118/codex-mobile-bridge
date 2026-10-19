#!/usr/bin/env python3
"""Prepare shared resources, assemble and verify an unsigned HarmonyOS HAP."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT = Path('mobile/harmony')
SHARED_SCRIPTS = ('mobile-ui.js', 'mobile-clipboard.js', 'mobile-system-bars.js')
BUNDLE_NAME = 'io.github.try2love.codexbridge.harmony'
ICON_SOURCE = PROJECT / 'branding/app-1024.png'
NAV_ICONS = tuple('nav_' + name + suffix + '.svg'
                  for name in ('codex', 'keeper', 'cpa', 'magpie') for suffix in ('', '_selected'))


def read_json(path):
    # Project JSON5 files deliberately use the JSON subset, so no parser is needed.
    return json.loads(path.read_text(encoding='utf-8'))


def prepare_resources(root):
    project = root / PROJECT
    version = read_json(root / 'package.json')['version']
    app = read_json(project / 'AppScope/app.json5')['app']
    if app['versionName'] != version or app['bundleName'] != BUNDLE_NAME:
        raise RuntimeError('HarmonyOS app identity/version must match package.json before building.')
    for package in (project / 'oh-package.json5', project / 'entry/oh-package.json5'):
        if read_json(package)['version'] != version:
            raise RuntimeError('HarmonyOS package version must match package.json: ' + str(package))
    resources = project / 'entry/src/main/resources'
    inputs = [(root / 'mobile/shared/web' / name, resources / 'rawfile' / name)
              for name in SHARED_SCRIPTS]
    inputs.extend((root / ICON_SOURCE, destination) for destination in (
        project / 'AppScope/resources/base/media/app_icon.png',
        resources / 'base/media/app_icon.png'))
    for source, destination in inputs:
        if source.is_symlink() or not source.is_file():
            raise RuntimeError('Missing regular shared resource: ' + str(source))
        if destination.is_symlink() or not destination.resolve().is_relative_to(project.resolve()):
            raise RuntimeError('Generated resource escapes the HarmonyOS project: ' + str(destination))
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    return app


def verify_hap(hap, root, app):
    with zipfile.ZipFile(hap) as archive:
        names = archive.namelist()
        if (len(names) != len(set(names)) or archive.testzip() is not None
                or any(PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts
                       or '\\' in name for name in names)):
            raise RuntimeError('Invalid HarmonyOS HAP archive.')
        for name in ('module.json', 'resources.index', 'ets/modules.abc'):
            if name not in names or archive.getinfo(name).file_size == 0:
                raise RuntimeError('Missing compiled HarmonyOS payload: ' + name)
        manifest = json.loads(archive.read('module.json'))
        packaged_app = manifest.get('app', {})
        module = manifest.get('module', {})
        if (any(packaged_app.get(key) != app[key] for key in ('bundleName', 'versionCode', 'versionName'))
                or module.get('name') != 'entry' or module.get('mainElement') != 'EntryAbility'):
            raise RuntimeError('Packaged HarmonyOS identity/version/entry does not match the source.')
        for name in SHARED_SCRIPTS:
            if archive.read('resources/rawfile/' + name) != (root / 'mobile/shared/web' / name).read_bytes():
                raise RuntimeError('Packaged HarmonyOS shared resource differs from its source: ' + name)
        media = 'resources/base/media/'
        for name in ('app_icon.png',) + NAV_ICONS:
            if media + name not in names or archive.getinfo(media + name).file_size == 0:
                raise RuntimeError('Missing packaged HarmonyOS icon: ' + name)
        # The resource compiler can optimize PNG bytes, but must retain the full-size launcher icon.
        icon = archive.read(media + 'app_icon.png')
        if len(icon) < 24 or icon[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', icon[16:24]) != (1024, 1024):
            raise RuntimeError('Packaged HarmonyOS launcher icon must be a 1024px PNG.')


def sdk_info():
    sdk_home = os.environ.get('HOS_SDK_HOME')
    if not sdk_home:
        raise RuntimeError('HOS_SDK_HOME must point to the installed HarmonyOS SDK.')
    data = read_json(Path(sdk_home) / 'default/sdk-pkg.json')['data']
    return {'version': data['version'], 'apiVersion': data['apiVersion'],
            'cliToolsVersion': os.environ.get('HARMONY_CLI_TOOLS_VERSION', 'local')}


def package_hap(hap, root, output, app, sdk):
    if not hap.name.endswith('-unsigned.hap'):
        raise RuntimeError('Only an explicitly unsigned HAP may be exported.')
    verify_hap(hap, root, app)
    output.mkdir(parents=True, exist_ok=True)
    destination = output / ('Codex-Mobile-Bridge-' + app['versionName'] + '-HarmonyOS-unsigned.hap')
    shutil.copyfile(hap, destination)
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=root, text=True).strip())
    info = output / 'build-info.json'
    info.write_text(json.dumps({
        'platform': 'HarmonyOS', 'bundleName': app['bundleName'],
        'version': app['versionName'], 'build': app['versionCode'],
        'gitSha': sha, 'gitDirty': dirty, 'sdk': sdk, 'signed': False,
        'builtAt': datetime.now(timezone.utc).isoformat(), 'artifact': destination.name
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    checksums = output / 'SHA256SUMS.txt'
    checksums.write_text(''.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
                                for path in (destination, info)), encoding='utf-8')
    return destination


def assemble(root, output):
    app = prepare_resources(root)
    sdk = sdk_info()
    project = root / PROJECT
    ohpm, hvigor = shutil.which('ohpm'), shutil.which('hvigorw')
    if not ohpm or not hvigor:
        raise RuntimeError('Add the HarmonyOS command-line-tools/bin directory to PATH (ohpm and hvigorw).')
    subprocess.run([ohpm, 'install', '--all'], cwd=project, check=True)
    # Remove the single expected previous output so a successful no-op cannot export stale bytes.
    hap = project / 'entry/build/default/outputs/default/entry-default-unsigned.hap'
    if hap.is_symlink() or not hap.resolve().is_relative_to(project.resolve()):
        raise RuntimeError('Unexpected HarmonyOS output path.')
    if hap.exists():
        hap.unlink()
    subprocess.run([hvigor, '--mode', 'module', '-p', 'product=default', '-p', 'module=entry@default',
                    '-p', 'buildMode=release', 'assembleHap', '--no-daemon', '--stacktrace'], cwd=project, check=True)
    if not hap.is_file():
        raise RuntimeError('Hvigor did not produce the expected unsigned entry HAP: ' + str(hap))
    return package_hap(hap, root, output, app, sdk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prepare-only', action='store_true', help='Copy shared resources without any SDK or build tools.')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist/mobile-harmony')
    args = parser.parse_args()
    if args.prepare_only:
        app = prepare_resources(ROOT)
        print('Prepared HarmonyOS resources for ' + app['versionName'] + ' (no native build).')
    else:
        print(assemble(ROOT, args.output_dir.resolve()))


if __name__ == '__main__':
    main()
