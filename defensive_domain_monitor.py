#!/usr/bin/env python3
"""
defensive_domain_monitor.py

Purpose:
- Defensive naming / brand monitoring for short candidate names (5-6 chars).
- Checks .com activity and AU ownership signals.
- Checks .com.au availability status via provider API(s).
- Outputs markdown + CSV report.

Notes:
- Requires API keys for your chosen providers.
- Do not use for abusive or deceptive registration activity.
"""

import os
import re
import csv
import json
import time
import socket
import argparse
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

# ----------------------------
# Config
# ----------------------------

NAME_RE = re.compile(r"^[a-zA-Z0-9]{5,6}$")
UA = "Mozilla/5.0 (compatible; DefensiveDomainMonitor/1.0; +https://example.org/bot)"

AU_SIGNALS = [
    re.compile(r"\bPty\s+Ltd\b", re.I),
    re.compile(r"\bABN\b[:\s]?\d{2}\s?\d{3}\s?\d{3}\s?\d{3}", re.I),
    re.compile(r"\bACN\b[:\s]?\d{3}\s?\d{3}\s?\d{3}", re.I),
    re.compile(r"\bAustralia\b", re.I),
    re.compile(r"\bNSW\b|\bVIC\b|\bQLD\b|\bWA\b|\bSA\b|\bTAS\b|\bACT\b|\bNT\b", re.I),
    re.compile(r"\+61[\s\d]+", re.I),
]

PARKED_HINTS = [
    "domain for sale",
    "buy this domain",
    "this domain is parked",
    "sedo",
    "afternic",
    "dan.com",
    "parkingcrew",
    "bodis",
]


@dataclass
class ResultRow:
    base_name: str
    com_url: str
    com_active: bool
    au_proof: str
    com_au_status: str


# ----------------------------
# Inputs
# ----------------------------

def load_names_from_file(path: str) -> List[str]:
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            if NAME_RE.match(s):
                out.append(s.lower())
    return sorted(set(out))


def load_names_from_abr_csv(path: str, name_column: str = "entity_name") -> List[str]:
    """
    ABR bulk file parser (assumes CSV with a business name column).
    You may need to adjust `name_column` to match your file schema.
    """
    out = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = (row.get(name_column) or "").strip()
            if not raw:
                continue
            candidate = re.sub(r"[^A-Za-z0-9]", "", raw)
            if NAME_RE.match(candidate):
                out.append(candidate.lower())
    return sorted(set(out))


# ----------------------------
# .COM activity checks
# ----------------------------

def resolves(domain: str) -> bool:
    try:
        socket.gethostbyname(domain)
        return True
    except Exception:
        return False


def fetch_homepage(domain: str, timeout: int = 10) -> Tuple[bool, str, str]:
    """
    Returns:
      (is_active_site, final_url, text_blob)
    """
    for scheme in ("https://", "http://"):
        url = f"{scheme}{domain}"
        try:
            r = requests.get(
                url,
                timeout=timeout,
                headers={"User-Agent": UA},
                allow_redirects=True,
            )
            if r.status_code >= 400:
                continue

            html = r.text[:500_000]  # cap
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text(" ", strip=True).lower()

            if any(hint in text for hint in PARKED_HINTS):
                return False, r.url, text

            # heuristic for operational site
            if len(text) > 200:
                return True, r.url, text

        except Exception:
            continue
    return False, "", ""


def detect_au_proof(text: str) -> Optional[str]:
    for pat in AU_SIGNALS:
        m = pat.search(text)
        if m:
            return f"Matched: {m.group(0)}"
    return None


# ----------------------------
# .COM.AU availability checks
# ----------------------------

def check_com_au_status_namecheap(domain: str, api_user: str, api_key: str, username: str, client_ip: str) -> str:
    """
    Example using Namecheap domains.check API.
    You can swap this with GoDaddy/NameSilo/other provider endpoint.
    """
    sld = domain.replace(".com.au", "")
    params = {
        "ApiUser": api_user,
        "ApiKey": api_key,
        "UserName": username,
        "ClientIp": client_ip,
        "Command": "namecheap.domains.check",
        "DomainList": f"{sld}.com.au",
    }
    try:
        r = requests.get("https://api.namecheap.com/xml.response", params=params, timeout=20)
        txt = r.text.lower()
        # crude parse to avoid xml deps; production should use XML parser
        if 'available="true"' in txt:
            return "AVAILABLE"
        if 'available="false"' in txt:
            return "REGISTERED"
        return "UNKNOWN"
    except Exception:
        return "ERROR"


