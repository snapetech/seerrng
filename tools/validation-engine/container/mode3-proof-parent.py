#!/usr/bin/env python3
"""Own the Mode 3 network policy and launch one capability-free engine child.

The only accepted authority is an immutable, digest-checked JSON config.  The
Unix RPC protocol admits fixed proof operations; it never accepts commands.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import posixpath
import re
import shlex
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path, PurePosixPath
from typing import Any, Callable

if sys.platform != "win32":
    import fcntl


SCHEMA = "seerrng-distributed-linux-proof-parent/v1"
SOCKET_LIMIT = 16_384
CONTAINED_REQUEST_SHA256_ENV = "SEERR_MODE3_CONTAINED_REQUEST_SHA256"
UNSAFE_ENVIRONMENT = {
    "BASH_ENV",
    "ENV",
    "GCONV_PATH",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "NODE_PATH",
    "PYTHONHOME",
    "PYTHONPATH",
    "SHELLOPTS",
}


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def exact_object(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{label} requires its exact field set")
    return value


def exact_text(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or "\x00" in value
        or "\n" in value
        or "\r" in value
    ):
        raise ValueError(f"Exact {label} is required")
    return value


def exact_path(value: Any, label: str) -> str:
    result = exact_text(value, label)
    if not result.startswith("/") or posixpath.normpath(result) != result:
        raise ValueError(f"{label} must be an absolute normalized path")
    return result


def exact_digest(value: Any, label: str) -> str:
    result = exact_text(value, label)
    if len(result) != 64 or any(character not in "0123456789abcdef" for character in result):
        raise ValueError(f"{label} must be a lowercase SHA-256 digest")
    return result


def trusted_binary(value: Any, label: str) -> str:
    result = exact_path(value, label)
    path_value = PurePosixPath(result)
    trusted = tuple(PurePosixPath(root) for root in ("/usr/bin", "/usr/sbin", "/usr/local/bin", "/usr/local/sbin"))
    if not any(path_value.is_relative_to(root) for root in trusted):
        raise ValueError(f"{label} must be in the immutable helper image")
    return result


def positive_integer(value: Any, label: str, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= maximum:
        raise ValueError(f"{label} must be a bounded positive integer")
    return value


def normalize_endpoint(value: Any, label: str) -> dict[str, Any]:
    entry = exact_object(value, {"host", "port"}, label)
    host = exact_text(entry["host"], f"{label} host")
    try:
        address = ipaddress.ip_address(host)
    except ValueError as error:
        raise ValueError(f"{label} host must be a literal IP address") from error
    return {
        "host": address.compressed,
        "port": positive_integer(entry["port"], f"{label} port", 65_535),
    }


def normalize_config(value: Any) -> dict[str, Any]:
    config = exact_object(
        value,
        {
            "binaries",
            "cleanup",
            "dockerFixture",
            "engine",
            "network",
            "outerDaemonId",
            "paths",
            "readinessTimeoutMs",
            "runId",
            "schema",
            "sourceSha256",
        },
        "proof parent config",
    )
    if config["schema"] != SCHEMA:
        raise ValueError("Unsupported proof parent config schema")
    binaries = exact_object(
        config["binaries"],
        {
            "docker",
            "ip6tables",
            "ip6tablesRestore",
            "iptables",
            "iptablesRestore",
            "setpriv",
        },
        "proof parent binaries",
    )
    paths = exact_object(
        config["paths"],
        {
            "cleanupArtifact",
            "dockerSocket",
            "helperReadyFile",
            "logRoot",
            "proofSocket",
            "stateRoot",
        },
        "proof parent paths",
    )
    engine = exact_object(
        config["engine"],
        {"arguments", "environment", "executable", "workingDirectory"},
        "engine child",
    )
    if not isinstance(engine["arguments"], list) or not all(
        isinstance(entry, str) and "\x00" not in entry for entry in engine["arguments"]
    ):
        raise ValueError("Engine arguments must be strings")
    if not isinstance(engine["environment"], dict) or not all(
        isinstance(key, str)
        and key
        and isinstance(entry, str)
        and "\x00" not in key
        and "=" not in key
        and "\x00" not in entry
        for key, entry in engine["environment"].items()
    ):
        raise ValueError("Engine environment must contain exact strings")
    if any(
        key in UNSAFE_ENVIRONMENT
        or key == CONTAINED_REQUEST_SHA256_ENV
        or re.search(r"secret|token|password|credential|api[_-]?key", key, re.IGNORECASE)
        for key in engine["environment"]
    ):
        raise ValueError("Engine environment contains a privileged-process injection key")
    network = exact_object(
        config["network"],
        {
            "baselineDeniedCidrsV4",
            "baselineDeniedCidrsV6",
            "baselineMode",
            "bridgeCidr",
            "distributedEndpoints",
            "distributedMode",
            "distributedUnitId",
            "leaseMaximumMs",
            "repositoryMode",
            "repositoryUnitId",
        },
        "proof parent network",
    )
    fixture = exact_object(
        config["dockerFixture"],
        {
            "bindSource",
            "bindTarget",
            "bridgeName",
            "command",
            "containerPort",
            "imageReference",
            "name",
            "payloadFileName",
            "payloadText",
            "payloadSha256",
        },
        "private Docker fixture",
    )
    cleanup = exact_object(
        config["cleanup"],
        {
            "dockerInspectSeconds",
            "dockerListSeconds",
            "dockerRemoveSeconds",
            "engineKillSeconds",
            "engineTerminateSeconds",
            "proofServerStopSeconds",
            "schema",
            "terminalBudgetSeconds",
        },
        "cleanup evidence",
    )
    cidrs_v4 = [
        str(ipaddress.ip_network(exact_text(entry, "IPv4 denied CIDR"), strict=True))
        for entry in network["baselineDeniedCidrsV4"]
    ]
    cidrs_v6 = [
        str(ipaddress.ip_network(exact_text(entry, "IPv6 denied CIDR"), strict=True))
        for entry in network["baselineDeniedCidrsV6"]
    ]
    if not cidrs_v4 or not cidrs_v6:
        raise ValueError("Complete denied CIDR sets are required")
    if any(ipaddress.ip_network(entry).version != 4 for entry in cidrs_v4) or any(
        ipaddress.ip_network(entry).version != 6 for entry in cidrs_v6
    ):
        raise ValueError("Denied CIDR family differs")
    endpoints = [
        normalize_endpoint(entry, f"distributed endpoint {index}")
        for index, entry in enumerate(network["distributedEndpoints"])
    ]
    if not endpoints or len({(entry["host"], entry["port"]) for entry in endpoints}) != len(endpoints):
        raise ValueError("Unique distributed endpoints are required")
    bridge = ipaddress.ip_network(exact_text(network["bridgeCidr"], "bridge CIDR"), strict=True)
    if bridge.version != 4:
        raise ValueError("Private Docker bridge must be IPv4")
    if not any(bridge.subnet_of(ipaddress.ip_network(cidr)) for cidr in cidrs_v4):
        raise ValueError("Private Docker bridge must be covered by the baseline denial")
    if not isinstance(fixture["command"], list) or not fixture["command"] or not all(
        isinstance(entry, str) and entry and "\x00" not in entry for entry in fixture["command"]
    ):
        raise ValueError("Fixture command must contain exact arguments")
    payload_name = exact_text(fixture["payloadFileName"], "fixture payload file name")
    if Path(payload_name).name != payload_name:
        raise ValueError("Fixture payload must be a simple file name")
    normalized_binaries = {
        key: trusted_binary(entry, f"binary {key}")
        for key, entry in binaries.items()
    }
    if len(set(normalized_binaries.values())) != len(normalized_binaries):
        raise ValueError("Proof binaries must use distinct immutable paths")
    result = {
        "schema": SCHEMA,
        "runId": exact_text(config["runId"], "run ID"),
        "sourceSha256": exact_digest(config["sourceSha256"], "source hash"),
        "outerDaemonId": exact_text(config["outerDaemonId"], "outer daemon ID"),
        "readinessTimeoutMs": positive_integer(
            config["readinessTimeoutMs"], "readiness timeout", 600_000
        ),
        "binaries": normalized_binaries,
        "paths": {key: exact_path(entry, f"path {key}") for key, entry in paths.items()},
        "engine": {
            "executable": exact_path(engine["executable"], "engine executable"),
            "arguments": list(engine["arguments"]),
            "workingDirectory": exact_path(engine["workingDirectory"], "engine working directory"),
            "environment": dict(engine["environment"]),
        },
        "network": {
            "baselineMode": exact_text(network["baselineMode"], "baseline mode"),
            "repositoryMode": exact_text(network["repositoryMode"], "repository mode"),
            "distributedMode": exact_text(network["distributedMode"], "distributed mode"),
            "repositoryUnitId": exact_text(network["repositoryUnitId"], "repository unit ID"),
            "distributedUnitId": exact_text(network["distributedUnitId"], "distributed unit ID"),
            "leaseMaximumMs": positive_integer(network["leaseMaximumMs"], "lease maximum", 3_600_000),
            "bridgeCidr": str(bridge),
            "baselineDeniedCidrsV4": cidrs_v4,
            "baselineDeniedCidrsV6": cidrs_v6,
            "distributedEndpoints": endpoints,
        },
        "dockerFixture": {
            "name": exact_text(fixture["name"], "fixture name"),
            "imageReference": exact_text(fixture["imageReference"], "fixture image"),
            "bindSource": exact_path(fixture["bindSource"], "fixture bind source"),
            "bindTarget": exact_path(fixture["bindTarget"], "fixture bind target"),
            "bridgeName": exact_text(fixture["bridgeName"], "fixture bridge name"),
            "containerPort": positive_integer(fixture["containerPort"], "fixture port", 65_535),
            "command": list(fixture["command"]),
            "payloadFileName": payload_name,
            "payloadText": exact_text(fixture["payloadText"], "fixture payload"),
            "payloadSha256": exact_digest(fixture["payloadSha256"], "fixture payload hash"),
        },
        "cleanup": {
            "schema": exact_text(cleanup["schema"], "cleanup schema"),
            "engineTerminateSeconds": positive_integer(
                cleanup["engineTerminateSeconds"], "engine terminate timeout", 600
            ),
            "engineKillSeconds": positive_integer(
                cleanup["engineKillSeconds"], "engine kill timeout", 600
            ),
            "dockerInspectSeconds": positive_integer(
                cleanup["dockerInspectSeconds"], "Docker inspect timeout", 600
            ),
            "dockerRemoveSeconds": positive_integer(
                cleanup["dockerRemoveSeconds"], "Docker remove timeout", 600
            ),
            "dockerListSeconds": positive_integer(
                cleanup["dockerListSeconds"], "Docker list timeout", 600
            ),
            "proofServerStopSeconds": positive_integer(
                cleanup["proofServerStopSeconds"], "proof server stop timeout", 600
            ),
            "terminalBudgetSeconds": positive_integer(
                cleanup["terminalBudgetSeconds"], "terminal cleanup budget", 3_600
            ),
        },
    }
    state_root = PurePosixPath(result["paths"]["stateRoot"])
    for name in ("dockerSocket", "helperReadyFile", "proofSocket", "cleanupArtifact"):
        try:
            PurePosixPath(result["paths"][name]).relative_to(state_root)
        except ValueError as error:
            raise ValueError(f"{name} must stay under the state root") from error
    try:
        PurePosixPath(result["dockerFixture"]["bindSource"]).relative_to(state_root)
    except ValueError as error:
        raise ValueError("Fixture bind source must stay under the state root") from error
    if (
        sha256(result["dockerFixture"]["payloadText"].encode("utf-8"))
        != result["dockerFixture"]["payloadSha256"]
    ):
        raise ValueError("Fixture payload digest differs")
    cleanup_budget = sum(
        result["cleanup"][name]
        for name in (
            "engineTerminateSeconds",
            "engineKillSeconds",
            "dockerInspectSeconds",
            "dockerRemoveSeconds",
            "dockerListSeconds",
            "proofServerStopSeconds",
        )
    )
    if cleanup_budget != result["cleanup"]["terminalBudgetSeconds"]:
        raise ValueError("Terminal cleanup budget differs from its bounded operations")
    return result


def policy_rules(config: dict[str, Any], mode: str, family: int) -> tuple[list[list[str]], list[list[str]]]:
    network = config["network"]
    modes = {
        network["baselineMode"],
        network["repositoryMode"],
        network["distributedMode"],
    }
    if len(modes) != 3 or mode not in modes:
        raise ValueError("Unknown or non-unique configured policy mode")
    output = [["-o", "lo", "-j", "RETURN"]]
    bridge_name = config["dockerFixture"]["bridgeName"]
    forward = [["-i", bridge_name, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "RETURN"]]
    if mode == network["baselineMode"]:
        if family == 4:
            output.append(
                ["-d", network["bridgeCidr"], "-p", "tcp", "-m", "conntrack", "--ctorigdst", "127.0.0.1", "--ctdir", "ORIGINAL", "-j", "RETURN"]
            )
        for cidr in network[f"baselineDeniedCidrsV{family}"]:
            output.append(["-d", cidr, "-j", "REJECT"])
            forward.append(["-i", bridge_name, "-d", cidr, "-j", "REJECT"])
        output.append(["-j", "RETURN"])
        forward.append(["-j", "RETURN"])
    elif mode == network["repositoryMode"]:
        output.append(["-j", "REJECT"])
        forward.extend((["-i", bridge_name, "-j", "REJECT"], ["-j", "RETURN"]))
    else:
        for endpoint in network["distributedEndpoints"]:
            address = ipaddress.ip_address(endpoint["host"])
            if address.version == family:
                output.append(["-d", f"{address.compressed}/{address.max_prefixlen}", "-p", "tcp", "--dport", str(endpoint["port"]), "-j", "RETURN"])
        output.append(["-j", "REJECT"])
        forward.extend((["-i", bridge_name, "-j", "REJECT"], ["-j", "RETURN"]))
    return output, forward


def proc_ipv4_routes(raw: str) -> list[ipaddress.IPv4Network]:
    routes = []
    for line in raw.splitlines()[1:]:
        fields = line.split()
        if len(fields) < 8 or (fields[1] == "00000000" and fields[7] == "00000000"):
            continue
        destination = socket.inet_ntoa(struct.pack("<L", int(fields[1], 16)))
        netmask = socket.inet_ntoa(struct.pack("<L", int(fields[7], 16)))
        routes.append(ipaddress.ip_network(f"{destination}/{netmask}", strict=False))
    return routes


class Kernel:
    def __init__(self, config: dict[str, Any]):
        self.config = config
        suffix = sha256(canonical([config["runId"], config["sourceSha256"]]))[:12].upper()
        self.output_chain = f"SEERR_E_{suffix}"
        self.forward_chain = f"SEERR_F_{suffix}"
        self.env = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}

    def run(self, args: list[str], data: bytes | None = None, timeout: int = 20) -> bytes:
        if not 1 <= timeout <= 180:
            raise ValueError("Bounded infrastructure timeout required")
        result = subprocess.run(args, input=data, capture_output=True, env=self.env, timeout=timeout, check=False)
        if result.returncode:
            raise RuntimeError(f"Infrastructure command failed: {args[0]} exit={result.returncode}: {result.stderr.decode(errors='replace')}")
        return result.stdout

    def initialize(self) -> None:
        for binary in (self.config["binaries"]["iptables"], self.config["binaries"]["ip6tables"]):
            for chain, hook in ((self.output_chain, "OUTPUT"), (self.forward_chain, "FORWARD")):
                self.run([binary, "-N", chain])
                self.run([binary, "-I", hook, "1", "-j", chain])

    def set_mode(self, mode: str) -> None:
        pairs = (
            (4, self.config["binaries"]["iptablesRestore"]),
            (6, self.config["binaries"]["ip6tablesRestore"]),
        )
        for family, binary in pairs:
            output, forward = policy_rules(self.config, mode, family)
            lines = ["*filter"]
            for chain, rules in ((self.output_chain, output), (self.forward_chain, forward)):
                lines.append(f"-F {chain}")
                lines.extend("-A " + chain + " " + " ".join(rule) for rule in rules)
            self.run([binary, "--noflush"], ("\n".join(lines + ["COMMIT", ""])).encode())

    def observe(self) -> dict[str, Any]:
        result = {}
        for family, binary in (("ipv4", self.config["binaries"]["iptables"]), ("ipv6", self.config["binaries"]["ip6tables"])):
            policies = []
            for chain, hook in ((self.output_chain, "OUTPUT"), (self.forward_chain, "FORWARD")):
                rules = self.run([binary, "-S", chain]).decode().splitlines()
                hooks = self.run([binary, "-S", hook]).decode().splitlines()
                first = next((line for line in hooks if line.startswith("-A ")), None)
                if first != f"-A {hook} -j {chain}":
                    raise RuntimeError(f"Owned {hook} guard is not first")
                policies.append({"chain": chain, "rules": [shlex.split(line) for line in rules], "firstHook": shlex.split(first)})
            result[family] = policies
        return result

    def reconcile_docker_hooks(self) -> None:
        for binary in (self.config["binaries"]["iptables"], self.config["binaries"]["ip6tables"]):
            for chain, hook in ((self.output_chain, "OUTPUT"), (self.forward_chain, "FORWARD")):
                rules = self.run([binary, "-S", hook]).decode().splitlines()
                exact = f"-A {hook} -j {chain}"
                if rules.count(exact) != 1:
                    raise RuntimeError("Owned startup hook absent or duplicated")
                first = next((line for line in rules if line.startswith("-A ")), None)
                if first != exact:
                    self.run([binary, "-D", hook, "-j", chain])
                    self.run([binary, "-I", hook, "1", "-j", chain])

    def verify_bridge_not_overlapping(self) -> dict[str, Any]:
        bridge = ipaddress.ip_network(self.config["network"]["bridgeCidr"])
        observed: list[str] = []
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as control:
            for _, interface in socket.if_nameindex():
                request = struct.pack("256s", interface.encode()[:15])
                try:
                    address = socket.inet_ntoa(
                        fcntl.ioctl(control.fileno(), 0x8915, request)[20:24]
                    )
                    netmask = socket.inet_ntoa(
                        fcntl.ioctl(control.fileno(), 0x891B, request)[20:24]
                    )
                except OSError:
                    continue
                network = ipaddress.ip_network(f"{address}/{netmask}", strict=False)
                observed.append(str(network))
                if network.overlaps(bridge):
                    raise RuntimeError("Private Docker bridge overlaps a helper address")
        route_table = Path("/proc/net/route").read_text(encoding="ascii")
        for network in proc_ipv4_routes(route_table):
            observed.append(str(network))
            if network.overlaps(bridge):
                raise RuntimeError("Private Docker bridge overlaps a helper route")
        return {
            "bridgeCidr": str(bridge),
            "bridgeOverlapVerified": True,
            "observedNetworksSha256": sha256(canonical(sorted(observed))),
        }

    def docker(self, args: list[str], timeout: int = 30) -> bytes:
        endpoint = f"unix://{self.config['paths']['dockerSocket']}"
        return self.run([self.config["binaries"]["docker"], "--host", endpoint, *args], timeout=timeout)

    def docker_json(self, args: list[str]) -> Any:
        return json.loads(self.docker([*args, "--format", "{{json .}}"]))

    def create_fixture(self) -> dict[str, Any]:
        fixture = self.config["dockerFixture"]
        source = Path(fixture["bindSource"])
        source.mkdir(mode=0o700, parents=True, exist_ok=False)
        payload = source / fixture["payloadFileName"]
        payload.write_text(fixture["payloadText"], encoding="utf-8")
        if sha256(payload.read_bytes()) != fixture["payloadSha256"]:
            raise RuntimeError("Fixture payload write-back differs")
        self.docker(
            [
                "run", "--detach", "--name", fixture["name"],
                "--mount", f"type=bind,src={fixture['bindSource']},dst={fixture['bindTarget']},readonly",
                "--publish", f"127.0.0.1::{fixture['containerPort']}",
                fixture["imageReference"], *fixture["command"],
            ],
            timeout=60,
        )
        return self.docker_observe()

    def verify_loopback_fixture(self, port: int, container_address: str) -> None:
        fixture = self.config["dockerFixture"]
        with socket.create_connection(("127.0.0.1", port), timeout=5) as connection:
            request = (
                f"GET /{fixture['payloadFileName']} HTTP/1.0\r\n"
                "Host: localhost\r\nConnection: close\r\n\r\n"
            ).encode()
            connection.sendall(request)
            response = b""
            while True:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                if len(response) + len(chunk) > 1_048_576:
                    raise RuntimeError("Fixture response exceeded bound")
                response += chunk
        head, separator, body = response.partition(b"\r\n\r\n")
        if not separator or b" 200 " not in head.split(b"\r\n", 1)[0] or sha256(body) != fixture["payloadSha256"]:
            raise RuntimeError("Loopback fixture response differs")
        try:
            with socket.create_connection(
                (container_address, fixture["containerPort"]), timeout=1
            ):
                pass
        except OSError:
            return
        raise RuntimeError("Direct nested-container reachability was not denied")

    def docker_observe(self) -> dict[str, Any]:
        fixture_config = self.config["dockerFixture"]
        socket_path = Path(self.config["paths"]["dockerSocket"])
        if not socket_path.is_socket():
            raise RuntimeError("Private Docker Unix socket absent")
        info = self.docker_json(["info"])
        bridge = json.loads(self.docker(["network", "inspect", "bridge"]))[0]
        fixture = json.loads(self.docker(["inspect", fixture_config["name"]]))[0]
        daemon_id = info.get("ID")
        if not daemon_id or daemon_id == self.config["outerDaemonId"]:
            raise RuntimeError("Private daemon is not distinct from the outer daemon")
        subnets = [entry["Subnet"] for entry in bridge["IPAM"]["Config"]]
        bridge_name = bridge.get("Options", {}).get("com.docker.network.bridge.name", "docker0")
        if subnets != [self.config["network"]["bridgeCidr"]] or bridge_name != fixture_config["bridgeName"]:
            raise RuntimeError("Private Docker bridge differs")
        mounts = fixture.get("Mounts", [])
        ports = fixture.get("NetworkSettings", {}).get("Ports", {}).get(f"{fixture_config['containerPort']}/tcp", [])
        if (
            fixture.get("Name") != "/" + fixture_config["name"]
            or not fixture.get("State", {}).get("Running")
            or fixture.get("Config", {}).get("Image") != fixture_config["imageReference"]
            or len(mounts) != 1
            or mounts[0].get("Source") != fixture_config["bindSource"]
            or mounts[0].get("Destination") != fixture_config["bindTarget"]
            or mounts[0].get("RW") is not False
            or len(ports) != 1
            or ports[0].get("HostIp") != "127.0.0.1"
        ):
            raise RuntimeError("Private Docker fixture differs")
        port = positive_integer(int(ports[0]["HostPort"]), "ephemeral fixture port", 65_535)
        container_address = fixture.get("NetworkSettings", {}).get("IPAddress")
        if not isinstance(container_address, str) or not container_address:
            raise RuntimeError("Private fixture address is absent")
        self.verify_loopback_fixture(port, container_address)
        return {
            "daemonId": daemon_id,
            "outerDaemonId": self.config["outerDaemonId"],
            "distinctDaemonVerified": True,
            "daemonVersion": info.get("ServerVersion"),
            "endpoint": f"unix://{self.config['paths']['dockerSocket']}",
            "bridgeCidr": self.config["network"]["bridgeCidr"],
            "bridgeName": fixture_config["bridgeName"],
            "fixtureName": fixture_config["name"],
            "fixtureId": fixture.get("Id"),
            "fixtureImage": fixture_config["imageReference"],
            "bindSource": fixture_config["bindSource"],
            "bindTarget": fixture_config["bindTarget"],
            "containerPort": fixture_config["containerPort"],
            "publishedPort": port,
            "executableSha256": sha256(Path(self.config["binaries"]["docker"]).read_bytes()),
            "scratchBindPathsVerified": True,
            "loopbackReachabilityVerified": True,
            "directReachabilityDenied": True,
            "daemonVerified": True,
        }

    def cleanup_fixture(self, expected_id: str | None) -> list[str]:
        name = self.config["dockerFixture"]["name"]
        cleanup = self.config["cleanup"]
        inspect_result = subprocess.run(
            [
                self.config["binaries"]["docker"],
                "--host",
                f"unix://{self.config['paths']['dockerSocket']}",
                "inspect",
                name,
            ],
            capture_output=True,
            env=self.env,
            timeout=cleanup["dockerInspectSeconds"],
            check=False,
        )
        if inspect_result.returncode == 0:
            inspected = json.loads(inspect_result.stdout)[0]
            actual_id = inspected.get("Id")
            if (
                not isinstance(actual_id, str)
                or (expected_id is not None and actual_id != expected_id)
                or inspected.get("Name") != "/" + name
                or inspected.get("Config", {}).get("Image")
                != self.config["dockerFixture"]["imageReference"]
            ):
                raise RuntimeError("Fixture identity changed before exact cleanup")
            self.docker(
                ["rm", "--force", actual_id],
                timeout=cleanup["dockerRemoveSeconds"],
            )
        remaining = self.docker(
            ["ps", "--all", "--quiet"],
            timeout=cleanup["dockerListSeconds"],
        ).decode().splitlines()
        return sorted(entry for entry in remaining if entry)


class Admission:
    def __init__(
        self,
        config: dict[str, Any],
        kernel: Kernel,
        record: Callable[[dict[str, Any]], None],
        clock: Callable[[], float] = time.monotonic,
        namespace: Callable[[], str] = lambda: os.readlink("/proc/self/ns/net"),
    ):
        self.config = config
        self.kernel = kernel
        self.record = record
        self.clock = clock
        self.namespace = namespace
        self.mode = config["network"]["baselineMode"]
        self.token: str | None = None
        self.started: float | None = None
        self.unit_id: str | None = None
        kernel.initialize()
        kernel.set_mode(self.mode)
        self.frozen = sha256(canonical(kernel.observe()))
        self.baseline_frozen = self.frozen

    def observe(self) -> dict[str, Any]:
        rules = self.kernel.observe()
        current = sha256(canonical(rules))
        if current != self.frozen:
            raise RuntimeError("Owned policy changed outside fixed admission")
        return {
            "verified": True,
            "mode": self.mode,
            "rulesSha256": current,
            "rules": rules,
            "parentPid": os.getpid(),
            "namespaceId": self.namespace(),
            "sourceSha256": self.config["sourceSha256"],
            "observedMonotonic": self.clock(),
        }

    def begin(self, mode: str, unit_id: str, transition: str) -> dict[str, Any]:
        if self.token is not None or self.mode != self.config["network"]["baselineMode"]:
            raise ValueError("Only one network admission may be active")
        self.observe()
        self.token = os.urandom(24).hex()
        self.started = self.clock()
        self.unit_id = unit_id
        try:
            self.kernel.set_mode(mode)
            self.mode = mode
            self.frozen = sha256(canonical(self.kernel.observe()))
        except Exception as error:
            try:
                self.kernel.set_mode(self.config["network"]["baselineMode"])
                self.mode = self.config["network"]["baselineMode"]
                self.frozen = sha256(canonical(self.kernel.observe()))
                if self.frozen != self.baseline_frozen:
                    raise RuntimeError("Failed admission rollback differs")
            except Exception as rollback:
                self.record({"transition": f"{transition}-rollback-failed", "error": str(error), "rollback": str(rollback)})
                raise RuntimeError("Admission failed and rollback is unverified") from rollback
            self.token = self.started = self.unit_id = None
            self.record({"transition": f"{transition}-rolled-back", "error": str(error), "rulesSha256": self.frozen})
            raise
        result = {**self.observe(), "token": self.token, "unitId": unit_id}
        if mode == self.config["network"]["distributedMode"]:
            result["allowedEndpoints"] = self.config["network"]["distributedEndpoints"]
        self.record({"transition": transition, **result})
        return result

    def end(self, token: Any, unit_id: Any, transition: str) -> dict[str, Any]:
        if self.token is None or token != self.token or unit_id != self.unit_id:
            raise ValueError("Exact active network lease required")
        guard_error = None
        try:
            self.observe()
            if self.started is None or (self.clock() - self.started) * 1000 > self.config["network"]["leaseMaximumMs"]:
                raise RuntimeError("Network lease exceeded configured bound")
        except Exception as error:
            guard_error = str(error)
        restored_token = self.token
        self.kernel.set_mode(self.config["network"]["baselineMode"])
        self.mode = self.config["network"]["baselineMode"]
        self.token = self.started = self.unit_id = None
        self.frozen = sha256(canonical(self.kernel.observe()))
        if self.frozen != self.baseline_frozen:
            guard_error = guard_error or "Original network policy was not restored"
        result = {**self.observe(), "restoredToken": restored_token, "guardFailure": guard_error}
        self.record({"transition": transition, **result})
        if guard_error:
            raise RuntimeError(guard_error)
        return result

    def request(self, request: Any) -> dict[str, Any]:
        allowed = {"op", "sourceSha256", "unitId", "token"}
        if not isinstance(request, dict) or set(request) - allowed:
            raise ValueError("Only fixed observation/admission fields accepted")
        if request.get("sourceSha256") != self.config["sourceSha256"]:
            raise ValueError("Source-bound admission identity differs")
        op = request.get("op")
        network = self.config["network"]
        if op == "observe":
            return self.observe()
        if op == "docker-observe":
            return {**self.observe(), "docker": self.kernel.docker_observe()}
        routes = {
            "repository-begin": ("begin", network["repositoryMode"], network["repositoryUnitId"]),
            "repository-end": ("end", network["repositoryMode"], network["repositoryUnitId"]),
            "distributed-begin": ("begin", network["distributedMode"], network["distributedUnitId"]),
            "distributed-end": ("end", network["distributedMode"], network["distributedUnitId"]),
        }
        route = routes.get(op)
        if route is None or request.get("unitId") != route[2]:
            raise ValueError("Unknown fixed proof operation")
        if route[0] == "begin":
            return self.begin(route[1], route[2], op)
        return self.end(request.get("token"), route[2], op)


def engine_command(config: dict[str, Any], request_sha256: str) -> list[str]:
    environment = {
        **config["engine"]["environment"],
        CONTAINED_REQUEST_SHA256_ENV: exact_digest(
            request_sha256, "contained request hash"
        ),
    }
    return [
        config["binaries"]["setpriv"],
        "--bounding-set=-all",
        "--inh-caps=-all",
        "--ambient-caps=-all",
        "--no-new-privs",
        "--",
        "/usr/bin/env",
        "-i",
        *(f"{key}={value}" for key, value in sorted(environment.items())),
        config["engine"]["executable"],
        *config["engine"]["arguments"],
    ]


def capability_free_client(pid: int) -> dict[str, Any]:
    fields = {}
    for line in Path(f"/proc/{pid}/status").read_text(encoding="utf-8").splitlines():
        name, separator, value = line.partition(":")
        if separator and name in {"CapEff", "CapBnd", "NoNewPrivs"}:
            fields[name] = value.strip()
    if fields != {
        "CapEff": "0000000000000000",
        "CapBnd": "0000000000000000",
        "NoNewPrivs": "1",
    }:
        raise ValueError("Proof client is not capability-free with no-new-privileges")
    return {
        "pid": pid,
        "capabilityEffectiveSet": fields["CapEff"],
        "capabilityBoundingSet": fields["CapBnd"],
        "noNewPrivileges": True,
    }


class ProofServer(threading.Thread):
    def __init__(self, server: socket.socket, admission: Admission, record: Callable[[dict[str, Any]], None]):
        super().__init__(name="mode3-proof-server", daemon=True)
        self.server = server
        self.admission = admission
        self.record = record
        self.stopping = threading.Event()
        self.failure: BaseException | None = None

    def run(self) -> None:
        try:
            self.server.settimeout(0.2)
            while not self.stopping.is_set():
                try:
                    connection, _ = self.server.accept()
                except TimeoutError:
                    continue
                with connection:
                    connection.settimeout(5)
                    pid, uid, _ = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    try:
                        if uid != 0:
                            raise ValueError("Capability-free uid0 observer required")
                        client = capability_free_client(pid)
                        data = b""
                        while not data.endswith(b"\n"):
                            chunk = connection.recv(4096)
                            if not chunk or len(data) + len(chunk) > SOCKET_LIMIT:
                                raise ValueError("Incomplete or oversized proof request")
                            data += chunk
                        result = {
                            **self.admission.request(json.loads(data)),
                            "clientProcess": client,
                        }
                        response = {"ok": True, "result": result}
                    except Exception as error:
                        self.record({"event": "request-failure", "peerPid": pid, "peerUid": uid, "error": str(error)})
                        response = {"ok": False, "error": str(error)}
                    try:
                        connection.sendall(canonical(response))
                    except (BrokenPipeError, ConnectionResetError):
                        pass
        except BaseException as error:
            self.failure = error

    def close(self, timeout_seconds: int) -> None:
        self.stopping.set()
        self.join(timeout=timeout_seconds)
        self.server.close()
        if self.is_alive():
            raise RuntimeError("Proof server did not stop")
        if self.failure:
            raise RuntimeError("Proof server failed") from self.failure


def wait_for_docker(config: dict[str, Any], kernel: Kernel) -> None:
    deadline = time.monotonic() + config["readinessTimeoutMs"] / 1000
    last_error: BaseException | None = None
    while time.monotonic() <= deadline:
        try:
            if Path(config["paths"]["dockerSocket"]).is_socket():
                kernel.docker(["info"], timeout=10)
                return
        except BaseException as error:
            last_error = error
        time.sleep(0.2)
    raise RuntimeError("Private Docker daemon did not become ready") from last_error


def stable_file_bytes(path_value: str, label: str) -> bytes:
    path = Path(exact_path(path_value, label))
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"{label} must be an ordinary file")
    before = path.stat()
    raw = path.read_bytes()
    after = path.stat()
    fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns")
    if any(getattr(before, field) != getattr(after, field) for field in fields):
        raise ValueError(f"{label} changed while it was read")
    return raw


def engine_request_path(config: dict[str, Any]) -> str:
    arguments = config["engine"]["arguments"]
    indexes = [index for index, value in enumerate(arguments) if value == "--request-file"]
    if len(indexes) != 1 or indexes[0] + 1 >= len(arguments):
        raise ValueError("Engine requires one contained request argument")
    return exact_path(arguments[indexes[0] + 1], "engine contained request path")


def verify_contained_request(path_value: str, expected_sha: str) -> bytes:
    raw = stable_file_bytes(path_value, "contained request")
    if sha256(raw) != exact_digest(expected_sha, "contained request hash"):
        raise ValueError("Read-only contained request changed")
    return raw


def serve(
    config_path: str,
    expected_sha: str,
    request_path_value: str,
    request_sha256: str,
) -> int:
    raw = Path(config_path).read_bytes()
    if sha256(raw) != exact_digest(expected_sha, "proof config hash"):
        raise ValueError("Read-only proof config changed")
    config = normalize_config(json.loads(raw))
    request_path = exact_path(request_path_value, "contained request path")
    if engine_request_path(config) != request_path:
        raise ValueError("Engine contained request path differs")
    verify_contained_request(request_path, request_sha256)
    if os.getuid() != 0:
        raise ValueError("Proof parent must run as uid 0")
    for path_name in ("stateRoot", "logRoot"):
        Path(config["paths"][path_name]).mkdir(mode=0o700, parents=True, exist_ok=True)
    log_path = Path(config["paths"]["logRoot"]) / "proof-parent-events.jsonl"
    log = log_path.open("xb", buffering=0)
    record_lock = threading.Lock()

    def record(value: dict[str, Any]) -> None:
        with record_lock:
            log.write(canonical(value))

    kernel = Kernel(config)
    admission = Admission(config, kernel, record)
    bridge_admission = kernel.verify_bridge_not_overlapping()
    socket_path = Path(config["paths"]["proofSocket"])
    if socket_path.exists():
        raise ValueError("Proof socket must be new")
    server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server_socket.bind(str(socket_path))
    os.chmod(socket_path, 0o600)
    server_socket.listen(4)
    server = ProofServer(server_socket, admission, record)
    server.start()
    record({"event": "ready", **admission.observe(), **bridge_admission})
    with Path(config["paths"]["helperReadyFile"]).open("xb") as ready:
        ready.write(canonical({**admission.observe(), **bridge_admission}))

    child: subprocess.Popen[bytes] | None = None
    fixture_created = False
    fixture_id: str | None = None
    cleanup_errors: list[str] = []
    uncertain_ids: list[str] = []
    child_status = 1
    interrupted = threading.Event()

    def stop_child(_signum: int, _frame: Any) -> None:
        interrupted.set()
        if child is not None and child.poll() is None:
            child.terminate()

    previous_term = signal.signal(signal.SIGTERM, stop_child)
    previous_int = signal.signal(signal.SIGINT, stop_child)
    try:
        wait_for_docker(config, kernel)
        kernel.reconcile_docker_hooks()
        if sha256(canonical(kernel.observe())) != admission.baseline_frozen:
            raise RuntimeError("Docker hook reconciliation changed baseline policy")
        record({"event": "docker-hooks-ready", **admission.observe()})
        fixture_created = True
        fixture_proof = kernel.create_fixture()
        fixture_id = fixture_proof["fixtureId"]
        if not isinstance(fixture_id, str) or not fixture_id:
            raise RuntimeError("Fixture ID is absent")
        record({"event": "fixture-created", **fixture_proof})
        stdout_path = Path(config["paths"]["logRoot"]) / "engine.stdout.log"
        stderr_path = Path(config["paths"]["logRoot"]) / "engine.stderr.log"
        with stdout_path.open("xb") as stdout, stderr_path.open("xb") as stderr:
            verify_contained_request(request_path, request_sha256)
            child = subprocess.Popen(
                engine_command(config, request_sha256),
                cwd=config["engine"]["workingDirectory"],
                env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin"},
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
            )
            child_status = child.wait()
        if interrupted.is_set() and child_status == 0:
            child_status = 143
        if server.failure:
            raise RuntimeError("Proof server failed while engine was running") from server.failure
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        signal.signal(signal.SIGINT, previous_int)
        if child is not None and child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=config["cleanup"]["engineTerminateSeconds"])
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=config["cleanup"]["engineKillSeconds"])
                cleanup_errors.append("engine child required SIGKILL")
        if admission.token is not None:
            try:
                admission.end(admission.token, admission.unit_id, "terminal-restoration")
            except Exception as error:
                cleanup_errors.append(f"network restoration: {error}")
        try:
            observed = admission.observe()
            if observed["rulesSha256"] != admission.baseline_frozen:
                raise RuntimeError("terminal baseline differs")
            record({"event": "terminal-network", **observed})
        except Exception as error:
            cleanup_errors.append(f"network observation: {error}")
        if fixture_created:
            try:
                uncertain_ids = kernel.cleanup_fixture(fixture_id)
                record(
                    {
                        "event": "fixture-cleanup",
                        "fixtureId": fixture_id,
                        "uncertainIds": uncertain_ids,
                    }
                )
            except Exception as error:
                cleanup_errors.append(f"fixture cleanup: {error}")
                uncertain_ids = [config["dockerFixture"]["name"]]
        try:
            server.close(config["cleanup"]["proofServerStopSeconds"])
            record({"event": "proof-server-stopped"})
        except Exception as error:
            cleanup_errors.append(f"proof server cleanup: {error}")
        log.close()
        cleanup = {
            "schema": config["cleanup"]["schema"],
            "cleanupVerified": child_status == 0 and not cleanup_errors and not uncertain_ids,
            "childExitCode": child_status,
            "networkRestored": not any(error.startswith("network ") for error in cleanup_errors),
            "proofServerStopped": not any(error.startswith("proof server ") for error in cleanup_errors),
            "resultReuse": False,
            "uncertainIds": uncertain_ids,
            "errors": cleanup_errors,
        }
        with Path(config["paths"]["cleanupArtifact"]).open("xb") as output:
            output.write(canonical(cleanup))
    return child_status if child_status != 0 else (0 if not cleanup_errors and not uncertain_ids else 1)


def request_proof(socket_path: str, expected_parent_pid: int) -> int:
    path_value = exact_path(socket_path, "proof socket")
    parent_pid = positive_integer(expected_parent_pid, "proof parent PID", 2**31 - 1)
    request = sys.stdin.buffer.read(SOCKET_LIMIT + 1)
    if not request.endswith(b"\n") or len(request) > SOCKET_LIMIT:
        raise ValueError("Proof request is incomplete or oversized")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(10)
    connection.connect(path_value)
    pid, uid, _ = struct.unpack(
        "3i",
        connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12),
    )
    if pid != parent_pid or uid != 0:
        raise ValueError("Proof socket peer differs from the reviewed parent")
    connection.sendall(request)
    connection.shutdown(socket.SHUT_WR)
    response = b""
    while not response.endswith(b"\n"):
        chunk = connection.recv(4096)
        if not chunk or len(response) + len(chunk) > 1_048_576:
            raise ValueError("Proof response is incomplete or oversized")
        response += chunk
    connection.close()
    value = json.loads(response)
    if not isinstance(value, dict) or value.get("ok") is not True or not isinstance(value.get("result"), dict):
        message = value.get("error") if isinstance(value, dict) else None
        raise RuntimeError(
            f"Proof parent rejected request: {message}"
            if isinstance(message, str)
            else "Proof parent rejected request"
        )
    sys.stdout.buffer.write(canonical(value["result"]))
    return 0


def main(argv: list[str]) -> int:
    if len(argv) == 4 and argv[1] == "client":
        return request_proof(argv[2], int(argv[3]))
    if len(argv) != 5:
        raise SystemExit(
            "usage: mode3-proof-parent.py <config.json> <sha256> "
            "<contained-request.json> <request-sha256>"
        )
    return serve(argv[1], argv[2], argv[3], argv[4])


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
