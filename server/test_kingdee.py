import tempfile
import unittest
from pathlib import Path

from server.kingdee_api import material_filter, rows_to_materials
from server.kingdee_server import merge_config, public_config, read_config, write_config


class ConfigStoreTests(unittest.TestCase):
    def setUp(self):
        self.existing = {
            "base_url": "https://old.example/K3Cloud/",
            "dbid": "old-db",
            "username": "old-user",
            "appid": "old-app",
            "app_secret": "keep-me",
            "protocol": "v4",
            "lcid": "2052",
            "org_number": "100",
        }

    def test_blank_secret_preserves_existing_value(self):
        result = merge_config(self.existing, {"app_secret": ""})
        self.assertEqual(result["app_secret"], "keep-me")

    def test_public_config_never_returns_secret(self):
        result = public_config(self.existing)
        self.assertNotIn("app_secret", result)
        self.assertTrue(result["has_app_secret"])

    def test_write_and_read_config_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "config.json"
            write_config(self.existing, path)
            self.assertEqual(read_config(path), self.existing)


class MaterialQueryTests(unittest.TestCase):
    def test_filter_contains_electronic_material_prefixes_and_org(self):
        result = material_filter(org_number="100")
        for prefix in range(21, 30):
            self.assertIn(f"FNumber LIKE '{prefix}%'", result)
        self.assertIn("FUseOrgId.FNumber = '100'", result)

    def test_filter_escapes_quotes(self):
        result = material_filter("A'B", "1'00")
        self.assertIn("A''B", result)
        self.assertIn("1''00", result)

    def test_rows_are_mapped_to_named_materials(self):
        materials = rows_to_materials(
            [[1, "210001", "IC|MCU|TEST|QFN-20", "", "21", "IC", "PCS", "C", "A"]]
        )
        self.assertEqual(materials[0]["number"], "210001")
        self.assertEqual(materials[0]["name"], "IC|MCU|TEST|QFN-20")


if __name__ == "__main__":
    unittest.main()
