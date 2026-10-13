"""Offline public-build boundary checks; no server or runtime configuration IO."""
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from .application import Application
from .static_assets import StaticAssets


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve()
        self.files=['index.html','app.js','live-api.mjs','styles.css','photo.jpg','photo.png']
        for name in self.files:(self.root/name).write_bytes(('inert-'+name).encode())

    def assets(self):return StaticAssets(str(self.root),self.files)

    def test_manifest_mime_and_startup_snapshot(self):
        assets=self.assets()
        self.assertEqual(assets.get('/')[0],'text/html; charset=utf-8')
        for name,mime in [('app.js','text/javascript; charset=utf-8'),
            ('live-api.mjs','text/javascript; charset=utf-8'),('styles.css','text/css; charset=utf-8'),
            ('photo.jpg','image/jpeg'),('photo.png','image/png')]:
            self.assertEqual(assets.get('/'+name)[0],mime)
        (self.root/'app.js').write_bytes(b'changed-after-start')
        self.assertEqual(assets.get('/app.js')[1],b'inert-app.js')

    def test_unknown_and_traversal_paths_are_not_served(self):
        assets=self.assets()
        for path in ('/../index.html','/%2e%2e/index.html','/sub/../app.js','/private.js','/v1/me','/'):
            if path!='/':self.assertIsNone(assets.get(path))
        for name in ('../escape.js','/app.js','sub//app.js','sub/./app.js','%2e%2e/app.js',
            'sub\\app.js','v1/me.js','secret.json'):
            with self.subTest(name=name),self.assertRaises(ValueError):
                StaticAssets(str(self.root),['index.html',name])

    def test_symlink_files_directories_and_roots_rejected(self):
        (self.root/'link.js').symlink_to(self.root/'app.js')
        (self.root/'linked').symlink_to(self.root,target_is_directory=True)
        for name in ('link.js','linked/app.js'):
            with self.assertRaises(OSError):StaticAssets(str(self.root),['index.html',name])
        with self.assertRaises(OSError):StaticAssets(str(self.root/'linked'),self.files)

    def test_explicit_configuration_and_size_bounds(self):
        self.assertIsNone(StaticAssets.from_config({}))
        for config in ({'staticRoot':str(self.root)},{'staticFiles':self.files},
            {'staticRoot':'relative','staticFiles':self.files}):
            with self.assertRaises(ValueError):StaticAssets.from_config(config)
        with (self.root/'large.png').open('wb') as stream:stream.truncate(8*1024*1024+1)
        with self.assertRaises(ValueError):StaticAssets(str(self.root),['index.html','large.png'])

    def test_application_static_switch_does_not_mask_api_or_fallback(self):
        app=Application.__new__(Application);app.static_assets=self.assets()
        app.onboarding=SimpleNamespace(setup=lambda:{'inert':'api'})
        def get(path):return app.handle('GET',path,{}, {},b'',None)
        self.assertEqual(get('/live-api.mjs')[0],200)
        self.assertEqual(get('/missing')[0],404)
        self.assertEqual(get('/consumer.js')[0],404)
        self.assertEqual(get('/v1/connection')[:2],(200,{'inert':'api'}))
        app.static_assets=None
        self.assertEqual(get('/consumer.js')[0],200)


if __name__=='__main__':unittest.main()
