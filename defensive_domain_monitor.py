#!/usr/bin/env python3
"""
defensive_domain_monitor.py

Purpose:
- Defensive naming / brand monitoring for short candidate names (5-6 chars).
- Checks .com activity and AU ownership signals.
- Checks .com.au availability status via provider API(s).
- Outputs markdown + CSV report.

SOTA Upgrades:
- Atomic file writes to prevent data corruption.
- Thread-safe error isolation (futures never crash the main thread).
- Rigorous credential validation.
- Connection pooling and retry mechanisms with exponential backoff.
- Zero-trust URL and text parsing.
"""

import os
import re
import csv
import time
import socket
import tempfile
import argparse
import shutil
from dataclasses import dataclass, asdict
from typing import List, Dict, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from bs4 import BeautifulSoup

# ----------------------------
# Config & Setup
# ----------------------------

NAME_RE = re.compile(r"^[a-zA-Z0-9]{5,6}$")
UA = "Mozilla/5.0 (compatible; DefensiveDomainMonitor/2.0; +https://example.org/bot)"

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
# Connection Pooling & Retries
# ----------------------------
def create_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    retry = Retry(
        total=3,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "OPTIONS"]
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=100, pool_maxsize=100)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session

GLOBAL_SESSION = create_session()

# ----------------------------
# Inputs
# ----------------------------

def load_names_from_file(path: str) -> List[str]:
    out = []
    if not os.path.exists(path):
        print(f"[WARN] Names file not found: {path}")
        return out
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            s = line.strip()
            if NAME_RE.match(s):
                out.append(s.lower())
    return sorted(set(out))


def load_names_from_abr_csv(path: str, name_column: str = "entity_name") -> List[str]:
    out = []
    if not os.path.exists(path):
        print(f"[WARN] ABR CSV not found: {path}")
        return out
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames and name_column not in reader.fieldnames:
                print(f"[WARN] Column {name_column} not in ABR CSV.")
                return out
            for row in reader:
                raw = (row.get(name_column) or "").strip()
                if not raw:
                    continue
                candidate = re.sub(r"[^A-Za-z0-9]", "", raw)
                if NAME_RE.match(candidate):
                    out.append(candidate.lower())
    except Exception as e:
        print(f"[ERROR] Failed to parse ABR CSV: {e}")
    return sorted(set(out))

# ----------------------------
# .COM activity checks
# ----------------------------

def resolves(domain: str) -> bool:
    try:
        socket.setdefaulttimeout(5.0)
        socket.gethostbyname(domain)
        return True
    except Exception:
        return False


def fetch_homepage(domain: str, timeout: int = 15) -> Tuple[bool, str, str]:
    for scheme in ("https://", "http://"):
        url = f"{scheme}{domain}"
        try:
            r = GLOBAL_SESSION.get(url, timeout=timeout, allow_redirects=True)
            if r.status_code >= 400:
                continue

            html = r.text[:500_000]
            soup = BeautifulSoup(html, "html.parser")
            text = soup.get_text(" ", strip=True).lower()

            if any(hint in text for hint in PARKED_HINTS):
                return False, r.url, text

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
        r = GLOBAL_SESSION.get("https://api.namecheap.com/xml.response", params=params, timeout=20)
        txt = r.text.lower()
        if 'available="true"' in txt:
            return "AVAILABLE"
        if 'available="false"' in txt:
            return "REGISTERED"
        return "UNKNOWN"
    except Exception as e:
        print(f"[WARN] API check failed for {domain}: {e}")
        return "ERROR"


def check_com_au_status_generic_dns(domain: str) -> str:
    try:
        socket.setdefaulttimeout(5.0)
        socket.gethostbyname(domain)
        return "REGISTERED_OR_DELEGATED"
    except Exception:
        return "POSSIBLY_AVAILABLE"

# ----------------------------
# Pipeline
# ----------------------------

def process_one(base: str, provider: str, creds: Dict[str, str]) -> Optional[ResultRow]:
    try:
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

        if status not in ("AVAILABLE", "POSSIBLY_AVAILABLE"):
            return None

        return ResultRow(
            base_name=base,
            com_url=final_url or f"https://{com_domain}",
            com_active=True,
            au_proof=au_proof,
            com_au_status=status,
        )
    except Exception as e:
        print(f"[ERROR] Isolated failure processing {base}: {e}")
        return None

# ----------------------------
# Atomic Writes
# ----------------------------

def atomic_write(filepath: str, write_func):
    """Executes atomic file creation via temp files."""
    dirname = os.path.dirname(filepath) or "."
    fd, tmp_path = tempfile.mkstemp(dir=dirname, prefix=".tmp_write_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            write_func(f)
        os.replace(tmp_path, filepath)
    except Exception as e:
        os.remove(tmp_path)
        raise e

def write_csv(rows: List[ResultRow], path: str):
    def _write(f):
        fieldnames = ["base_name", "com_url", "com_active", "au_proof", "com_au_status"]
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(asdict(r))
    atomic_write(path, _write)

def write_markdown(rows: List[ResultRow], path: str):
    def _write(f):
        lines = [
            "| Base Name | Active .COM URL | Australian Business Proof | .COM.AU Status |",
            "|---|---|---|---|"
        ]
        for r in rows:
            lines.append(f"| {r.base_name} | {r.com_url} | {r.au_proof} | {r.com_au_status} |")
        f.write("\n".join(lines) + "\n")
    atomic_write(path, _write)

# ----------------------------
# Entrypoint
# ----------------------------

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
        print("[INFO] No valid 5-6 char candidates found to process.")
        return

    creds = {
        "api_user": os.getenv("NAMECHEAP_API_USER", ""),
        "api_key": os.getenv("NAMECHEAP_API_KEY", ""),
        "username": os.getenv("NAMECHEAP_USERNAME", ""),
        "client_ip": os.getenv("NAMECHEAP_CLIENT_IP", ""),
    }

    if args.provider == "namecheap":
        missing = [k for k, v in creds.items() if not v]
        if missing:
            print(f"[FATAL] Namecheap provider selected but missing credentials: {', '.join(missing)}")
            raise SystemExit(1)

    rows: List[ResultRow] = []
    print(f"[INFO] Processing {len(names)} candidates using {args.max_workers} workers...")
    
    with ThreadPoolExecutor(max_workers=args.max_workers) as ex:
        futs = [ex.submit(process_one, n, args.provider, creds) for n in names]
        for fut in as_completed(futs):
            try:
                r = fut.result()
                if r:
                    rows.append(r)
            except Exception as e:
                print(f"[ERROR] Unhandled exception in worker thread: {e}")

    rows.sort(key=lambda x: x.base_name)
    write_csv(rows, args.out_csv)
    write_markdown(rows, args.out_md)

    print(f"[SUCCESS] Done. Matches: {len(rows)}")
    print(f"[SUCCESS] CSV written to: {args.out_csv}")
    print(f"[SUCCESS] Markdown written to: {args.out_md}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[INFO] Process interrupted by user.")
        raise SystemExit(1)
    except Exception as e:
        print(f"[FATAL ERROR] Pipeline crashed: {e}")
        raise SystemExit(1)
