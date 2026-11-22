// Adversarial review (before the live run): path forms that name a place outside the project folder on Windows. Each tool call below must be refused by the confinement reading; an ordinary path inside the project
// must not. Stated limit (not tested as a refusal): a directory junction or symbolic link INSIDE the project that points outside is followed by the operating system, not by this reading (register row BM21).
import { test } from "node:test";
import assert from "node:assert/strict";
import { confinementRefusal } from "../src/gateway/paths.ts";

const c = { root: "C:\\Users\\me\\proj", home: "C:\\Users\\me" };
const tool = (path: string) => confinementRefusal({ path }, undefined, c);
const shell = (cmd: string) => confinementRefusal({}, cmd, c);

const OUTSIDE = [
  "C:\\Users\\me\\.ssh\\id_rsa",
  "C:\\Users\\me\\proj\\..\\.ssh\\id_rsa",
  "C:\\Users\\me\\proj\\..\\..\\Windows\\System32\\config\\SAM",
  "c:/users/me/proj/../.aws/credentials",
  "\\\\?\\C:\\Users\\me\\.ssh\\id_rsa",
  "\\\\.\\C:\\Users\\me\\.ssh\\id_rsa",
  "\\??\\C:\\Users\\me\\.ssh\\id_rsa",
  "\\\\server\\share\\secrets.txt",
  "//server/share/secrets.txt",
  "\\\\?\\UNC\\server\\share\\secrets.txt",
  "C:\\Users\\me\\proj\\..\\.ssh\\id_rsa::$DATA",
  "C:\\Users\\me\\proj\\..\\.ssh\\id_rsa:stream",
  "C:\\Users\\me\\proj.\\..\\.ssh\\id_rsa",
  "C:\\Users\\me\\proj\\.. \\.ssh\\id_rsa",
  "%USERPROFILE%\\.ssh\\id_rsa",
  "%APPDATA%\\npm\\.npmrc",
  "~\\.ssh\\id_rsa",
  "C:\\Users\\me\\proj\\sub\\..\\..\\.ssh\\id_rsa",
  "D:\\data\\x.txt",
];
const INSIDE = ["src\\a.ts", ".\\src\\a.ts", "C:\\Users\\me\\proj\\src\\a.ts", "c:/users/me/proj/src/a.ts", "\\\\?\\C:\\Users\\me\\proj\\src\\a.ts", "src/../src/a.ts", "README.md"];

test("a path that names a place outside the project, however it is spelled, is refused for a tool call", () => {
  const missed = OUTSIDE.filter((p) => !tool(p));
  assert.deepEqual(missed, []);
});

test("the same places are refused when a shell command reads them", () => {
  const missed = OUTSIDE.filter((p) => !(shell(`type "${p}"`) ?? shell(`cat ${p}`)));
  assert.deepEqual(missed, []);
});

test("a path inside the project is not refused, in any of its spellings", () => {
  const wrong = INSIDE.filter((p) => tool(p) !== undefined);
  assert.deepEqual(wrong, []);
});
