"""Fail if the assumptions behind dependency advisory mitigations change."""
import json
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
meta = json.loads(subprocess.check_output([
    "cargo", "metadata", "--format-version", "1", "--locked"
], cwd=root))
packages = {p["id"]: p for p in meta["packages"]}
for node in meta["resolve"]["nodes"]:
    pkg = packages[node["id"]]
    if pkg["name"] == "rand" and pkg["version"].startswith("0.7."):
        assert "log" not in node["features"], "Reevaluate RUSTSEC-2026-0097: rand 0.7 log enabled"
    if pkg["name"] == "glib" and pkg["version"] == "0.18.5":
        assert pathlib.Path(pkg["manifest_path"]).resolve() == root / "vendor/glib/Cargo.toml"
source = (root / "vendor/glib/src/variant_iter.rs").read_text()
assert "let mut p: *mut libc::c_char" in source
assert "                &mut p," in source
print("Dependency mitigation checks passed")
