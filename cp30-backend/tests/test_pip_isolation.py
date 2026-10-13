"""Exercise installed pip loader solely against new synthetic poison paths."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from pip._internal.configuration import Configuration, kinds


class PipIsolation(unittest.TestCase):
    def test_devnull_precedes_all_file_loads_even_isolated(self):
        with tempfile.TemporaryDirectory() as root:
            paths = {}
            for kind in (kinds.GLOBAL, kinds.USER, kinds.SITE):
                p = Path(root) / (str(kind) + '.conf')
                p.write_text('[global]\nindex-url = https://poison.invalid/simple\n')
                paths[kind] = [str(p)]
            for isolated in (False, True):
                config = Configuration(isolated=isolated)
                with patch.dict(os.environ, {'PIP_CONFIG_FILE': os.devnull}, clear=True), \
                     patch('pip._internal.configuration.get_configuration_files', return_value=paths), \
                     patch.object(config, '_load_file', side_effect=AssertionError('CONFIG_READ')) as load:
                    config.load()
                    load.assert_not_called()
                    self.assertFalse(any('index-url' in key for key, value in config.items()))

    def test_isolated_alone_would_load_global_and_site(self):
        config = Configuration(isolated=True)
        synthetic = {kinds.GLOBAL: ['/synthetic-global'], kinds.USER: ['/synthetic-user'], kinds.SITE: ['/synthetic-site']}
        with patch.dict(os.environ, {}, clear=True), \
             patch('pip._internal.configuration.get_configuration_files', return_value=synthetic), \
             patch.object(config, '_load_file', side_effect=AssertionError('EXPECTED_POISON_READ')):
            with self.assertRaisesRegex(AssertionError, 'EXPECTED_POISON_READ'):
                config.load()


if __name__ == '__main__':
    unittest.main()
