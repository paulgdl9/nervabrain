import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("AI bridge preserves explicit provider order and sends Codex its selected model", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "assert module.normalize_engine_order([]) == ()",
    "assert module.normalize_engine_order(['codex', 'claude', 'codex']) == ('codex', 'claude')",
    "seen = []",
    "module.ENGINE_MIN_SECONDS = 0",
    "module.run_codex_text = lambda prompt, model='', timeout=0: seen.append(model) or 'ok'",
    "assert module.run_engine('prompt', {'codex': 'gpt-5.5'}, 5, ['codex']) == ('ok', 'codex')",
    "assert seen == ['gpt-5.5']",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("AI verification without a selected model uses the provider default", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.CLAUDE_BIN = '/bin/true'",
    "seen = []",
    "module.run_verify_probe = lambda engine, model, timeout=45: (seen.append((engine, model)), (True, '', ''))[1]",
    "handler = object.__new__(module.H)",
    "handler._read_json = lambda: {'engine': 'claude', 'model': ''}",
    "handler._send = lambda code, payload: (code, payload)",
    "code, payload = module.H.handle_verify(handler)",
    "assert code == 200 and payload['ok'] is True",
    "assert payload['model'] == 'default'",
    "assert seen == [('claude', '')]",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("a failed verify surfaces a quota/auth reason instead of a bare false", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "assert module.classify_verify_failure('Error: rate limit exceeded, quota reached') == 'quota'",
    "assert module.classify_verify_failure('401 Unauthorized: please log in again') == 'auth'",
    "assert module.classify_verify_failure('some unrelated failure') == 'unknown'",
    "module.CLAUDE_BIN = '/bin/true'",
    "module.run_verify_probe = lambda engine, model, timeout=45: (False, 'quota', 'rate limit exceeded')",
    "handler = object.__new__(module.H)",
    "handler._read_json = lambda: {'engine': 'claude', 'model': ''}",
    "handler._send = lambda code, payload: (code, payload)",
    "code, payload = module.H.handle_verify(handler)",
    "assert code == 502 and payload['ok'] is False",
    "assert payload['reason'] == 'quota'",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("bridge exposes only liveness publicly and protects provider status", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.TOKEN = 'secret'",
    "handler = object.__new__(module.H)",
    "handler._send = lambda code, payload: (code, payload)",
    "handler.path = '/health'",
    "handler.headers = {}",
    "code, payload = module.H.do_GET(handler)",
    "assert code == 200 and payload == {'ok': True, 'status': 'healthy'}",
    "handler.path = '/status'",
    "code, payload = module.H.do_GET(handler)",
    "assert code == 401 and payload['error'] == 'unauthorized'",
    "module.refresh_executables = lambda: None",
    "module.CLAUDE_BIN, module.CODEX_BIN = '/bin/true', ''",
    "module.auth_summary = lambda: {'claude': {'configured': True, 'method': 'cli'}, 'codex': {'configured': False, 'method': 'cli'}}",
    "module.model_catalog = lambda auth: {'claude': [{'id': 'sonnet', 'label': 'Claude Sonnet'}], 'codex': []}",
    "handler.headers = {'Authorization': 'Bearer secret'}",
    "code, payload = module.H.do_GET(handler)",
    "assert code == 200 and payload['engines']['claude'] is True",
    "assert payload['models']['claude'][0]['id'] == 'sonnet'",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("bridge resolves relative credential paths inside the repository data directory", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "assert module.resolve_ai_credentials_file('data/private/providers.env') == module.PROJECT_ROOT / 'data' / 'private' / 'providers.env'",
    "assert module.resolve_ai_credentials_file('../outside.env') == module.PROJECT_ROOT / 'data' / 'ai-credentials.env'",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
