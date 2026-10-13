"""Turns docs/testing-map.md (and the gaps register) into an Excel workbook you can filter and track in.

    python evals/testing-map-to-xlsx.py [out.xlsx]

The markdown stays the source of truth (a test keeps it honest); the workbook is a view of it, so regenerate it when the map changes. The Summary sheet is formulas over the "Use cases"
sheet, so edits you make there (a priority, a live status) recalculate it. The "P0 to do" sheet is a snapshot made when the workbook is generated. Needs openpyxl.
"""
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "testing-map.xlsx"

FONT = "Arial"
HEAD_FILL = PatternFill("solid", fgColor="1F3A5F")
THIN = Side(style="thin", color="C9D1DE")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_map():
    section, rows, backlog, matrix = "", [], [], []
    mode = ""
    for line in (ROOT / "docs/testing-map.md").read_text(encoding="utf-8").splitlines():
        h = re.match(r"^## (.+)$", line)
        if h:
            section = h.group(1).strip()
            mode = "backlog" if section.startswith("Analysis backlog") else "matrix" if section.startswith("Install matrix") else ""
            continue
        if re.match(r"^\| UC-\d+ \|", line):
            c = cells(line)
            rows.append({"id": c[0], "section": re.sub(r"^\d+\.\s*", "", section), "use": c[1], "auto": c[2], "live": c[3], "gap": c[4], "todo": c[5], "pri": c[6]})
        elif mode == "backlog" and re.match(r"^\d+\. ", line):
            n, rest = line.split(". ", 1)
            title, _, body = rest.partition(". ")
            backlog.append((int(n), title.strip("* "), body.strip()))
        elif mode == "matrix" and line.startswith("|") and not re.match(r"^\|[-| ]+\|$", line):
            matrix.append(cells(line))
    return rows, backlog, matrix


def parse_register():
    out = []
    for line in (ROOT / "docs/gaps-register.md").read_text(encoding="utf-8").splitlines():
        if not re.match(r"^\| [A-Z]+\d+ \|", line):
            continue
        c = cells(line)
        if len(c) < 7:  # the partial-rows view has four columns; the full rows are the ones to keep
            continue
        protects = c[2] if len(c) == 7 else " | ".join(c[2:-3])
        out.append([c[0], c[1], protects, c[3] if len(c) == 7 else "", c[-3], c[-2], c[-1]])
    return out


def head(ws, row=1):
    for cell in ws[row]:
        cell.font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        cell.border = BOX


def body(ws, first=2):
    for row in ws.iter_rows(min_row=first):
        for cell in row:
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            cell.border = BOX


