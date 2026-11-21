/**
 * Ready-made schedule entries for the mail watcher (register row DK1700): `asp mail watch --once` run every few minutes by the operating system, so a person does not have to keep a terminal open.
 * This only prints the entries; it installs nothing and changes no setting on the machine. The person copies the one for their system.
 */
export interface ScheduleInput {
  /** The Node executable and the cli script that run the command, as absolute paths. */
  node: string;
  cli: string;
  /** The asp home the watcher reads (ASP_HOME), if not the default. */
  home?: string;
  everyMinutes: number;
  /** Extra arguments after `mail watch --once` (for example `--send --mail-from <address>`). */
  args?: string[];
}

export interface ScheduleEntries { windows: string; cron: string; launchd: string }

const q = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
const x = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function scheduleEntries(i: ScheduleInput): ScheduleEntries {
  const n = Math.max(1, Math.min(59, Math.trunc(i.everyMinutes)));
  const words = [i.node, i.cli, "mail", "watch", "--once", ...(i.args ?? [])];
  const command = words.map(q).join(" ");
  const homeWin = i.home ? `set ASP_HOME=${i.home}&& ` : "";
  const homeSh = i.home ? `ASP_HOME=${q(i.home)} ` : "";
  return {
    // Windows Task Scheduler: every n minutes for the signed-in user, quietly; delete it with schtasks /Delete /TN AgentSocialMailWatch /F.
    windows: `schtasks /Create /TN AgentSocialMailWatch /SC MINUTE /MO ${n} /TR "cmd /c ${homeWin}${command.replace(/"/g, '\\"')}" /F`,
    // cron (Linux, macOS): add with crontab -e.
    cron: `*/${n} * * * * ${homeSh}${command} >> "$HOME/.asp-mail-watch.log" 2>&1`,
    // launchd (macOS): save as ~/Library/LaunchAgents/com.agentsocial.mailwatch.plist, then launchctl load it.
    launchd: `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n  <key>Label</key><string>com.agentsocial.mailwatch</string>\n  <key>ProgramArguments</key><array>${words.map((w) => `<string>${x(w)}</string>`).join("")}</array>\n${i.home ? `  <key>EnvironmentVariables</key><dict><key>ASP_HOME</key><string>${x(i.home)}</string></dict>\n` : ""}  <key>StartInterval</key><integer>${n * 60}</integer>\n  <key>RunAtLoad</key><true/>\n</dict></plist>`,
  };
}
