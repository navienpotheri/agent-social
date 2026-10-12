// The Docker sandbox backend (any host with Docker): the agent runs in a container on an internal network; a relay container is its only way out.
// Needs Docker running and the python:3.13-alpine image (docker pull python:3.13-alpine). No model, no key.
import { spawnSync } from "node:child_process";
import { skip } from "./lib/common.mjs";
import { sandboxEval } from "./lib/sandbox-eval.mjs";

const NAME = "sandbox-docker";
if (spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" }).status !== 0) skip(NAME, "Docker is not available (is Docker Desktop running?)");
const image = process.env.ASP_EVAL_SANDBOX_IMAGE ?? "python:3.13-alpine";
if (spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status !== 0) skip(NAME, `the image ${image} is not pulled (docker pull ${image})`);
await sandboxEval(NAME, "docker", (agent) => ["python", `/work/${agent}`], ["--sandbox-image", image]);
