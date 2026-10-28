#!/usr/bin/env python3
"""Focused export invariants, using real compiler outputs without rebuilding."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('export_artifacts', Path(__file__).with_name('export-artifacts.py'))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportInvariants(unittest.TestCase):
    def test_renumbered_and_reordered_ast_ids_export_identically(self):
        for name in exporter.NAMES:
            with self.subTest(contract=name):
                compiled = json.loads((exporter.ROOT/'out'/f'{name}.sol'/f'{name}.json').read_text())
                source = (exporter.ROOT/'contracts'/f'{name}.sol').read_bytes()
                altered = copy.deepcopy(compiled)
                refs = compiled['deployedBytecode']['immutableReferences']
                altered['deployedBytecode']['immutableReferences'] = {
                    str(100000 + i): list(reversed(ranges))
                    for i, ranges in enumerate(reversed(list(refs.values())))}
                first = exporter.export_artifact(name, compiled, source)
                second = exporter.export_artifact(name, altered, source)
                self.assertEqual(first, second)
                self.assertEqual(first['abi'], compiled['abi'])
                self.assertEqual(first['bytecode'], compiled['bytecode']['object'])
                self.assertEqual(first['deployedBytecode'], compiled['deployedBytecode']['object'])
                # Preserve every range and immutable grouping, independent of keys/order.
                groups = lambda mapping: sorted(tuple(sorted((r['start'], r['length']) for r in rs))
                                                for rs in mapping.values())
                self.assertEqual(groups(first['immutableReferences']), groups(refs))

    def test_no_immutables(self):
        self.assertEqual(exporter.canonical_immutable_references({}), {})


if __name__ == '__main__':
    unittest.main()
