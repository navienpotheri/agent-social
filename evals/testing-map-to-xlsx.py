"""Turns docs/testing-map.md (and the gaps register) into an Excel workbook you can filter and track in.

    python evals/testing-map-to-xlsx.py [out.xlsx]

The markdown stays the source of truth (a test keeps it honest); the workbook is a view of it, so regenerate it when the map changes. The Summary sheet is formulas over the "Use cases"
sheet, so edits you make there (a priority, a live status) recalculate it. Needs openpyxl.
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
SOFT = PatternFill("solid", fgColor="EEF2F8")
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
        protects = c[2]
        close = c[3] if len(c) == 7 else ""
        if len(c) > 7:  # a `|` inside a cell: keep the text together
            protects = " | ".join(c[2:-3])
        out.append([c[0], c[1], protects, close, c[-3], c[-2], c[-1]])
    return out


def style_header(ws, row=1):
    for cell in ws[row]:
        cell.font = Font(name=FONT, bold=True, color="FFFFFF", size=10)
        cell.fill = HEAD_FILL
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        cell.border = BOX


def body_style(ws, first=2):
    for row in ws.iter_rows(min_row=first):
        for cell in row:
            cell.font = Font(name=FONT, size=10)
            cell.alignment = Alignment(wrap_text=True, vertical="top")
            cell.border = BOX


def widths(ws, ws_widths):
    for i, w in enumerate(ws_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


def main():
    uc, backlog, matrix = parse_map()
    wb = Workbook()

    # ---- Use cases
    ws = wb.active
    ws.title = "Use cases"
    head = ["ID", "Journey / area", "Use case", "Priority", "Live status", "Live detail", "Automated by", "Gap", "To-do", "Owner", "Notes"]
    ws.append(head)
    for r in uc:
        status = (re.match(r"^(yes|partial|no|n/a)", r["live"]) or [None])[0]
        ws.append([r["id"], r["section"], r["use"], r["pri"], status, r["live"], r["auto"].replace(", ", "\n"), r["gap"], r["todo"], "", ""])
    n = ws.max_row
    style_header(ws)
    body_style(ws)
    widths(ws, [9, 30, 52, 9, 11, 30, 40, 8, 52, 12, 30])
    ws.freeze_panes = "D2"
    ws.auto_filter.ref = f"A1:K{n}"
    ws.row_dimensions[1].height = 30
    dv_p = DataValidation(type="list", formula1='"P0,P1,P2"', allow_blank=False)
    dv_l = DataValidation(type="list", formula1='"yes,partial,no,n/a"', allow_blank=False)
    ws.add_data_validation(dv_p)
    ws.add_data_validation(dv_l)
    dv_p.add(f"D2:D{n}")
    dv_l.add(f"E2:E{n}")
    red, amber, green, grey = (PatternFill("solid", bgColor=c, fgColor=c) for c in ("F8D0CC", "FCE8B2", "CDE8D4", "E3E6EB"))
    ws.conditional_formatting.add(f"D2:D{n}", FormulaRule(formula=['$D2="P0"'], fill=red))
    ws.conditional_formatting.add(f"D2:D{n}", FormulaRule(formula=['$D2="P1"'], fill=amber))
    ws.conditional_formatting.add(f"E2:E{n}", FormulaRule(formula=['$E2="yes"'], fill=green))
    ws.conditional_formatting.add(f"E2:E{n}", FormulaRule(formula=['$E2="partial"'], fill=amber))
    ws.conditional_formatting.add(f"E2:E{n}", FormulaRule(formula=['$E2="no"'], fill=red))
    ws.conditional_formatting.add(f"E2:E{n}", FormulaRule(formula=['$E2="n/a"'], fill=grey))

    # ---- Summary (formulas over the Use cases sheet)
    sm = wb.create_sheet("Summary", 0)
    sm["A1"] = "Testing map: summary"
    sm["A1"].font = Font(name=FONT, bold=True, size=14)
    sm["A2"] = "Every number below is a formula over the 'Use cases' sheet: change a Priority or Live status there and this page recalculates. Edit only the Owner and Notes columns, the Priority and the Live status."
    sm["A2"].font = Font(name=FONT, italic=True, size=9, color="555555")
    sm["A2"].alignment = Alignment(wrap_text=True)
    sm.merge_cells("A2:G2")
    sm.row_dimensions[2].height = 28
    U = "'Use cases'"
    r0 = 4
    sm.cell(r0, 1, "Priority by live status")
    sm.cell(r0, 1).font = Font(name=FONT, bold=True, size=11)
    heads = ["Priority", "yes (proven live)", "partial", "no (never run live)", "n/a", "Total", "% proven live"]
    for i, h in enumerate(heads, 1):
        sm.cell(r0 + 1, i, h)
    style_header(sm, r0 + 1)
    for j, p in enumerate(["P0", "P1", "P2"]):
        r = r0 + 2 + j
        sm.cell(r, 1, p)
        for i, s in enumerate(["yes", "partial", "no", "n/a"], 2):
            sm.cell(r, i, f'=COUNTIFS({U}!$D$2:$D${n},$A{r},{U}!$E$2:$E${n},"{s}")')
        sm.cell(r, 6, f"=SUM(B{r}:E{r})")
        sm.cell(r, 7, f"=IFERROR(B{r}/(F{r}-E{r}),0)")
        sm.cell(r, 7).number_format = "0%"
    rt = r0 + 5
    sm.cell(rt, 1, "All")
    for i in range(2, 7):
        c = get_column_letter(i)
        sm.cell(rt, i, f"=SUM({c}{r0 + 2}:{c}{r0 + 4})")
    sm.cell(rt, 7, f"=IFERROR(B{rt}/(F{rt}-E{rt}),0)")
    sm.cell(rt, 7).number_format = "0%"
    for row in sm.iter_rows(min_row=r0 + 2, max_row=rt):
        for c in row:
            c.font = Font(name=FONT, size=10, bold=(c.row == rt))
            c.border = BOX
    sm.cell(rt + 1, 1, "% proven live counts use cases that can be run live (n/a excluded). P0 means before the developer conference on 2026-10-17.")
    sm.cell(rt + 1, 1).font = Font(name=FONT, italic=True, size=9, color="555555")

    r1 = rt + 3
    sm.cell(r1, 1, "P0 use cases not yet proven live")
    sm.cell(r1, 1).font = Font(name=FONT, bold=True, size=11)
    sm.cell(r1, 2, f'=C{r0 + 2}+D{r0 + 2}')
    sm.cell(r1, 2).font = Font(name=FONT, bold=True, size=11, color="B00020")

    r2 = r1 + 2
    sm.cell(r2, 1, "By journey / area")
    sm.cell(r2, 1).font = Font(name=FONT, bold=True, size=11)
    for i, h in enumerate(["Journey / area", "Use cases", "P0", "Proven live (yes)", "Open P0 (partial or no)"], 1):
        sm.cell(r2 + 1, i, h)
    style_header(sm, r2 + 1)
    areas = []
    for r in uc:
        a = re.sub(r"^\d+\.\s*", "", r["section"])
        if a not in areas:
            areas.append(a)
    for k, a in enumerate(areas):
        r = r2 + 2 + k
        sm.cell(r, 1, a)
        sm.cell(r, 2, f"=COUNTIFS({U}!$B$2:$B${n},$A{r})")
        sm.cell(r, 3, f'=COUNTIFS({U}!$B$2:$B${n},$A{r},{U}!$D$2:$D${n},"P0")')
        sm.cell(r, 4, f'=COUNTIFS({U}!$B$2:$B${n},$A{r},{U}!$E$2:$E${n},"yes")')
        sm.cell(r, 5, f'=COUNTIFS({U}!$B$2:$B${n},$A{r},{U}!$D$2:$D${n},"P0",{U}!$E$2:$E${n},"partial")+COUNTIFS({U}!$B$2:$B${n},$A{r},{U}!$D$2:$D${n},"P0",{U}!$E$2:$E${n},"no")')
    last = r2 + 1 + len(areas)
    for row in sm.iter_rows(min_row=r2 + 2, max_row=last):
        for c in row:
            c.font = Font(name=FONT, size=10)
            c.border = BOX
            if c.column == 1:
                c.alignment = Alignment(wrap_text=True, vertical="top")
    widths(sm, [52, 16, 12, 18, 22, 10, 14])

    # ---- Gaps register
    gr = wb.create_sheet("Gaps register")
    gr.append(["ID", "Gap", "What protects today", "What would close it", "Where", "Priority", "Status"])
    for row in parse_register():
        gr.append(row)
    style_header(gr)
    body_style(gr)
    widths(gr, [8, 60, 40, 40, 16, 9, 10])
    gr.freeze_panes = "C2"
    gr.auto_filter.ref = f"A1:G{gr.max_row}"
    for s, col in (("open", "F8D0CC"), ("partial", "FCE8B2"), ("closed", "CDE8D4"), ("designed", "E3E6EB")):
        gr.conditional_formatting.add(f"G2:G{gr.max_row}", FormulaRule(formula=[f'$G2="{s}"'], fill=PatternFill("solid", bgColor=col, fgColor=col)))

    # ---- Analysis backlog and install matrix
    ab = wb.create_sheet("Analysis backlog")
    ab.append(["#", "Item", "What to do", "Done (date)"])
    for n_, title, body in backlog:
        ab.append([n_, title, body, ""])
    style_header(ab)
    body_style(ab)
    widths(ab, [5, 34, 100, 14])
    im = wb.create_sheet("Install matrix")
    for r in matrix:
        im.append(r)
    if im.max_row:
        style_header(im)
        body_style(im)
    widths(im, [26, 14, 40, 18, 22])

    wb.save(OUT)
    print(f"wrote {OUT}: {len(uc)} use cases, {len(parse_register())} gaps")


if __name__ == "__main__":
    main()
