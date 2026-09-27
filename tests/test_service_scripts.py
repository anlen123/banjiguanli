"""Exercise service scripts with a fake Docker CLI, without touching real services."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]


class ServiceScriptsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="island scripts ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project with spaces"
        self.root.mkdir()
        for name in ("start.sh", "stop.sh", "restart.sh", ".env.example", "docker-compose.yml"):
            shutil.copy2(SOURCE / name, self.root / name)
        shutil.copytree(SOURCE / "scripts", self.root / "scripts")
        self.bin = Path(self.temp.name) / "bin"
        self.bin.mkdir()
        self.log = Path(self.temp.name) / "calls.jsonl"
        fake = self.bin / "docker"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            "with open(os.environ['MOCK_LOG'], 'a') as f:\n"
            "    f.write(json.dumps(sys.argv[1:]) + '\\n')\n"
            "if os.environ.get('MOCK_FAIL') in sys.argv[1:]: sys.exit(19)\n"
        )
        fake.chmod(0o755)
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "MOCK_LOG": str(self.log),
        }

    def run_script(self, name, *args, fail=""):
        return subprocess.run(
            ["bash", str(self.root / name), *args],
            cwd=self.temp.name,
            env={**self.env, "MOCK_FAIL": fail},
            text=True,
            capture_output=True,
            timeout=15,
        )

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def test_start_from_other_directory_and_private_config(self):
        result = self.run_script("start.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / ".env").stat().st_mode & 0o777, 0o600)
        up = next(c for c in self.calls() if "up" in c)
        self.assertIn(str(self.root), up)
        self.assertIn(str(self.root / ".env"), up)
        self.assertIn("--build", up)
        self.assertIn("--wait", up)

    def test_start_preserves_existing_config(self):
        config = self.root / ".env"
        config.write_text("APP_ORIGIN=https://class.example.com\n")
        result = self.run_script("start.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(config.read_text(), "APP_ORIGIN=https://class.example.com\n")

    def test_stop_never_deletes_data_or_creates_config(self):
        result = self.run_script("stop.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("stop" in c for c in self.calls()))
        self.assertFalse((self.root / ".env").exists())
        for call in self.calls():
            self.assertTrue(set(call).isdisjoint({"down", "rm", "--volumes", "-v"}))

    def test_restart_builds_before_stop_and_does_not_build_twice(self):
        result = self.run_script("restart.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        build = next(i for i, c in enumerate(calls) if "build" in c)
        stop = next(i for i, c in enumerate(calls) if "stop" in c)
        up = next(i for i, c in enumerate(calls) if "up" in c)
        self.assertLess(build, stop)
        self.assertLess(stop, up)
        self.assertIn("--no-build", calls[up])

    def test_build_failure_does_not_stop_running_service(self):
        result = self.run_script("restart.sh", fail="build")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any("stop" in c or "up" in c for c in self.calls()))

    def test_daemon_failure_stops_before_changes(self):
        result = self.run_script("start.sh", fail="info")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("无法连接 Docker", result.stderr)
        self.assertFalse((self.root / ".env").exists())

    def test_failed_start_is_not_reported_as_success(self):
        result = self.run_script("start.sh", fail="up")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("班级小岛已启动", result.stdout)

    def test_unexpected_arguments_are_rejected(self):
        result = self.run_script("stop.sh", "--volumes")
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