def widths(ws, ws_widths):
    for i, w in enumerate(ws_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def fill(c):
    return PatternFill("solid", bgColor=c, fgColor=c)


# What each word means, in plain English: used on the Read me sheet and beside the numbers on the Summary.
TERMS = [
    ("What we are testing", "Every row of 'Use cases' is one thing a real person does with Agent Social: sign up, run an agent, answer an approval, lose a key, close an account, run the service, build on the protocol. We want to know, for each one, 'does it actually work, and how do we know?'"),
    ("Use case", "One such thing, written as a sentence you could check (for example 'Ctrl-C in the middle of a session leaves a consistent state')."),
    ("P0", "Must work before the developer conference on 17 October 2026. A developer will hit it in their first 15 minutes, or it would embarrass us if it failed in front of them."),
    ("P1", "Needed before we invite more people than a handful of watched testers."),
    ("P2", "Later. Real, but nobody needs it for the conference or the first testers."),
    ("Automated by", "The test file(s) in the repository that check this on every change. 'none' means no automated test exists yet. A test using stand-in tools is good, but it is not the real thing."),
    ("Live status", "Did we do it for real, on the hosted service, with the real tools? yes = done for real (the date and what was faked are in 'Live detail'). partial = some of it, or some variants. no = never done for real. n/a = pure logic that has no live version (for example the maths of the lifecycle)."),
    ("Proven live", "Live status is 'yes'. This is the strongest evidence we have."),
    ("Evidence", "One word per use case. proven = an automated test AND done live. live only = done live but no automated test (could regress unnoticed). tests only = a test exists but never done live (could fail with real tools). logic-tested = pure logic, covered by a test. untested = neither."),
    ("Gap", "The row in the Gaps register that explains what is missing or risky about this use case. 'none' = nothing open."),
    ("To-do", "The next concrete thing to do to move this row toward 'proven'."),
    ("Open P0", "A P0 use case whose Live status is partial or no: the work list for the conference."),
]


def main():
    uc, backlog, matrix = parse_map()
    wb = Workbook()
    n_rows = len(uc)
    last = n_rows + 1
    U = "'Use cases'"

    # ---- Use cases (built first: the other sheets read it)
    ws = wb.active
    ws.title = "Use cases"
    ws.append(["ID", "Journey / area", "Use case (what a person does)", "Priority", "Live status", "Evidence", "Live detail", "Automated by", "Gap", "To-do (what remains)", "Owner", "Notes"])
    for i, r in enumerate(uc, 2):
        status = (re.match(r"^(yes|partial|no|n/a)", r["live"]) or [None])[0]
        ev = f'=IF(E{i}="n/a",IF(H{i}<>"none","logic-tested","untested"),IF(AND(E{i}="yes",H{i}<>"none"),"proven",IF(E{i}="yes","live only",IF(H{i}<>"none","tests only","untested"))))'
        ws.append([r["id"], r["section"], r["use"], r["pri"], status, ev, r["live"], r["auto"].replace(", ", "\n"), r["gap"], r["todo"], "", ""])
    head(ws)
    body(ws)
    widths(ws, [9, 30, 52, 9, 11, 13, 30, 40, 8, 52, 12, 30])
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = f"A1:L{last}"
    ws.row_dimensions[1].height = 30
    dv_p = DataValidation(type="list", formula1='"P0,P1,P2"', allow_blank=False)
    dv_l = DataValidation(type="list", formula1='"yes,partial,no,n/a"', allow_blank=False)
    ws.add_data_validation(dv_p)
    ws.add_data_validation(dv_l)
    dv_p.add(f"D2:D{last}")
    dv_l.add(f"E2:E{last}")
    for p, col in (("P0", "F8D0CC"), ("P1", "FCE8B2")):
        ws.conditional_formatting.add(f"D2:D{last}", FormulaRule(formula=[f'$D2="{p}"'], fill=fill(col)))
    for s, col in (("yes", "CDE8D4"), ("partial", "FCE8B2"), ("no", "F8D0CC"), ("n/a", "E3E6EB")):
        ws.conditional_formatting.add(f"E2:E{last}", FormulaRule(formula=[f'$E2="{s}"'], fill=fill(col)))
    for s, col in (("proven", "CDE8D4"), ("live only", "FCE8B2"), ("tests only", "FCE8B2"), ("logic-tested", "E3E6EB"), ("untested", "F8D0CC")):
        ws.conditional_formatting.add(f"F2:F{last}", FormulaRule(formula=[f'$F2="{s}"'], fill=fill(col)))

    # ---- Read me
    rd = wb.create_sheet("Read me", 0)
    rd["A1"] = "Testing map: how to read this workbook"
    rd["A1"].font = Font(name=FONT, bold=True, size=14)
    rd["A2"] = ("Agent Social is a protocol and a network. This workbook lists every use case a person goes through while connected to it, says how well each one is proven, and what remains. "
                "The goal for 17 October: every P0 row works, on the real service, with the real tools, and is covered by an automated test.")
    rd["A2"].alignment = Alignment(wrap_text=True, vertical="top")
    rd["A2"].font = Font(name=FONT, size=10)
    rd.merge_cells("A2:B2")
    rd.row_dimensions[2].height = 48
    rd.append([])
    rd.append(["Term", "What it means"])
    head(rd, 4)
    for t, m in TERMS:
        rd.append([t, m])
    body(rd, 5)
    for row in rd.iter_rows(min_row=5):
        row[0].font = Font(name=FONT, size=10, bold=True)
    rd.cell(rd.max_row + 2, 1, "The sheets").font = Font(name=FONT, bold=True, size=11)
    for name, what in [("Summary", "The counts, calculated from the Use cases sheet."), ("P0 to do", "Only what remains for the conference, in plain English (a snapshot made when this file was generated)."),
                       ("Use cases", "Everything, filterable. Edit Priority, Live status, Owner and Notes; the Summary recalculates."), ("Gaps register", "Every known gap and what would close it."),
                       ("Analysis backlog", "Deeper analysis still to do on the long-horizon run."), ("Install matrix", "Which operating systems and Node versions have been tried.")]:
        rd.append([name, what])
        rd.cell(rd.max_row, 1).font = Font(name=FONT, size=10, bold=True)
        rd.cell(rd.max_row, 2).font = Font(name=FONT, size=10)
        rd.cell(rd.max_row, 2).alignment = Alignment(wrap_text=True, vertical="top")
    widths(rd, [24, 120])

    # ---- Summary
    sm = wb.create_sheet("Summary", 1)
    sm["A1"] = "Testing map: summary"
    sm["A1"].font = Font(name=FONT, bold=True, size=14)
    sm["A2"] = "Every number is a formula over the 'Use cases' sheet. Change a Priority or Live status there and this page recalculates. The right-hand column says what each row means."
    sm["A2"].font = Font(name=FONT, italic=True, size=9, color="555555")
    sm["A2"].alignment = Alignment(wrap_text=True)
    sm.merge_cells("A2:H2")
    r0 = 4
    sm.cell(r0, 1, "1. How well proven, by priority").font = Font(name=FONT, bold=True, size=11)
    for i, h in enumerate(["Priority", "yes: done live", "partial", "no: never done live", "n/a", "Total", "% done live", "What this row means"], 1):
        sm.cell(r0 + 1, i, h)
    head(sm, r0 + 1)
    means = {"P0": "Must work before the conference on 17 Oct. 'no' and 'partial' here are the work list.", "P1": "Needed before inviting more than a few watched testers.", "P2": "Later; not needed for the conference."}
    for j, p in enumerate(["P0", "P1", "P2"]):
        r = r0 + 2 + j
        sm.cell(r, 1, p)
        for i, s in enumerate(["yes", "partial", "no", "n/a"], 2):
            sm.cell(r, i, f'=COUNTIFS({U}!$D$2:$D${last},$A{r},{U}!$E$2:$E${last},"{s}")')
        sm.cell(r, 6, f"=SUM(B{r}:E{r})")
        sm.cell(r, 7, f"=IFERROR(B{r}/(F{r}-E{r}),0)")
        sm.cell(r, 7).number_format = "0%"
        sm.cell(r, 8, means[p])
    rt = r0 + 5
    sm.cell(rt, 1, "All")
    for i in range(2, 7):
        c = get_column_letter(i)
        sm.cell(rt, i, f"=SUM({c}{r0 + 2}:{c}{r0 + 4})")
    sm.cell(rt, 7, f"=IFERROR(B{rt}/(F{rt}-E{rt}),0)")
    sm.cell(rt, 7).number_format = "0%"
    sm.cell(rt, 8, "% done live leaves out n/a (pure logic with no live version).")
    for row in sm.iter_rows(min_row=r0 + 2, max_row=rt):
        for c in row:
            c.font = Font(name=FONT, size=10, bold=(c.row == rt))
            c.border = BOX
            c.alignment = Alignment(wrap_text=True, vertical="top")

    r1 = rt + 2
    sm.cell(r1, 1, "2. Open P0 use cases (the conference work list)").font = Font(name=FONT, bold=True, size=11)
    sm.cell(r1 + 1, 1, "Open P0")
    sm.cell(r1 + 1, 2, f"=C{r0 + 2}+D{r0 + 2}")
    sm.cell(r1 + 1, 2).font = Font(name=FONT, bold=True, size=12, color="B00020")
    sm.cell(r1 + 1, 8, "P0 rows that are only partly done or never done live. See the 'P0 to do' sheet for what each one needs.")
    sm.cell(r1 + 1, 1).font = Font(name=FONT, size=10)
    sm.cell(r1 + 1, 8).font = Font(name=FONT, size=10)
    sm.cell(r1 + 1, 8).alignment = Alignment(wrap_text=True, vertical="top")

    r2 = r1 + 3
    sm.cell(r2, 1, "3. Evidence: how each use case is backed up").font = Font(name=FONT, bold=True, size=11)
    for i, h in enumerate(["Evidence", "P0", "P1", "P2", "n/a (no priority)", "Total", "", "What this means"], 1):
        sm.cell(r2 + 1, i, h)
    head(sm, r2 + 1)
    ev_means = [("proven", "An automated test AND done for real on the live service. The goal for every P0."), ("live only", "Done for real, but no automated test: it could break unnoticed."),
                ("tests only", "A test exists, but never done for real: could still fail with the real tools."), ("logic-tested", "Pure logic with a test; nothing to run live."), ("untested", "Neither a test nor a live run.")]
    for k, (ev, m) in enumerate(ev_means):
        r = r2 + 2 + k
        sm.cell(r, 1, ev)
        for i, p in enumerate(["P0", "P1", "P2"], 2):
            sm.cell(r, i, f'=COUNTIFS({U}!$F$2:$F${last},$A{r},{U}!$D$2:$D${last},"{p}")')
        sm.cell(r, 5, 0)
        sm.cell(r, 6, f"=SUM(B{r}:D{r})")
        sm.cell(r, 8, m)
    re_ = r2 + 1 + len(ev_means)
    for row in sm.iter_rows(min_row=r2 + 2, max_row=re_):
        for c in row:
            c.font = Font(name=FONT, size=10)
            c.border = BOX
            c.alignment = Alignment(wrap_text=True, vertical="top")

    r3 = re_ + 2
    sm.cell(r3, 1, "4. By journey / area").font = Font(name=FONT, bold=True, size=11)
    for i, h in enumerate(["Journey / area", "Use cases", "P0", "Done live (yes)", "Open P0", "", "", "What this column means"], 1):
        sm.cell(r3 + 1, i, h)
    head(sm, r3 + 1)
    areas = []
    for r in uc:
        if r["section"] not in areas:
            areas.append(r["section"])
    for k, a in enumerate(areas):
        r = r3 + 2 + k
        sm.cell(r, 1, a)
        sm.cell(r, 2, f"=COUNTIFS({U}!$B$2:$B${last},$A{r})")
        sm.cell(r, 3, f'=COUNTIFS({U}!$B$2:$B${last},$A{r},{U}!$D$2:$D${last},"P0")')
        sm.cell(r, 4, f'=COUNTIFS({U}!$B$2:$B${last},$A{r},{U}!$E$2:$E${last},"yes")')
        sm.cell(r, 5, f'=COUNTIFS({U}!$B$2:$B${last},$A{r},{U}!$D$2:$D${last},"P0",{U}!$E$2:$E${last},"partial")+COUNTIFS({U}!$B$2:$B${last},$A{r},{U}!$D$2:$D${last},"P0",{U}!$E$2:$E${last},"no")')
    sm.cell(r3 + 2, 8, "Use cases = all rows in the journey. P0 = those needed for the conference. Done live = proven on the real service. Open P0 = P0 rows still to do.")
    sm.cell(r3 + 2, 8).alignment = Alignment(wrap_text=True, vertical="top")
    sm.cell(r3 + 2, 8).font = Font(name=FONT, size=10)
    ea = r3 + 1 + len(areas)
    for row in sm.iter_rows(min_row=r3 + 2, max_row=ea):
        for c in row[:5]:
            c.font = Font(name=FONT, size=10)
            c.border = BOX
            if c.column == 1:
                c.alignment = Alignment(wrap_text=True, vertical="top")
    widths(sm, [52, 14, 10, 18, 12, 10, 12, 70])

    # ---- P0 to do (a snapshot, in plain English)
    td = wb.create_sheet("P0 to do", 2)
    td["A1"] = "P0 use cases still to do before the conference (a snapshot of the map when this file was made)"
    td["A1"].font = Font(name=FONT, bold=True, size=12)
    td.append([])
    td.append(["ID", "Journey / area", "What we are testing", "Where it stands now", "What remains to do", "Owner", "Done (date)"])
    head(td, 3)
    todo_rows = [r for r in uc if r["pri"] == "P0" and not re.match(r"^(yes|n/a)", r["live"])]
    for r in todo_rows:
        stands = ("Live: " + r["live"]) + ("; automated test: " + r["auto"] if r["auto"] != "none" else "; no automated test yet")
        td.append([r["id"], r["section"], r["use"], stands, r["todo"], "", ""])
    body(td, 4)
    widths(td, [9, 30, 52, 44, 56, 12, 14])
    td.freeze_panes = "C4"
    td.auto_filter.ref = f"A3:G{td.max_row}"
    td.cell(td.max_row + 2, 1, f"{len(todo_rows)} use cases. Each is P0 (needed for 17 October) and not yet proven live. Done means: it works for real on the hosted service with the real tools, and an automated test covers it.").font = Font(name=FONT, italic=True, size=9, color="555555")

    # ---- Gaps register, backlog, matrix
    gr = wb.create_sheet("Gaps register")
    gr.append(["ID", "Gap (what is missing or risky)", "What protects today", "What would close it", "Where", "Priority", "Status"])
    for row in parse_register():
        gr.append(row)
    head(gr)
    body(gr)
    widths(gr, [8, 60, 40, 40, 16, 9, 10])
    gr.freeze_panes = "C2"
    gr.auto_filter.ref = f"A1:G{gr.max_row}"
    for s, col in (("open", "F8D0CC"), ("partial", "FCE8B2"), ("closed", "CDE8D4"), ("designed", "E3E6EB")):
        gr.conditional_formatting.add(f"G2:G{gr.max_row}", FormulaRule(formula=[f'$G2="{s}"'], fill=fill(col)))
    ab = wb.create_sheet("Analysis backlog")
    ab.append(["#", "Item", "What to do", "Done (date)"])
    for n_, title, body_ in backlog:
        ab.append([n_, title, body_, ""])
    head(ab)
    body(ab)
    widths(ab, [5, 34, 100, 14])
    im = wb.create_sheet("Install matrix")
    for r in matrix:
        im.append(r)
    head(im)
    body(im)
    widths(im, [26, 14, 40, 18, 22])

    wb.save(OUT)
    print(f"wrote {OUT}: {n_rows} use cases, {len(todo_rows)} P0 to do, {len(parse_register())} gaps")


if __name__ == "__main__":
    main()
