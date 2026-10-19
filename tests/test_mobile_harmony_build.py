"""SDK-free checks for the HarmonyOS preparation and compiled-artifact boundary."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('harmony_builder', ROOT / 'scripts/build-mobile-harmony.py')
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class HarmonyBuildTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        project = self.root / BUILDER.PROJECT
        for relative in ('AppScope/app.json5', 'oh-package.json5', 'entry/oh-package.json5'):
            destination = project / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / BUILDER.PROJECT / relative, destination)
        for relative in [Path('package.json'), BUILDER.ICON_SOURCE] + [Path('mobile/shared/web') / name for name in BUILDER.SHARED_SCRIPTS]:
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / relative, destination)
        self.app = BUILDER.read_json(project / 'AppScope/app.json5')['app']

    def hap(self, missing=None, altered=None):
        path = self.root / 'entry-default-unsigned.hap'
        entries = {
            'module.json': json.dumps({'app': self.app, 'module': {'name': 'entry', 'mainElement': 'EntryAbility'}}).encode(),
            'resources.index': b'resource table', 'ets/modules.abc': b'compiled ArkTS fixture'
        }
        entries.update(('resources/rawfile/' + name, (self.root / 'mobile/shared/web' / name).read_bytes())
                       for name in BUILDER.SHARED_SCRIPTS)
        if missing:
            entries.pop(missing)
        if altered:
            entries.update(altered)
        with zipfile.ZipFile(path, 'w') as archive:
            for name, value in entries.items():
                archive.writestr(name, value)
        return path

    def test_prepare_copies_exact_shared_bytes_and_existing_icon_without_sdk(self):
        self.assertEqual(BUILDER.prepare_resources(self.root), self.app)
        self.assertEqual(BUILDER.prepare_resources(self.root), self.app)
        resources = self.root / BUILDER.PROJECT / 'entry/src/main/resources'
        for name in BUILDER.SHARED_SCRIPTS:
            self.assertEqual((resources / 'rawfile' / name).read_bytes(), (self.root / 'mobile/shared/web' / name).read_bytes())
        self.assertEqual((resources / 'base/media/app_icon.png').read_bytes(), (ROOT / BUILDER.ICON_SOURCE).read_bytes())

    def test_version_mismatch_and_missing_source_fail_before_build(self):
        package = self.root / 'package.json'
        package.write_text('{"version":"999.0.0"}', encoding='utf-8')
        with self.assertRaisesRegex(RuntimeError, 'identity/version'):
            BUILDER.prepare_resources(self.root)
        shutil.copyfile(ROOT / 'package.json', package)
        (self.root / 'mobile/shared/web/mobile-ui.js').unlink()
        with self.assertRaisesRegex(RuntimeError, 'shared resource'):
            BUILDER.prepare_resources(self.root)

    def test_empty_shell_missing_code_and_changed_resources_are_rejected(self):
        for missing in ('module.json', 'resources.index', 'ets/modules.abc'):
            with self.subTest(missing=missing), self.assertRaisesRegex(RuntimeError, 'compiled HarmonyOS payload'):
                BUILDER.verify_hap(self.hap(missing=missing), self.root, self.app)
        with self.assertRaisesRegex(RuntimeError, 'differs'):
            BUILDER.verify_hap(self.hap(altered={'resources/rawfile/mobile-ui.js': b'wrong'}), self.root, self.app)
        with self.assertRaisesRegex(RuntimeError, 'Invalid HarmonyOS'):
            BUILDER.verify_hap(self.hap(altered={'../outside': b'no'}), self.root, self.app)
        with self.assertRaisesRegex(RuntimeError, 'identity/version/entry'):
            BUILDER.verify_hap(self.hap(altered={'module.json': b'{"app":{},"module":{}}'}), self.root, self.app)

    def test_export_has_unsigned_name_exact_commit_sdk_and_valid_checksums(self):
        output = self.root / 'dist/mobile-harmony'
        sdk = {'version': '6.0.0.1', 'apiVersion': 20, 'cliToolsVersion': '26.0.0.821'}
        with patch.object(BUILDER.subprocess, 'check_output', side_effect=['a' * 40 + '\n', '']):
            result = BUILDER.package_hap(self.hap(), self.root, output, self.app, sdk)
        self.assertEqual(result.name, 'Codex-Mobile-Bridge-' + self.app['versionName'] + '-HarmonyOS-unsigned.hap')
        metadata = BUILDER.read_json(output / 'build-info.json')
        self.assertEqual(metadata['gitSha'], 'a' * 40)
        self.assertFalse(metadata['gitDirty'])
        self.assertFalse(metadata['signed'])
        self.assertEqual(metadata['sdk'], sdk)
        for line in (output / 'SHA256SUMS.txt').read_text().splitlines():
            digest, name = line.split('  ')
            self.assertEqual(digest, BUILDER.hashlib.sha256((output / name).read_bytes()).hexdigest())
        with self.assertRaisesRegex(RuntimeError, 'explicitly unsigned'):
            BUILDER.package_hap(self.root / 'entry-default-signed.hap', self.root, output, self.app, sdk)

    def test_assemble_uses_argument_lists_and_never_packages_a_stale_hap(self):
        stale = self.root / BUILDER.PROJECT / 'entry/build/default/outputs/default/entry-default-unsigned.hap'
        stale.parent.mkdir(parents=True)
        stale.write_bytes(b'previous output')
        with patch.object(BUILDER, 'sdk_info', return_value={}), \
                patch.object(BUILDER.shutil, 'which', side_effect=lambda name: '/tools/' + name), \
                patch.object(BUILDER.subprocess, 'run') as run:
            with self.assertRaisesRegex(RuntimeError, 'did not produce'):
                BUILDER.assemble(self.root, self.root / 'output')
        self.assertFalse(stale.exists())
        self.assertEqual(run.call_count, 2)
        self.assertEqual(run.call_args_list[0].args[0], ['/tools/ohpm', 'install', '--all'])
        self.assertIn('assembleHap', run.call_args_list[1].args[0])
        self.assertNotIn('shell', run.call_args_list[1].kwargs)

    def test_project_entry_resources_versions_and_sdk_contract(self):
        project = ROOT / BUILDER.PROJECT
        profile = BUILDER.read_json(project / 'build-profile.json5')
        product = profile['app']['products'][0]
        self.assertEqual(profile['app']['signingConfigs'], [])
        self.assertNotIn('signingConfig', product)
        self.assertEqual(product['compatibleSdkVersion'], '5.0.2(14)')
        self.assertNotIn('compileSdkVersion', product)
        self.assertEqual(product['targetSdkVersion'], '26.0.0(26)')
        for config in ('oh-package.json5', 'hvigor/hvigor-config.json5'):
            self.assertEqual(BUILDER.read_json(project / config)['modelVersion'], '6.0.0')
        module = BUILDER.read_json(project / 'entry/src/main/module.json5')['module']
        ability = module['abilities'][0]
        self.assertEqual(module['mainElement'], ability['name'])
        self.assertTrue((project / 'entry/src/main' / ability['srcEntry']).is_file())
        pages = BUILDER.read_json(project / 'entry/src/main/resources/base/profile/main_pages.json')['src']
        self.assertEqual(pages, ['pages/Index'])
        for page in pages:
            self.assertTrue((project / 'entry/src/main/ets' / (page + '.ets')).is_file())
        permissions = {item['name'] for item in module['requestPermissions']}
        self.assertIn('ohos.permission.INTERNET', permissions)
        self.assertFalse(any('STORAGE' in name or 'READ_MEDIA' in name for name in permissions))


if __name__ == '__main__':
    unittest.main()