def check_com_au_status_generic_dns(domain: str) -> str:
    """
    Fallback heuristic: DNS NXDOMAIN != guaranteed available.
    Only use as weak signal when no registrar API exists.
    """
    try:
        socket.gethostbyname(domain)
        return "REGISTERED_OR_DELEGATED"
    except Exception:
        return "POSSIBLY_AVAILABLE"


# ----------------------------
# Pipeline
# ----------------------------

def process_one(base: str, provider: str, creds: Dict[str, str]) -> Optional[ResultRow]:
    com_domain = f"{base}.com"

    if not resolves(com_domain):
        return None

    active, final_url, text = fetch_homepage(com_domain)
    if not active:
        return None

    au_proof = detect_au_proof(text)
    if not au_proof:
        return None

    com_au = f"{base}.com.au"
    if provider == "namecheap":
        status = check_com_au_status_namecheap(
            com_au,
            api_user=creds["api_user"],
            api_key=creds["api_key"],
            username=creds["username"],
            client_ip=creds["client_ip"],
        )
    else:
        status = check_com_au_status_generic_dns(com_au)

    if status != "AVAILABLE" and status != "POSSIBLY_AVAILABLE":
        return None

    return ResultRow(
        base_name=base,
        com_url=final_url or f"https://{com_domain}",
        com_active=True,
        au_proof=au_proof,
        com_au_status=status,
    )


def write_csv(rows: List[ResultRow], path: str):
    fieldnames = ["base_name", "com_url", "com_active", "au_proof", "com_au_status"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(asdict(r))


def write_markdown(rows: List[ResultRow], path: str):
    lines = []
    lines.append("| Base Name | Active .COM URL | Australian Business Proof | .COM.AU Status |")
    lines.append("|---|---|---|---|")
    for r in rows:
        lines.append(f"| {r.base_name} | {r.com_url} | {r.au_proof} | {r.com_au_status} |")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--names-file", help="Text file: one candidate per line")
    p.add_argument("--abr-csv", help="ABR CSV path (optional)")
    p.add_argument("--abr-name-column", default="entity_name")
    p.add_argument("--provider", choices=["namecheap", "dns"], default="dns")
    p.add_argument("--max-workers", type=int, default=20)
    p.add_argument("--limit", type=int, default=5000)
    p.add_argument("--out-csv", default="hits.csv")
    p.add_argument("--out-md", default="hits.md")
    args = p.parse_args()

    names: List[str] = []
    if args.names_file:
        names.extend(load_names_from_file(args.names_file))
    if args.abr_csv:
        names.extend(load_names_from_abr_csv(args.abr_csv, args.abr_name_column))
    names = sorted(set(n.lower() for n in names if NAME_RE.match(n)))[: args.limit]

    if not names:
        raise SystemExit("No valid 5-6 char candidates found.")

    creds = {
        "api_user": os.getenv("NAMECHEAP_API_USER", ""),
        "api_key": os.getenv("NAMECHEAP_API_KEY", ""),
        "username": os.getenv("NAMECHEAP_USERNAME", ""),
        "client_ip": os.getenv("NAMECHEAP_CLIENT_IP", ""),
    }

    rows: List[ResultRow] = []
    with ThreadPoolExecutor(max_workers=args.max_workers) as ex:
        futs = [ex.submit(process_one, n, args.provider, creds) for n in names]
        for fut in as_completed(futs):
            r = fut.result()
            if r:
                rows.append(r)

    rows.sort(key=lambda x: x.base_name)
    write_csv(rows, args.out_csv)
    write_markdown(rows, args.out_md)

    print(f"Done. Matches: {len(rows)}")
    print(f"CSV: {args.out_csv}")
    print(f"Markdown: {args.out_md}")


if __name__ == "__main__":
    main()
