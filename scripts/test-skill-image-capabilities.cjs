const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { requiredImageFeatures, runtimeSupportsImageFeatures } = require("../skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs").__test;

test("旧 CLI 即使支持共享配置也不能执行新 skill 的绘图命令", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-26-runtime-"));
  try {
    const mock = path.join(dir, "runtime.cjs");
    fs.writeFileSync(mock, `process.stdout.write(JSON.stringify({ok:true,providers:{openai:{supports:['background','size','format']}}}));`);
    const runtime = { argvPrefix: [process.execPath, mock], cwd: null };
    const required = requiredImageFeatures(["--json", "--provider", "openai", "images", "generate", "--prompt", "test"]);
    assert.equal(runtimeSupportsImageFeatures(runtime, required), false);
    assert.equal(runtimeSupportsImageFeatures(runtime, requiredImageFeatures(["--json", "doctor"])), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("完整的 2.6 运行时可以执行编辑和透明源图生成", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-26-runtime-"));
  try {
    const mock = path.join(dir, "runtime.cjs");
    fs.writeFileSync(mock, `process.stdout.write(JSON.stringify({ok:true,providers:{openai:{supports:['complexity','markup','frame_count','svg']}}}));`);
    const runtime = { argvPrefix: [process.execPath, mock], cwd: null };
    for (const command of [["images", "edit"], ["transparent", "generate"]]) {
      assert.equal(runtimeSupportsImageFeatures(runtime, requiredImageFeatures(command)), true);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("能力探测失败时不继续绘图，普通本地透明验证不受影响", () => {
  const runtime = { argvPrefix: [process.execPath, "-e", "process.stdout.write('not JSON')"], cwd: null };
  assert.equal(runtimeSupportsImageFeatures(runtime, requiredImageFeatures(["images", "generate"])), false);
  assert.equal(runtimeSupportsImageFeatures(runtime, requiredImageFeatures(["transparent", "verify", "--input", "local.png"])), true);
});

test("显式旧模型和 Codex 命令保留兼容性，新参数仍须能力探测", () => {
  assert.deepEqual(requiredImageFeatures(["--provider", "codex", "images", "generate"]), []);
  assert.deepEqual(requiredImageFeatures(["images", "generate", "--model", "gpt-image-2"]), []);
  assert.deepEqual(requiredImageFeatures(["images", "generate", "-m", "gpt-image-2.5-flare"]), []);
  assert.deepEqual(requiredImageFeatures(["--provider=codex", "images", "generate", "--format=gif"]), ["frame_count"]);
  assert.ok(requiredImageFeatures(["images", "generate", "--model=gpt-image-2.6-flare"]).includes("complexity"));
});
