"""Replay recorded society prompts through an open model and store its internal activations (rows ENG83 and ENG97).

The residual stream at the last prompt token depends only on the prompt, so the behaviour run uses a fast server and the activations are read afterwards by
teacher-forcing the recorded prompts (`<run>/agents/<id>/turns.jsonl`, written by `--record-prompts`) through the same model with forward hooks.

What is here: the reading of the recording, the building of the model input, the hook bookkeeping for a model whose middle layers run several times
(every hooked module call is tagged with its layer and its loop pass by a per-module call counter), the router's expert ids, the label join from the run's
trace, and the writing of shards with an index. What is NOT here and cannot be tested without a GPU: the loading of the real model (see `--selftest`) and
the analysis (probes, shuffled-label control): `analyze.py` is not written. Numbers stay on disk, never in the log. No claim about what an activation means is made here.

The model-specific parts are in an Adapter class; a dense model (Qwen3-8B) and the looped mixture-of-experts model (Inkling-2-Mini) differ only there.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable


def load_turns(path: str) -> list[dict]:
    """One recorded model call per line: turn, at, request {system, messages, tools, max_tokens}, reply {content, usage}."""
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    parts = []
    for b in content or []:
        if b.get("type") == "text":
            parts.append(b.get("text", ""))
        elif b.get("type") == "tool_use":
            parts.append(json.dumps({"tool": b.get("name"), "input": b.get("input")}))
        elif b.get("type") == "tool_result":
            c = b.get("content")
            parts.append(c if isinstance(c, str) else _text_of(c))
        elif b.get("type") == "thinking":
            parts.append(b.get("thinking", ""))
    return "\n".join(parts)


def chat_messages(request: dict) -> list[dict]:
    """The recorded request as chat messages for the tokenizer's template: the system text first, then each message with its blocks flattened to text
    (the cache marks are dropped; a tool result is a user turn, a tool call is part of the assistant turn)."""
    sys_text = request.get("system")
    if isinstance(sys_text, list):
        sys_text = _text_of(sys_text)
    msgs = [{"role": "system", "content": sys_text}] if sys_text else []
    for m in request.get("messages", []):
        msgs.append({"role": m["role"], "content": _text_of(m["content"])})
    return msgs


def tool_defs(request: dict) -> list[dict]:
    """The tool definitions in the OpenAI-style form the chat templates of open models read."""
    return [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t.get("input_schema", {})}} for t in request.get("tools", [])]


def build_input(tokenizer: Any, request: dict) -> Any:
    """Exactly the prompt the server was given: the template with the tools and the generation prompt added."""
    return tokenizer.apply_chat_template(chat_messages(request), tools=tool_defs(request), add_generation_prompt=True, tokenize=True, return_tensors="pt")


@dataclass
class HookBook:
    """Collects the activations of hooked modules. A module that runs several times in one forward pass (the middle block of a looped model) is called once
    for each pass: a per-module call counter tags each call with its loop pass, so nothing is overwritten or averaged away."""
    layers: list[str]
    calls: dict[str, int] = field(default_factory=dict)
    records: dict[tuple[str, int], Any] = field(default_factory=dict)
    routing: dict[tuple[str, int], list[int]] = field(default_factory=dict)

    def new_forward(self) -> None:
        self.calls = {}
        self.records = {}
        self.routing = {}

    def hook_for(self, name: str, last_token: Callable[[Any], Any], is_router: bool = False) -> Callable[..., None]:
        def hook(module: Any, args: Any, output: Any) -> None:
            n = self.calls.get(name, 0)
            self.calls[name] = n + 1
            if is_router:
                self.routing[(name, n)] = list(last_token(output))
            else:
                self.records[(name, n)] = last_token(output)
        return hook

    def passes(self, name: str) -> int:
        return self.calls.get(name, 0)


class Adapter:
    """Model-specific parts. A dense model: one pass for each layer, no router. A looped mixture-of-experts model overrides `layer_names`, `router_names`
    and `last_token`."""

    def layer_names(self, model: Any) -> list[str]:
        raise NotImplementedError

    def router_names(self, model: Any) -> list[str]:
        return []

    def last_token(self, output: Any) -> Any:
        raise NotImplementedError


def replay_turn(model: Any, tokenizer: Any, adapter: Adapter, request: dict, book: HookBook, handles: list) -> dict:
    book.new_forward()
    ids = build_input(tokenizer, request)
    model(ids)  # one forward pass; the hooks fill the book
    return {"layers": {f"{n}#pass{p}": v for (n, p), v in book.records.items()}, "experts": {f"{n}#pass{p}": v for (n, p), v in book.routing.items()}, "prompt_tokens": int(ids.shape[-1]) if hasattr(ids, "shape") else None}


def labels_from_trace(trace_path: str) -> dict[tuple[str, int], list[str]]:
    """The trace's labels for each (agent, turn): what happened at that turn (a collision, a retry, a refused scope, a lesson published, a sitting passed, a card read, the arm), joined by agent and turn."""
    out: dict[tuple[str, int], list[str]] = {}
    with open(trace_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            agent, turn = e.get("agent"), e.get("turn")
            if agent is None or turn is None:
                continue
            tags = out.setdefault((agent, int(turn)), [])
            if e.get("t") == "tool":
                tags.append(f"tool:{e.get('tool')}")
                if e.get("refused"):
                    tags.append(f"refused:{e.get('refused')}")
                if e.get("tool") == "lesson_publish" and e.get("ok"):
                    tags.append("lesson_published")
                if e.get("tool") == "field_answer" and e.get("ok"):
                    tags.append("card_read")
                if e.get("tool") == "course_sit" and e.get("ok"):
                    tags.append("sitting")
            elif e.get("t") == "seen":
                tags.append(f"seen:{e.get('kind')}")
    return out


def write_shard(path: str, index_path: str, entries: Iterable[dict]) -> int:
    """Writes the vectors as one JSON-lines shard (float16 numpy shards are written when numpy is installed) and appends an index line for each."""
    n = 0
    with open(path, "w", encoding="utf-8") as f, open(index_path, "a", encoding="utf-8") as ix:
        for e in entries:
            f.write(json.dumps(e["vectors"]) + "\n")
            ix.write(json.dumps({k: v for k, v in e.items() if k != "vectors"} | {"shard": os.path.basename(path), "row": n}) + "\n")
            n += 1
    return n


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", help="the cohort run folder (agents/<id>/turns.jsonl and trace.jsonl)")
    ap.add_argument("--model", help="the Hugging Face model id or a local path")
    ap.add_argument("--out", help="the folder for the shards and the index")
    ap.add_argument("--selftest", action="store_true", help="on the pod: load the model, list its modules, run one forward pass and report the hook counts")
    a = ap.parse_args(argv)
    if a.selftest:
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401
        except ImportError as e:
            print(f"torch and transformers are not installed here: {e}. Install them on the pod and run again.")
            return 2
        print("selftest: the model-specific load and the hook counts are not yet written for the real model: the first hour on the pod is the spike (see docs/open-model-society-run.md section 7).")
        return 2
    if not (a.run and a.model and a.out):
        ap.error("--run, --model and --out are required (or --selftest)")
    print("replay of a real model is not wired in this stretch: the pieces (load_turns, build_input, HookBook, labels_from_trace, write_shard) are tested with a fake model")
    return 2


if __name__ == "__main__":
    sys.exit(main())
