/**
 * Certificate reload without a restart (register row O15): `asp serve --tls-cert <pem> --tls-key <pem>` reads the files again when the process receives SIGHUP, so a renewed certificate (from certbot,
 * a proxy's renewal job or by hand) takes effect for new connections while open ones continue. A file that cannot be read or does not form a valid pair is refused and the old certificate stays in use.
 * Windows has no SIGHUP: there a renewal needs a restart, as before.
 */
import { readFileSync } from "node:fs";
import type { Server } from "node:tls";

export interface TlsFiles { cert: string; key: string }

/** Reads the files and gives them to the server; throws, and changes nothing, when the pair is not valid. */
export function reloadTls(server: Pick<Server, "setSecureContext">, files: TlsFiles): { cert: Buffer } {
  const cert = readFileSync(files.cert);
  const key = readFileSync(files.key);
  server.setSecureContext({ cert, key }); // an invalid pair throws here and the previous context stays
  return { cert };
}

/** Reloads on SIGHUP and says what happened; returns the function that removes the handler. */
export function reloadTlsOnSighup(server: Pick<Server, "setSecureContext">, files: TlsFiles, say: (line: string) => void, proc: Pick<NodeJS.Process, "on" | "off"> = process): () => void {
  const onHup = () => {
    try { reloadTls(server, files); say("  tls      the certificate was read again; new connections use it"); } catch (e) { say(`  tls      the certificate was NOT reloaded and the old one stays in use: ${(e as Error).message}`); }
  };
  proc.on("SIGHUP", onHup);
  return () => proc.off("SIGHUP", onHup);
}
