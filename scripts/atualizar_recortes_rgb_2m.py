#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Atualização dos Recortes Sentinel-2 RGB True Color (2 Metros) para WebGIS
Work Drones Geo / Antigravity AI

Recorta as imagens orbitais super-resolvidas a 2 metros aplicando a calibração
padrão Sentinel-2 L2A com curva de ganho proporcional uniforme:
- R = B04, G = B03, B = B02 (sem infravermelho B08)
- Sem estiramento de percentil individual por canal
- Preserva o equilíbrio cromático natural entre vermelho e verde do dossel
"""

import sys
from pathlib import Path

# Executa o módulo padrão de calibração
from scripts.calibrar_rgb_sentinel2_padrao import main

if __name__ == "__main__":
    main()
