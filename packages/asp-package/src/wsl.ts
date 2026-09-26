/** Helpers for runtimes that live in WSL when asp runs on Windows (OpenHands). */
import { spawnSync } from "node:child_process";

export const onWindows = process.platform === "win32";

/** A Windows path as WSL sees it: C:\a\b → /mnt/c/a/b, \\wsl.localhost\Distro\x → /x. Other paths pass through. */
export function toWslPath(p: string): string {
  const unc = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i.exec(p);
  if (unc) return (unc[1] ?? "/").replace(/\\/g, "/");
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(p);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`.replace(/\/$/, "");
  return p.replace(/\\/g, "/");
}

/** `wsl.exe` arguments selecting the distro: $ASP_WSL_DISTRO, or WSL's default. */
export function wslDistroArgs(env: NodeJS.ProcessEnv): string[] {
  return env.ASP_WSL_DISTRO ? ["-d", env.ASP_WSL_DISTRO] : [];
}

/** The WSL user's home directory as a Windows UNC path, e.g. \\wsl.localhost\Ubuntu\home\me. */
export function wslHomeAsWindowsPath(env: NodeJS.ProcessEnv): string | undefined {
  const r = spawnSync("wsl.exe", [...wslDistroArgs(env), "--", "bash", "-lc", "wslpath -w ~"], { encoding: "utf8" });
  const out = r.status === 0 ? r.stdout.trim() : "";
  return out.startsWith("\\\\") ? out : undefined;
}

/** WSLENV entries that share the named Windows environment variables with WSL, untranslated. */
export function wslEnvFor(names: string[], existing?: string): string {
  const parts = new Set((existing ?? "").split(":").filter(Boolean));
  for (const n of names) parts.add(`${n}/u`);
  return [...parts].join(":");
}
