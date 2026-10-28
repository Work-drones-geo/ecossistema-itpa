#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Processamento e Recorte Automatizado de Rasters Sentinel-2
Recorta imagens Sentinel-2 (RGB True Color e NDVI) na geometria exata de cada talhão/quadrante.
Aplica a paleta de cores agronômica padrão RdYlGn (Red-Yellow-Green) normalizada
para alto contraste e nitidez visual no monitoramento florestal.
"""

import os
import re
import sys
import glob
import json
import unicodedata
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from PIL import Image
import rasterio
from rasterio.mask import mask
from rasterio.features import geometry_mask

# Tabela de calibração espectral: Mapeamento de cores da visualização Sentinel-2 NDVI para escala contínua de NDVI
SENTINEL_NDVI_PALETTE = np.array([
    [13, 13, 13, 0.00],
    [236, 236, 236, 0.05],
    [220, 220, 220, 0.05],
    [192, 192, 192, 0.05],
    [255, 251, 205, 0.10],
    [238, 233, 182, 0.15],
    [223, 218, 156, 0.20],
    [205, 200, 131, 0.25],
    [189, 184, 108, 0.30],
    [177, 195, 97, 0.35],
    [164, 205, 90, 0.40],
    [146, 192, 82, 0.45],
    [128, 179, 72, 0.50],
    [113, 164, 64, 0.55],
    [97, 151, 54, 0.60],
    [79, 138, 46, 0.65],
    [64, 125, 36, 0.70],
    [49, 110, 28, 0.75],
    [33, 97, 18, 0.80],
    [15, 84, 10, 0.85],
    [0, 69, 0, 0.95]
], dtype=np.float32)


def normalizar_talhao_id(props: dict) -> str:
    """Gera identificador padronizado para o talhão (ex: quadrante_1)."""
    id_val = props.get("id")
    if id_val:
        return str(id_val).strip().lower()

    nome = props.get("Name") or props.get("nome") or props.get("Nome") or ""
    match_quad = re.search(r"quadrante\s*(\d+)", nome, re.IGNORECASE)
    if match_quad:
        return f"quadrante_{match_quad.group(1)}"

    # Fallback para slug seguro
    slug = re.sub(
        r"[^a-z0-9]+",
        "_",
        unicodedata.normalize("NFD", nome)
        .encode("ascii", "ignore")
        .decode("utf-8")
        .lower()
    ).strip("_")
    return slug or "talhao"


def localizar_arquivos_entrada():
    """Localiza o GeoJSON dos talhões e os TIFFs do Sentinel-2."""
    caminhos_vetor = [
        Path("DATA/KMLs.geojson"),
        Path("DATA/talhoes.geojson"),
        Path("data/KMLs.geojson"),
        Path("data/talhoes.geojson"),
    ]
    vetor_path = None
    for cv in caminhos_vetor:
        if cv.exists():
            vetor_path = cv.resolve()
            break

    if not vetor_path:
        raise FileNotFoundError("Arquivo GeoJSON dos talhões não encontrado em DATA/.")

    # Busca os TIFFs de True Color e NDVI
    candidatos_busca = [
        Path("C:/Users/bsode/Downloads"),
        Path("DATA"),
        Path("assets"),
        Path("."),
    ]

    rgb_tiff = None
    ndvi_tiff = None

    for base_dir in candidatos_busca:
        if not base_dir.exists():
            continue

        if not rgb_tiff:
            rgb_matches = list(base_dir.glob("*Sentinel-2*True_color*.tiff")) + \
                          list(base_dir.glob("*True_color*.tif*")) + \
                          list(base_dir.glob("*RGB*.tif*"))
            if rgb_matches:
                rgb_tiff = rgb_matches[0].resolve()

        if not ndvi_tiff:
            ndvi_matches = list(base_dir.glob("*Sentinel-2*NDVI*.tiff")) + \
                           list(base_dir.glob("*NDVI*.tif*"))
            if ndvi_matches:
                ndvi_tiff = ndvi_matches[0].resolve()

    if not rgb_tiff:
        raise FileNotFoundError("Arquivo TIFF Sentinel-2 True Color (RGB) não localizado.")
    if not ndvi_tiff:
        raise FileNotFoundError("Arquivo TIFF Sentinel-2 NDVI não localizado.")

    return vetor_path, rgb_tiff, ndvi_tiff


def recortar_rgb(src_dataset, geom):
    """Recorta o raster RGB pela geometria exata com transparência fora do contorno."""
    out_image, out_transform = mask(src_dataset, [geom], crop=True, all_touched=True)
    _, height, width = out_image.shape

    mask_inside = geometry_mask(
        [geom],
        out_shape=(height, width),
        transform=out_transform,
        invert=True,
        all_touched=True
    )

    r = out_image[0]
    g = out_image[1]
    b = out_image[2]

    alpha = np.where(mask_inside, 255, 0).astype(np.uint8)
    r = np.where(mask_inside, r, 0).astype(np.uint8)
    g = np.where(mask_inside, g, 0).astype(np.uint8)
    b = np.where(mask_inside, b, 0).astype(np.uint8)

    rgba = np.dstack([r, g, b, alpha])
    return rgba


def recortar_e_colorir_ndvi(src_dataset, geom, vmin=0.15, vmax=0.85):
    """
    Recorta o raster NDVI pela geometria do talhão e aplica o colormap agronômico 'RdYlGn':
    - Baixo vigor / Solo exposto (NDVI <= vmin): Vermelho/Laranja (#A50026 -> #D73027)
    - Vigor moderado (NDVI ~ 0.5): Amarelo vibrante (#FFFFBF)
    - Alto vigor vegetal (NDVI >= vmax): Verde floresta escuro (#006837)
    - Fora do contorno do talhão: Canal alfa = 0 (100% transparente)
    """
    out_image, out_transform = mask(src_dataset, [geom], crop=True, all_touched=True)
    _, height, width = out_image.shape

    mask_inside = geometry_mask(
        [geom],
        out_shape=(height, width),
        transform=out_transform,
        invert=True,
        all_touched=True
    )

    # 1. Recupera valores contínuos de NDVI através de busca do vizinho mais próximo no espaço RGB
    ref_rgb = SENTINEL_NDVI_PALETTE[:, :3]
    ref_ndvi = SENTINEL_NDVI_PALETTE[:, 3]

    pixels_rgb = np.stack([out_image[0], out_image[1], out_image[2]], axis=-1).reshape(-1, 3).astype(np.float32)

    # Distância Euclidiana quadrática no espaço RGB
    diff = pixels_rgb[:, None, :] - ref_rgb[None, :, :]
    dists = np.sum(diff ** 2, axis=2)
    nearest_idx = np.argmin(dists, axis=1)

    ndvi_continuous = ref_ndvi[nearest_idx].reshape(height, width)

    # 2. Normalização no intervalo agronômico [vmin, vmax]
    ndvi_norm = np.clip((ndvi_continuous - vmin) / (vmax - vmin), 0.0, 1.0)

    # 3. Aplica colormap RdYlGn oficial do Matplotlib
    cmap = plt.colormaps['RdYlGn']
    colored_rgba = cmap(ndvi_norm)  # Retorna float [0..1] com 4 canais

    r_col = (colored_rgba[:, :, 0] * 255).astype(np.uint8)
    g_col = (colored_rgba[:, :, 1] * 255).astype(np.uint8)
    b_col = (colored_rgba[:, :, 2] * 255).astype(np.uint8)

    # 4. Transparência alfa 100% fora do contorno
    alpha = np.where(mask_inside, 255, 0).astype(np.uint8)
    r_final = np.where(mask_inside, r_col, 0).astype(np.uint8)
    g_final = np.where(mask_inside, g_col, 0).astype(np.uint8)
    b_final = np.where(mask_inside, b_col, 0).astype(np.uint8)

    rgba = np.dstack([r_final, g_final, b_final, alpha])
    return rgba, ndvi_continuous


def main():
    print("=" * 70)
    print("  Ecossistema ITPA - Recorte Sentinel-2 & Colorização Agronômica (RdYlGn)")
    print("=" * 70)

    vetor_path, rgb_tiff_path, ndvi_tiff_path = localizar_arquivos_entrada()
    print(f"[1/4] Vetor de Talhões : {vetor_path}")
    print(f"[1/4] Raster RGB       : {rgb_tiff_path}")
    print(f"[1/4] Raster NDVI      : {ndvi_tiff_path}")

    out_dir = Path("assets/satelite")
    out_dir.mkdir(parents=True, exist_ok=True)

    with open(vetor_path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    total_features = len(features)
    print(f"\n[2/4] Total de talhões/quadrantes encontrados: {total_features}")

    with rasterio.open(rgb_tiff_path) as src_rgb, rasterio.open(ndvi_tiff_path) as src_ndvi:
        print(f"      Paleta NDVI : RdYlGn (Vermelho = Baixo | Amarelo = Médio | Verde = Alto)")
        print(f"      Intervalo   : vmin=0.15 (solo/baixo) até vmax=0.85 (alto vigor)")
        print("\n[3/4] Processando e colorindo recortes...")

        processados = 0
        arquivos_gerados = []

        for idx, feat in enumerate(features, start=1):
            props = feat.get("properties") or {}
            geom = feat.get("geometry")
            nome = props.get("Name") or f"Talhao_{idx}"
            talhao_id = normalizar_talhao_id(props)

            if not geom or geom.get("type") not in ["Polygon", "MultiPolygon"]:
                continue

            try:
                # 1. RGB Recente e Anterior
                rgba_rgb = recortar_rgb(src_rgb, geom)
                img_rgb = Image.fromarray(rgba_rgb, mode="RGBA")

                p_rgb_rec = out_dir / f"{talhao_id}_rgb_recente.png"
                img_rgb.save(p_rgb_rec, format="PNG", optimize=True)
                arquivos_gerados.append(p_rgb_rec)

                p_rgb_ant = out_dir / f"{talhao_id}_rgb_anterior.png"
                img_rgb.save(p_rgb_ant, format="PNG", optimize=True)
                arquivos_gerados.append(p_rgb_ant)

                # 2. NDVI RdYlGn Recente e Anterior
                rgba_ndvi, ndvi_vals = recortar_e_colorir_ndvi(src_ndvi, geom, vmin=0.15, vmax=0.85)
                img_ndvi = Image.fromarray(rgba_ndvi, mode="RGBA")

                p_ndvi_rec = out_dir / f"{talhao_id}_ndvi_recente.png"
                img_ndvi.save(p_ndvi_rec, format="PNG", optimize=True)
                arquivos_gerados.append(p_ndvi_rec)

                p_ndvi_ant = out_dir / f"{talhao_id}_ndvi_anterior.png"
                img_ndvi.save(p_ndvi_ant, format="PNG", optimize=True)
                arquivos_gerados.append(p_ndvi_ant)

                processados += 1
                h, w, _ = rgba_ndvi.shape
                tamanho_ndvi_kb = p_ndvi_rec.stat().st_size / 1024

                # Extrai estatísticas simples do talhão
                val_min = float(ndvi_vals.min())
                val_max = float(ndvi_vals.max())
                val_mean = float(ndvi_vals.mean())

                print(
                    f"  [{idx:02d}/{total_features:02d}] ✓ {talhao_id} ({nome}) -> "
                    f"{w}x{h}px | NDVI min={val_min:.2f}, med={val_mean:.2f}, max={val_max:.2f} | "
                    f"PNG: {tamanho_ndvi_kb:.1f}KB"
                )

            except Exception as e:
                print(f"  [X] Erro ao processar {nome} ({talhao_id}): {e}")

    print("\n[4/4] Conclusão da Regeneração dos Rasters:")
    print(f"  - Talhões processados: {processados}/{total_features}")
    print(f"  - Total de arquivos PNG em {out_dir}: {len(arquivos_gerados)}")
    total_bytes = sum(p.stat().st_size for p in arquivos_gerados if p.exists())
    print(f"  - Tamanho total leve: {total_bytes / (1024 * 1024):.2f} MB")
    print("=" * 70)


if __name__ == "__main__":
    main()
