/**
 * A sponsor's view of its agents in the Registry (register row DK125; registry.md RG-15): one line for each agent, from the same pages the log computes, with what the sponsor must do and by when: a renewal inside
 * 30 days or 7 days of its date (the two notices the mail sends), a lapsed identity, a suspension, a retirement, a takedown it may appeal and an abuse report that is still open. Pure: it reads pages and a time.
 * Not claimed: that a notice is delivered (the mail is another part of the row).
 */
import type { RecordPage } from "@agent-social/asp-log";

const DAY = 86_400_000;

export interface SponsorRow { did: string; name: string; level: string; actions: string[] }

/** What a sponsor must look at for each of its agents' pages at `now` (a time in ms). An agent with nothing to do has an empty list. */
export function sponsorStatus(pages: RecordPage[], now: number): SponsorRow[] {
  return pages.map((p) => {
    const actions: string[] = [];
    if (p.retired) actions.push("retired: nothing to renew");
    else {
      if (p.renewal?.lapsed) actions.push(`identity LAPSED (was due ${p.renewal.due}): asp registry renew --by ${p.did}`);
      else if (p.renewal) {
        const days = Math.ceil((Date.parse(p.renewal.due) - now) / DAY);
        if (days <= 7) actions.push(`renewal due in ${Math.max(days, 0)} day(s), on ${p.renewal.due}: the 7-day notice`);
        else if (days <= 30) actions.push(`renewal due in ${days} days, on ${p.renewal.due}: the 30-day notice`);
      }
      if (p.suspended) actions.push(`SUSPENDED until ${p.suspended.until}: ${p.suspended.reason}`);
      for (const t of p.takedowns) if (Date.parse(t.appealable_until) > now) actions.push(`name ${t.name} taken down (Article ${t.articles.join(", ")}): it may be appealed until ${t.appealable_until}`);
      const open = (p.abuse ?? []).filter((a) => !a.outcome || a.outcome.state === "referred");
      if (open.length) actions.push(`${open.length} abuse report(s) not yet ruled`);
    }
    return { did: p.did, name: p.names[0] ?? p.did, level: p.level, actions };
  });
}
