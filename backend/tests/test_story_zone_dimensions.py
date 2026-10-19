import unittest

from cauce.story import build_plant


class StoryZoneDimensionsTests(unittest.TestCase):
    def test_uses_explicit_station_dimensions(self):
        plant = build_plant(
            "Tengo mi carpintería que mide 60x30m, con una sierra de 6x8m",
            None,
        )["plant"]

        self.assertEqual(plant["size"], {"w": 60, "d": 30})
        self.assertEqual(
            [(station["kind"], station["w"], station["d"]) for station in plant["stations"]],
            [("sierra", 6, 8)],
        )

    def test_uses_each_dimension_for_repeated_station_mentions(self):
        plant = build_plant(
            "Tengo mi carpintería que mide 60x30m, con una sierra de 6x8m, "
            "y otra sierra de 4x3m",
            None,
        )["plant"]

        self.assertEqual(plant["size"], {"w": 60, "d": 30})
        self.assertEqual(
            [(station["w"], station["d"]) for station in plant["stations"]],
            [(6, 8), (4, 3)],
        )
        self.assertEqual(
            [station["name"] for station in plant["stations"]],
            ["Sierra 1", "Sierra 2"],
        )

    def test_preserves_repeated_stations_if_ai_returns_one(self):
        plant = build_plant(
            "Tengo mi carpintería que mide 60x30m, con una sierra de 6x8m, "
            "y otra sierra de 4x3m",
            {"estaciones": [{"nombre": "Sierra", "tipo": "sierra"}]},
        )["plant"]

        self.assertEqual(
            [(station["w"], station["d"]) for station in plant["stations"]],
            [(6, 8), (4, 3)],
        )

    def test_keeps_catalog_station_dimensions_when_not_specified(self):
        plant = build_plant("Tengo una carpintería con una sierra", None)["plant"]

        self.assertEqual(
            [(station["w"], station["d"]) for station in plant["stations"]],
            [(4, 3)],
        )

    def test_uses_explicit_facility_dimensions(self):
        plant = build_plant("Tengo mi carpintería que mide 120x60m", None)["plant"]

        self.assertEqual(plant["size"], {"w": 120, "d": 60})

    def test_does_not_use_zone_dimensions_as_facility_dimensions(self):
        plant = build_plant("Tengo mi carpintería con un baño de 12x2m", None)["plant"]

        self.assertEqual(plant["size"], {"w": 24, "d": 14})
        self.assertEqual((plant["zones"][0]["w"], plant["zones"][0]["d"]), (12, 2))

    def test_uses_dimensions_from_story(self):
        plant = build_plant("Tengo una tamalería con un baño de 12x2m", None)["plant"]

        self.assertEqual((plant["zones"][0]["w"], plant["zones"][0]["d"]), (12, 2))

    def test_keeps_catalog_dimensions_when_story_has_no_size(self):
        plant = build_plant("Tengo una tamalería con un baño", None)["plant"]

        self.assertEqual((plant["zones"][0]["w"], plant["zones"][0]["d"]), (5, 5))

    def test_reads_plural_zone_with_spaced_dimensions(self):
        plant = build_plant("La fábrica tiene baños de 12 x 2 metros", None)["plant"]

        self.assertEqual((plant["zones"][0]["w"], plant["zones"][0]["d"]), (12, 2))

    def test_keeps_multiple_mentions_with_individual_dimensions(self):
        plant = build_plant(
            "Tengo una tamalería con un baño de 12x2m y otro baño de 3x3",
            None,
        )["plant"]

        self.assertEqual(
            [(zone["w"], zone["d"]) for zone in plant["zones"]],
            [(12, 2), (3, 3)],
        )
        self.assertEqual([zone["name"] for zone in plant["zones"]], ["Baños 1", "Baños 2"])
        self.assertNotEqual(plant["zones"][0]["x"], plant["zones"][1]["x"])

    def test_keeps_explicit_zone_inside_floor(self):
        plant = build_plant("Tengo una tamalería con un baño de 30 x 2 metros", None)["plant"]
        zone = plant["zones"][0]

        self.assertGreaterEqual(zone["x"] - zone["w"] / 2, 0)
        self.assertLessEqual(zone["x"] + zone["w"] / 2, plant["size"]["w"])
        self.assertGreaterEqual(zone["z"] - zone["d"] / 2, 0)
        self.assertLessEqual(zone["z"] + zone["d"] / 2, plant["size"]["d"])


if __name__ == "__main__":
    unittest.main()
