from __future__ import annotations

import unittest

from benchmarks.large_project_backend import PROFILE, create_large_project, project_shape


class LargeProjectBenchmarkFixtureTests(unittest.TestCase):
    def test_backend_fixture_has_exact_release_scale(self) -> None:
        project = create_large_project()
        self.assertEqual(project_shape(project), PROFILE)
        self.assertEqual(len(project["scripts"]), 100)
        self.assertEqual(len(project["timelines"]), 100)


if __name__ == "__main__":
    unittest.main()
