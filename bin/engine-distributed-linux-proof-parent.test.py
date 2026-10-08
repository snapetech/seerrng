"""Focused unit tests for the generic Linux proof parent (no real Docker)."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import sys
import unittest
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools" / "validation-engine" / "container" / "mode3-proof-parent.py"
SPEC = importlib.util.spec_from_file_location("mode3_proof_parent", SOURCE)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def config() -> dict:
    payload = "owned fixture payload"
    return {
        "schema": MODULE.SCHEMA,
        "runId": "run-generic-1",
        "sourceSha256": "a" * 64,
        "outerDaemonId": "outer-daemon-generic",
        "readinessTimeoutMs": 30_000,
        "binaries": {
            "docker": "/usr/bin/docker",
            "ip6tables": "/usr/sbin/ip6tables",
            "ip6tablesRestore": "/usr/sbin/ip6tables-restore",
            "iptables": "/usr/sbin/iptables",
            "iptablesRestore": "/usr/sbin/iptables-restore",
            "setpriv": "/usr/bin/setpriv",
        },
        "paths": {
            "stateRoot": "/run-state",
            "logRoot": "/run-logs",
            "dockerSocket": "/run-state/docker/docker.sock",
            "proofSocket": "/run-state/proof.sock",
            "helperReadyFile": "/run-state/helper-ready.json",
            "cleanupArtifact": "/run-state/nested-cleanup.json",
        },
        "network": {
            "baselineMode": "baseline-public",
            "repositoryMode": "repository-loopback",
            "distributedMode": "distributed-endpoints",
            "repositoryUnitId": "repository-unit",
            "distributedUnitId": "distributed-unit",
            "leaseMaximumMs": 60_000,
            "bridgeCidr": "198.51.100.0/29",
            "baselineDeniedCidrsV4": [
                "10.0.0.0/8",
                "192.168.0.0/16",
                "198.51.100.0/24",
            ],
            "baselineDeniedCidrsV6": ["fc00::/7", "fe80::/10"],
            "distributedEndpoints": [
                {"host": "203.0.113.17", "port": 44001},
                {"host": "2001:db8::17", "port": 44002},
            ],
        },
        "dockerFixture": {
            "name": "generic-fixture",
            "imageReference": "fixture.invalid/server@sha256:" + "b" * 64,
            "bindSource": "/run-state/fixture",
            "bindTarget": "/fixture",
            "bridgeName": "docker0",
            "containerPort": 8080,
            "command": ["server", "--root", "/fixture"],
            "payloadFileName": "proof.txt",
            "payloadText": payload,
            "payloadSha256": digest(payload.encode()),
        },
        "engine": {
            "executable": "/usr/bin/node",
            "arguments": [
                "/engine/entry.mjs",
                "--manifest",
                "/config/run.json",
                "--request-file",
                "/config/contained-request.json",
            ],
            "workingDirectory": "/candidate",
            "environment": {
                "PATH": "/usr/bin:/bin",
                "DOCKER_HOST": "unix:///run-state/docker/docker.sock",
            },
        },
        "cleanup": {
            "schema": "generic-cleanup/v1",
            "engineTerminateSeconds": 20,
            "engineKillSeconds": 5,
            "dockerInspectSeconds": 60,
            "dockerRemoveSeconds": 60,
            "dockerListSeconds": 30,
            "proofServerStopSeconds": 5,
            "terminalBudgetSeconds": 180,
        },
    }


class FakeKernel:
    def __init__(self, normalized: dict, fail_mode: str | None = None):
        self.config = normalized
        self.mode = None
        self.fail_mode = fail_mode
        self.initialize_calls = 0

    def initialize(self) -> None:
        self.initialize_calls += 1

    def set_mode(self, mode: str) -> None:
        if mode == self.fail_mode:
            raise RuntimeError("injected transition failure")
        self.mode = mode

    def observe(self) -> dict:
        return {"mode": self.mode, "rules": [[self.mode]]}


class ProofParentTests(unittest.TestCase):
    def test_config_and_policy_are_manifest_driven(self) -> None:
        normalized = MODULE.normalize_config(config())
        output4, forward4 = MODULE.policy_rules(
            normalized, normalized["network"]["distributedMode"], 4
        )
        output6, _ = MODULE.policy_rules(
            normalized, normalized["network"]["distributedMode"], 6
        )
        self.assertIn(
            ["-d", "203.0.113.17/32", "-p", "tcp", "--dport", "44001", "-j", "RETURN"],
            output4,
        )
        self.assertIn(
            ["-d", "2001:db8::17/128", "-p", "tcp", "--dport", "44002", "-j", "RETURN"],
            output6,
        )
        self.assertEqual(forward4[-2], ["-i", "docker0", "-j", "REJECT"])

    def test_engine_child_drops_all_capability_sets(self) -> None:
        normalized = MODULE.normalize_config(config())
        request_sha256 = "d" * 64
        command = MODULE.engine_command(normalized, request_sha256)
        self.assertEqual(
            command[:6],
            [
                "/usr/bin/setpriv",
                "--bounding-set=-all",
                "--inh-caps=-all",
                "--ambient-caps=-all",
                "--no-new-privs",
                "--",
            ],
        )
        self.assertEqual(command[6:8], ["/usr/bin/env", "-i"])
        self.assertIn("DOCKER_HOST=unix:///run-state/docker/docker.sock", command[8:])
        self.assertIn("PATH=/usr/bin:/bin", command[8:])
        self.assertIn(
            f"{MODULE.CONTAINED_REQUEST_SHA256_ENV}={request_sha256}", command[8:]
        )
        self.assertEqual(
            command[-6:],
            [
                "/usr/bin/node",
                "/engine/entry.mjs",
                "--manifest",
                "/config/run.json",
                "--request-file",
                "/config/contained-request.json",
            ],
        )

    def test_contained_request_is_raw_hash_bound_and_rechecked(self) -> None:
        raw = b'{\n  "schema": "focused"\n}\n'
        with mock.patch.object(MODULE, "stable_file_bytes", return_value=raw):
            self.assertEqual(
                MODULE.verify_contained_request(
                    "/config/contained-request.json", digest(raw)
                ),
                raw,
            )
        with mock.patch.object(
            MODULE, "stable_file_bytes", return_value=raw + b" "
        ):
            with self.assertRaisesRegex(ValueError, "contained request changed"):
                MODULE.verify_contained_request(
                    "/config/contained-request.json", digest(raw)
                )

    def test_proc_route_parser_excludes_the_default_route(self) -> None:
        raw = (
            "Iface Destination Gateway Flags RefCnt Use Metric Mask\n"
            "eth0 00000000 0100000A 0003 0 0 0 00000000\n"
            "eth0 000011AC 00000000 0001 0 0 0 0000FFFF\n"
        )
        self.assertEqual(
            [str(route) for route in MODULE.proc_ipv4_routes(raw)],
            ["172.17.0.0/16"],
        )

    def test_admission_is_single_lease_and_restores_exact_baseline(self) -> None:
        normalized = MODULE.normalize_config(config())
        events = []
        kernel = FakeKernel(normalized)
        admission = MODULE.Admission(
            normalized,
            kernel,
            events.append,
            clock=lambda: 1.0,
            namespace=lambda: "net:[generic]",
        )
        baseline = admission.frozen
        lease = admission.begin(
            normalized["network"]["distributedMode"],
            normalized["network"]["distributedUnitId"],
            "distributed-begin",
        )
        self.assertEqual(lease["allowedEndpoints"], normalized["network"]["distributedEndpoints"])
        with self.assertRaisesRegex(ValueError, "Only one"):
            admission.begin(
                normalized["network"]["repositoryMode"],
                normalized["network"]["repositoryUnitId"],
                "repository-begin",
            )
        restored = admission.end(
            lease["token"],
            normalized["network"]["distributedUnitId"],
            "distributed-end",
        )
        self.assertEqual(restored["restoredToken"], lease["token"])
        self.assertEqual(restored["rulesSha256"], baseline)

    def test_failed_begin_rolls_back_or_fails_closed(self) -> None:
        normalized = MODULE.normalize_config(config())
        kernel = FakeKernel(normalized, normalized["network"]["repositoryMode"])
        admission = MODULE.Admission(
            normalized,
            kernel,
            lambda _event: None,
            namespace=lambda: "net:[generic]",
        )
        baseline = admission.frozen
        with self.assertRaisesRegex(RuntimeError, "injected"):
            admission.begin(
                normalized["network"]["repositoryMode"],
                normalized["network"]["repositoryUnitId"],
                "repository-begin",
            )
        self.assertIsNone(admission.token)
        self.assertEqual(admission.mode, normalized["network"]["baselineMode"])
        self.assertEqual(admission.frozen, baseline)

    def test_mutations_are_rejected_and_recovery_literals_are_absent(self) -> None:
        mutated = config()
        mutated["dockerFixture"]["payloadSha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "payload digest"):
            MODULE.normalize_config(mutated)
        privileged_path = config()
        privileged_path["binaries"]["setpriv"] = "/candidate/fake-setpriv"
        with self.assertRaisesRegex(ValueError, "immutable helper image"):
            MODULE.normalize_config(privileged_path)
        injected_environment = config()
        injected_environment["engine"]["environment"]["LD_PRELOAD"] = "/candidate/inject.so"
        with self.assertRaisesRegex(ValueError, "injection key"):
            MODULE.normalize_config(injected_environment)
        reserved_environment = config()
        reserved_environment["engine"]["environment"][
            MODULE.CONTAINED_REQUEST_SHA256_ENV
        ] = "e" * 64
        with self.assertRaisesRegex(ValueError, "injection key"):
            MODULE.normalize_config(reserved_environment)
        cleanup_budget = config()
        cleanup_budget["cleanup"]["terminalBudgetSeconds"] -= 1
        with self.assertRaisesRegex(ValueError, "cleanup budget differs"):
            MODULE.normalize_config(cleanup_budget)
        source = SOURCE.read_text(encoding="utf-8")
        for forbidden in (
            "192.168.10.9",
            "62021",
            "4285ed6",
            "d9a5b8fd96546043d8207b6da23fcacf36553643",
            "seerrng-engine-mode3-cold-bind-probe-20261007",
        ):
            self.assertNotIn(forbidden, source)

    def test_proof_client_rejects_a_different_server_pid(self) -> None:
        class FakeConnection:
            def settimeout(self, _timeout: int) -> None:
                pass

            def connect(self, _path: str) -> None:
                pass

            def getsockopt(self, *_args) -> bytes:
                return struct.pack("3i", 77, 0, 0)

        standard_input = SimpleNamespace(buffer=BytesIO(b'{"op":"observe"}\n'))
        with (
            mock.patch.object(MODULE.socket, "AF_UNIX", 1, create=True),
            mock.patch.object(MODULE.socket, "SO_PEERCRED", 17, create=True),
            mock.patch.object(MODULE.socket, "socket", return_value=FakeConnection()),
            mock.patch.object(MODULE.sys, "stdin", standard_input),
        ):
            with self.assertRaisesRegex(ValueError, "peer differs"):
                MODULE.request_proof("/run-state/proof.sock", 88)


if __name__ == "__main__":
    unittest.main()
