#!/usr/bin/env python3
"""Servidor de desenvolvimento que proíbe cache.

O `python3 -m http.server` só manda `Last-Modified`, e o navegador guarda os
PNGs em memória sem revalidar. Durante um ajuste de arte isso é veneno: o sheet
muda no disco, a página recarrega e o que aparece é o sprite antigo — dá para
passar meia hora perseguindo um defeito que já foi corrigido.

Uso:  python3 tools/servir.py [porta]
"""

from __future__ import annotations

import sys
from functools import partial
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


class SemCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, formato, *args):
        if '304' not in formato % args:
            super().log_message(formato, *args)


def main() -> None:
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = partial(SemCache, directory=str(RAIZ))
    print(f'servindo {RAIZ} em http://127.0.0.1:{porta}/ (sem cache)')
    HTTPServer(('127.0.0.1', porta), handler).serve_forever()


if __name__ == '__main__':
    main()
