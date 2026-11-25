"""Tests for replay.py with a fake model and tokenizer: no GPU, no download, no torch (rows ENG83, ENG97)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import replay  # noqa: E402


class FakeTokenizer:
    def __init__(self) -> None:
        self.seen = None

    def apply_chat_template(self, messages, tools=None, add_generation_prompt=False, tokenize=True, return_tensors=None):
        self.seen = {"messages": messages, "tools": tools, "gen": add_generation_prompt}
        return [[1, 2, 3, 4, 5]]


class FakeModel:
    """A looped model: block 'mid' runs three times in a forward pass, 'first' once; its router reports expert ids on each mid pass."""

    def __init__(self, book: replay.HookBook) -> None:
        self.book = book
        self.hooks = {}

    def __call__(self, ids):
        h = self.book
        for name, times in (("first", 1), ("mid", 3), ("last", 1)):
            for p in range(times):
                self.hooks[name](None, None, [float(p), float(len(ids[0]))])
        for p in range(3):
            self.hooks["mid.router"](None, None, [p, p + 1])


class ReplayTests(unittest.TestCase):
    def test_request_becomes_chat_messages_and_tools(self):
        req = {"system": [{"type": "text", "text": "You are a citizen."}], "messages": [{"role": "user", "content": "You arrive."}, {"role": "assistant", "content": [{"type": "tool_use", "name": "look_map", "input": {}}]}, {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t", "content": "A square."}]}], "tools": [{"name": "look_map", "description": "d", "input_schema": {"type": "object"}}]}
        m = replay.chat_messages(req)
        self.assertEqual(m[0], {"role": "system", "content": "You are a citizen."})
        self.assertEqual([x["role"] for x in m], ["system", "user", "assistant", "user"])
        self.assertIn("look_map", m[2]["content"]); self.assertEqual(m[3]["content"], "A square.")
        tok = FakeTokenizer(); replay.build_input(tok, req)
        self.assertTrue(tok.seen["gen"]); self.assertEqual(tok.seen["tools"][0]["function"]["name"], "look_map")

    def test_a_looped_module_is_tagged_by_pass_and_nothing_is_overwritten(self):
        book = replay.HookBook(layers=["first", "mid", "last"]); model = FakeModel(book)
        last = lambda out: out
        for n in ("first", "mid", "last"):
            model.hooks[n] = book.hook_for(n, last)
        model.hooks["mid.router"] = book.hook_for("mid.router", lambda o: o, is_router=True)
        out = replay.replay_turn(model, FakeTokenizer(), replay.Adapter(), {"messages": [], "tools": []}, book, [])
        self.assertEqual(book.passes("mid"), 3); self.assertEqual(book.passes("first"), 1)
        self.assertEqual(sorted(k for k in out["layers"] if k.startswith("mid")), ["mid#pass0", "mid#pass1", "mid#pass2"])
        self.assertEqual(out["experts"]["mid.router#pass2"], [2, 3])
        self.assertEqual(out["prompt_tokens"], None)  # a list, not a tensor: only a tensor has a shape
        out2 = replay.replay_turn(model, FakeTokenizer(), replay.Adapter(), {"messages": [], "tools": []}, book, [])
        self.assertEqual(book.passes("mid"), 3, "the counter restarts for each forward pass")

    def test_labels_are_joined_by_agent_and_turn(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "trace.jsonl")
            with open(p, "w", encoding="utf-8") as f:
                for e in ({"t": "tool", "agent": "a1", "turn": 3, "tool": "field_answer", "ok": True}, {"t": "tool", "agent": "a1", "turn": 4, "tool": "offer_on_job", "ok": False, "refused": "market_refused"}, {"t": "seen", "agent": "a1", "turn": 3, "kind": "fog"}, {"t": "end", "agent": "a1"}):
                    f.write(json.dumps(e) + "\n")
            lab = replay.labels_from_trace(p)
            self.assertIn("card_read", lab[("a1", 3)]); self.assertIn("seen:fog", lab[("a1", 3)]); self.assertIn("refused:market_refused", lab[("a1", 4)])

    def test_turns_load_and_shards_have_an_index(self):
        with tempfile.TemporaryDirectory() as d:
            t = os.path.join(d, "turns.jsonl")
            with open(t, "w", encoding="utf-8") as f:
                f.write(json.dumps({"turn": 1, "request": {"messages": []}, "reply": {}}) + "\n\n")
            self.assertEqual(len(replay.load_turns(t)), 1)
            ix = os.path.join(d, "index.jsonl")
            n = replay.write_shard(os.path.join(d, "s0.jsonl"), ix, [{"agent": "a1", "turn": 1, "labels": ["card_read"], "vectors": {"mid#pass0": [0.1, 0.2]}}])
            self.assertEqual(n, 1)
            row = json.loads(open(ix, encoding="utf-8").read().splitlines()[0])
            self.assertEqual((row["agent"], row["turn"], row["shard"], row["row"]), ("a1", 1, "s0.jsonl", 0)); self.assertNotIn("vectors", row)

    def test_selftest_without_torch_says_so(self):
        try:
            import torch  # noqa: F401
            self.skipTest("torch is installed: the selftest would try the real model")
        except ImportError:
            self.assertEqual(replay.main(["--selftest"]), 2)


if __name__ == "__main__":
    unittest.main()
