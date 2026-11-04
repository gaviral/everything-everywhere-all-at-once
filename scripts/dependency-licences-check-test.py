#!/usr/bin/env python3
"""Read-only regression checks using the existing ledger and local archives."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    'licence_checker', Path(__file__).with_name('dependency-licences-check.py'))
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class ThirdPartyNoticesTest(unittest.TestCase):
    def test_legal_filenames(self):
        for name in ('THIRD-PARTY-LICENSE', 'THIRD_PARTY', 'third_party.txt',
                     'LICENSE-MIT', 'NOTICE', 'COPYRIGHT'):
            with self.subTest(name=name):
                self.assertIsNotNone(checker.LEGAL.fullmatch(name))
        self.assertIsNone(checker.LEGAL.fullmatch('thirdparty.rs'))

    def check_omissions(self, sources):
        original_loads = checker.json.loads
        for key, required in checker.REQUIRED_NOTICES.items():
            notice = next(iter(required))

            def omit_notice(text, *args, **kwargs):
                data = original_loads(text, *args, **kwargs)
                if isinstance(data, dict) and 'locks' in data and 'packages' in data:
                    package = next(p for p in data['packages'] if
                                   (p['ecosystem'], p['name'], p['version']) == key)
                    package['evidence'] = [e for e in package['evidence']
                                           if e['source_file'] != notice]
                return data

            with self.subTest(package=key, sources=sources):
                with patch.object(checker.json, 'loads', side_effect=omit_notice):
                    if sources:
                        # Exercise archive discovery independently of explicit requirements.
                        with patch.object(checker, 'REQUIRED_NOTICES', {}):
                            with self.assertRaisesRegex(AssertionError,
                                                        'legal source file omitted: ' + notice):
                                checker.check(sources=True)
                    else:
                        with self.assertRaisesRegex(AssertionError,
                                                    'required third-party notice missing'):
                            checker.check()

    def test_static_check_rejects_omitted_notices(self):
        self.check_omissions(sources=False)

    def test_archive_check_discovers_omitted_notices(self):
        self.check_omissions(sources=True)


if __name__ == '__main__':
    unittest.main()
