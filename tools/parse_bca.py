#!/usr/bin/env python3
"""Parse BCA e-Statement (Tahapan Xpresi) PDFs into Kas Eunoia import JSON.

Usage:
    python3 tools/parse_bca.py STATEMENT.pdf [STATEMENT.pdf ...] > import.json

Needs `pdftotext` (poppler-utils). Each statement is validated against the
SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR summary printed by BCA; a
statement that does not reconcile aborts the run.
"""
import json
import re
import subprocess
import sys

BULAN = {
    "JANUARI": 1, "FEBRUARI": 2, "MARET": 3, "APRIL": 4, "MEI": 5, "JUNI": 6,
    "JULI": 7, "AGUSTUS": 8, "SEPTEMBER": 9, "OKTOBER": 10, "NOVEMBER": 11, "DESEMBER": 12,
}
AMOUNT = re.compile(r"\d{1,3}(?:,\d{3})*\.\d{2}")
TX_START = re.compile(r"^\s{0,12}(\d{2})/(\d{2})\s{2,}(\S.*)$")
WRAP_WIDTH = 18  # BCA wraps remark lines at 18 characters


def num(s):
    return round(float(s.replace(",", "")), 2)


def pdf_text(path):
    return subprocess.run(["pdftotext", "-layout", path, "-"], check=True,
                          capture_output=True, text=True).stdout


def find_periode(text):
    for line in text.splitlines():
        if "PERIOD" in line.replace(" ", ""):
            compact = line.replace(" ", "").upper()
            m = re.search(r":(" + "|".join(BULAN) + r")(\d{4})", compact)
            if m:
                return int(m.group(2)), BULAN[m.group(1)]
    raise ValueError("periode tidak ditemukan")


def find_rekening(text):
    m = re.search(r"NO\.\s*RE\s*KE\s*NING\s*:\s*([\d ]+)", text)
    return m.group(1).replace(" ", "") if m else ""


def is_noise(line):
    s = line.strip()
    return (not s or s.startswith(("Bersambung", "CATATAN", "•")) or "REKENING TAHAPAN" in s
            or "KCP " in s or "HALAMAN" in s or "MATA U ANG" in s or "PE RIOD" in s
            or "T ANG G A L" in s)


def join_remarks(lines):
    out = ""
    prev_len = 0
    for part in lines:
        if out and prev_len < WRAP_WIDTH:
            out += " "
        out += part
        prev_len = len(part)
    return out.strip()


def parse_statement(path):
    text = pdf_text(path)
    year, month = find_periode(text)
    summary = {}
    for key, label in (("saldo_awal", "SALDO AWAL"), ("total_cr", "MUTASI CR"),
                       ("total_db", "MUTASI DB"), ("saldo_akhir", "SALDO AKHIR")):
        m = re.search(label + r"\s*:\s*(" + AMOUNT.pattern + ")", text)
        summary[key] = num(m.group(1)) if m else None

    # Only the transaction area: from the first table header to the summary block.
    body = re.split(r"\n\s+SALDO AWAL\s+:", text)[0]

    txs = []
    cur = None
    in_header = True  # page header/notes until the table header line
    for raw in body.splitlines():
        if "T ANG G A L" in raw:
            in_header = False
            continue
        if "Bersambung" in raw:
            in_header = True
            continue
        if in_header or is_noise(raw):
            continue
        m = TX_START.match(raw)
        if m:
            day, mon, rest = m.groups()
            if "SALDO AWAL" in rest:
                continue
            amounts = list(AMOUNT.finditer(rest))
            if not amounts:
                continue
            first = amounts[0]
            head = rest[:first.start()].rstrip()
            tail = rest[first.end():]
            parts = re.split(r"\s{2,}", head.strip())
            ket = parts[0]
            ref = " ".join(p for p in parts[1:] if not re.fullmatch(r"\d{4}", p))
            cur = {
                "tanggal": f"{year:04d}-{int(mon):02d}-{int(day):02d}",
                "jenis": "DB" if re.match(r"\s*DB\b", tail) else "CR",
                "nominal": num(first.group()),
                "keterangan": (ket + (" " + ref if ref else "")).strip(),
                "lines": [],
                "saldo": num(amounts[1].group()) if len(amounts) > 1 else None,
            }
            txs.append(cur)
            continue
        if cur is None:
            continue
        s = raw.strip()
        if s.startswith("TANGGAL :"):
            continue
        cur["lines"].append(s)

    for tx in txs:
        lines = [l for l in tx.pop("lines") if l != "MyBCA"]
        # E-banking echoes the amount without separators as the first remark line.
        if lines and re.fullmatch(r"\d+\.\d{2}", lines[0]):
            lines = lines[1:]
        # BI-FAST prints the 3-digit bank code first.
        if lines and re.fullmatch(r"\d{3}", lines[0]):
            lines = lines[1:]
        pihak = ""
        if lines and not re.fullmatch(r"[\d ]+", lines[-1]):
            pihak = lines.pop()
        tx["pihak"] = pihak
        tx["berita"] = join_remarks(lines)

    total_cr = round(sum(t["nominal"] for t in txs if t["jenis"] == "CR"), 2)
    total_db = round(sum(t["nominal"] for t in txs if t["jenis"] == "DB"), 2)
    if summary["total_cr"] is not None and abs(total_cr - summary["total_cr"]) > 0.005:
        raise ValueError(f"{path}: total CR {total_cr} != {summary['total_cr']}")
    if summary["total_db"] is not None and abs(total_db - summary["total_db"]) > 0.005:
        raise ValueError(f"{path}: total DB {total_db} != {summary['total_db']}")
    if abs(summary["saldo_awal"] + total_cr - total_db - summary["saldo_akhir"]) > 0.005:
        raise ValueError(f"{path}: saldo tidak rekonsiliasi")

    for i, tx in enumerate(txs, 1):
        tx["urutan"] = i
    return {
        "rekening": find_rekening(text),
        "periode": f"{year:04d}-{month:02d}",
        **summary,
        "transaksi": txs,
    }


def main(paths):
    statements = sorted((parse_statement(p) for p in paths), key=lambda s: s["periode"])
    json.dump({"statements": statements}, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
