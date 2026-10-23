# Dependency advisory remediation — 2026-09-13

## 2026-10-01 更新

- rustls 升级到 0.23.45，修复 RUSTSEC-2026-0285；rustls-webpki 同步到 0.103.15。
- Wrangler 升级到 4.145.0，其依赖 undici 7.29.1 修复 GHSA-w293-vg96-wgc3。原 Dependabot 候选 Wrangler 4.139.0 仍包含受影响版本，因此使用更新的补丁链。
- Workers 类型同步到 5.20261001.1；relay 类型检查、19 项测试和部署 dry-run 均通过。
- 已核对 workerd 1.20260930.2 的安装脚本：选择当前平台的 Cloudflare 二进制，必要时从 npm 获取同一精确版本，并检查二进制版本。仅将该精确版本加入 allowScripts，未扩大脚本授权范围。

漏洞来源：[RustSec](https://rustsec.org/advisories/RUSTSEC-2026-0285.html)、[GitHub Advisory](https://github.com/advisories/GHSA-w293-vg96-wgc3)。

- Vitest and @vitest/mocker: update both npm workspaces to patched 4.1.11 or later.
- sharp/libheif: update Wrangler dependency graph to sharp 0.35.4.
- anyhow RUSTSEC-2026-0190 and event-listener RUSTSEC-2026-0221: update to patched versions (>=1.0.103 and >=5.4.2).
- chacha20: replace the yanked 0.10.1 release with the current compatible patch.
- fflate ZIP64 denial of service: update to 0.8.3.
- glib GHSA-wrw7-89jp-8q8g: source backport in vendor/glib; see its SECURITY-BACKPORT.md. Workspace patch applies to the shipped Tauri application. Publishing a library to crates.io does not propagate workspace patches to consumers; the published CLI/core/web crates do not depend on glib.
- rand RUSTSEC-2026-0097: rand 0.8 is already 0.8.6; remaining 0.7.3 is a build dependency of phf_generator through Tauri utilities. The required log feature is disabled. CI checks the complete resolved feature graph and fails if it becomes enabled. This is a checked non-applicability assessment, not a claim that rand 0.7.3 itself is patched.

GitHub version-based alerts can remain for vendored glib or rand despite these mitigations. Do not dismiss without rechecking the guard and patched-source tests.
