#!/usr/bin/env python3
"""Conserta o canal de transparência dos sprite-sheets paletizados.

A quantização que gerou os assets v2 escreveu um chunk tRNS quebrado: o índice
da cor de fundo (34,35,34) ficou com alpha 23 em vez de 0, e nenhum pixel do
sheet chegava a ser transparente. O resultado no jogo era um retângulo cinza a
9% de opacidade em volta de todo sprite — a "caixa" em volta do personagem.

Pixel art não tem meio-termo: alpha é 0 (fundo) ou 255 (desenho). Este script
impõe isso, e só isso: reescreve o chunk tRNS de modo que o índice da cor-chave
de fundo tenha alpha 0 e todos os demais tenham 255. Nenhum pixel é alterado.

Ficar só no tRNS é deliberado. Uma primeira versão tentou "consertar" também os
pixels da cor-chave encerrados dentro da figura, tratando-os como ruído da
quantização — e tapou o vão do arco do tile 5 com um borrão cinza. Vão dentro do
desenho é desenho: quem decide o que é buraco é a arte, não o script.

Uso:  python3 tools/reparar-alpha.py [--dry-run]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent

# Cor-chave de fundo compartilhada por todos os sheets v2.
COR_FUNDO = (34, 35, 34)

SHEETS = [
    'assets/player-v2.png',
    'assets/boss-v2.png',
    'assets/enemies-v2.png',
    'assets/effects-v2.png',
    'assets/tiles-v2.png',
]


def indice_da_cor(paleta: list[int], cor: tuple[int, int, int]) -> int:
    for i in range(len(paleta) // 3):
        if tuple(paleta[i * 3:i * 3 + 3]) == cor:
            return i
    raise SystemExit(f'cor de fundo {cor} não está na paleta')


def reparar(caminho: Path, dry_run: bool) -> None:
    im = Image.open(caminho)
    if im.mode != 'P':
        print(f'  {caminho.name}: não é paletizado, pulando')
        return

    paleta = im.getpalette()
    idx_fundo = indice_da_cor(paleta, COR_FUNDO)
    usados = set(im.get_flattened_data())

    trns = bytearray(255 for _ in range(max(usados) + 1))
    trns[idx_fundo] = 0
    im.info['transparency'] = bytes(trns)

    transparentes = sum(1 for v in im.get_flattened_data() if v == idx_fundo)
    print(f'  {caminho.name}: fundo=idx{idx_fundo}, {transparentes} px agora transparentes')
    if not dry_run:
        im.save(caminho, transparency=bytes(trns), optimize=True)


def main() -> None:
    dry_run = '--dry-run' in sys.argv
    print('reparando transparência' + (' (dry-run)' if dry_run else ''))
    for rel in SHEETS:
        reparar(RAIZ / rel, dry_run)


if __name__ == '__main__':
    main()
