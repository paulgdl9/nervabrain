import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("chat endpoint grounds the reply in evidence and caps history to the last 12 turns", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "captured = {}",
    "def fake_run_engine(prompt, models, budget, engine_order=None, effort=''):",
    "    captured['prompt'] = prompt",
    "    return 'Reponse test', 'claude'",
    "module.run_engine = fake_run_engine",
    "history = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': 'turn-%d' % i} for i in range(15)]",
    "handler = object.__new__(module.H)",
    "handler._read_json = lambda: {",
    "    'question': 'Quelle est ma priorite aujourd\\'hui ?',",
    "    'system_context': 'CONTEXTE-SYSTEME-MARQUEUR',",
    "    'history': history,",
    "    'evidence': {},",
    "}",
    "handler._send = lambda code, payload: (code, payload)",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200, payload",
    "assert payload['ok'] is True",
    "assert payload['reply'] == 'Reponse test'",
    "prompt = captured['prompt']",
    "assert 'Quelle est ma priorite' in prompt",
    "assert 'turn-14' in prompt",
    "assert 'turn-0' not in prompt",
    "assert 'CONTEXTE-SYSTEME-MARQUEUR' in prompt",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("chat endpoint rejects an empty question", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "handler = object.__new__(module.H)",
    "handler._read_json = lambda: {'question': '   ', 'system_context': 'ctx'}",
    "handler._send = lambda code, payload: (code, payload)",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 422 and payload['ok'] is False",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("chat returns vault edits only for an explicitly authorized turn", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "captured = {}",
    "def fake_run_engine(prompt, *args, **kwargs):",
    "    captured['prompt'] = prompt",
    "    return 'Fait.\\n```vault_edits\\n[{\"path\":\"08-Projects/Training/plan-data.json\",\"content\":\"{}\"}]\\n```', 'claude'",
    "module.run_engine = fake_run_engine",
    "handler = object.__new__(module.H)",
    "handler._send = lambda code, payload: (code, payload)",
    "handler._read_json = lambda: {'question': 'Mets le plan à jour', 'system_context': 'ctx', 'allow_edits': True}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200 and payload['reply'].strip() == 'Fait.'",
    "assert payload['edits'][0]['path'] == '08-Projects/Training/plan-data.json'",
    "assert 'sole source of truth rendered by /trail' in captured['prompt']",
    "assert 'also update every affected open task in 05-Tasks' in captured['prompt']",
    "handler._read_json = lambda: {'question': 'Résume le plan', 'system_context': 'ctx'}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200 and payload['edits'] == []",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("chat endpoint forwards claude-only and codex-only efforts, drops an invalid one", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "captured = {}",
    "def fake_run_engine(prompt, models, budget, engine_order=None, effort=''):",
    "    captured['effort'] = effort",
    "    return 'Reponse test', 'claude'",
    "module.run_engine = fake_run_engine",
    "handler = object.__new__(module.H)",
    "handler._send = lambda code, payload: (code, payload)",
    "handler._read_json = lambda: {'question': 'Q', 'system_context': 'ctx', 'effort': 'high'}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200, payload",
    "assert captured['effort'] == 'high', captured",
    "handler._read_json = lambda: {'question': 'Q', 'system_context': 'ctx', 'effort': 'max'}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200, payload",
    "assert captured['effort'] == 'max', captured",
    "handler._read_json = lambda: {'question': 'Q', 'system_context': 'ctx', 'effort': 'xhigh'}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200, payload",
    "assert captured['effort'] == 'xhigh', captured",
    "handler._read_json = lambda: {'question': 'Q', 'system_context': 'ctx', 'effort': 'extreme'}",
    "code, payload = module.H.handle_chat(handler)",
    "assert code == 200, payload",
    "assert captured['effort'] == '', captured",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("run_claude_text inserts --effort for every claude-supported value, including max", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.CLAUDE_BIN = '/fake/claude'",
    "captured = {}",
    "class FakeResult:",
    "    returncode = 0",
    "    stdout = 'ok'",
    "def fake_run(command, **kwargs):",
    "    captured['command'] = command",
    "    return FakeResult()",
    "module.subprocess.run = fake_run",
    "module.run_claude_text('p', effort='high')",
    "command = captured['command']",
    "assert '--effort' in command, command",
    "assert command[command.index('--effort') + 1] == 'high', command",
    "module.run_claude_text('p', effort='max')",
    "command = captured['command']",
    "assert '--effort' in command, command",
    "assert command[command.index('--effort') + 1] == 'max', command",
    "module.run_claude_text('p', effort='')",
    "command = captured['command']",
    "assert '--effort' not in command, command",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("run_codex_text omits the reasoning flag for claude-only efforts like max, sets it for xhigh", () => {
  const bridge = JSON.stringify(path.join(process.cwd(), "bridge", "memo-bridge.py"));
  const script = [
    "import importlib.util",
    "import tempfile",
    `spec = importlib.util.spec_from_file_location("memo_bridge", ${bridge})`,
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "module.CODEX_BIN = '/fake/codex'",
    "captured = {}",
    "class FakeResult:",
    "    returncode = 0",
    "def fake_run(command, **kwargs):",
    "    captured['command'] = command",
    "    out_path = command[command.index('-o') + 1]",
    "    with open(out_path, 'w', encoding='utf-8') as fh:",
    "        fh.write('ok')",
    "    return FakeResult()",
    "module.subprocess.run = fake_run",
    "module.run_codex_text('p', effort='max')",
    "command = captured['command']",
    "assert 'model_reasoning_effort' not in ' '.join(command), command",
    "module.run_codex_text('p', effort='xhigh')",
    "command = captured['command']",
    "assert any('model_reasoning_effort=\"xhigh\"' in part for part in command), command",
  ].join("\n");
  const result = spawnSync("python3", ["-c", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
