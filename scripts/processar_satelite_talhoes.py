#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Processamento e Recorte Automatizado de Rasters Sentinel-2
Recorta imagens Sentinel-2 (RGB True Color e NDVI) na geometria exata de cada talhão/quadrante,
gerando overlays georreferenciados em PNG com canal alfa (transparência externa)
otimizados para exibição no Leaflet.
"""

import os
import re
import sys
import glob
import json
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.mask import mask
from rasterio.features import geometry_mask


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

        # Busca True Color
        if not rgb_tiff:
            rgb_matches = list(base_dir.glob("*Sentinel-2*True_color*.tiff")) + \
                          list(base_dir.glob("*True_color*.tif*")) + \
                          list(base_dir.glob("*RGB*.tif*"))
            if rgb_matches:
                rgb_tiff = rgb_matches[0].resolve()

        # Busca NDVI
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


def recortar_raster_por_geometria(src_dataset, geom):
    """
    Recorta o raster pela geometria exata e retorna array RGBA uint8 e novo transform.
    Pixels fora do polígono recebem alfa = 0 (transparência total).
    """
    # 1. Recorta no bounding box da geometria
    out_image, out_transform = mask(src_dataset, [geom], crop=True, all_touched=True)

    # 2. Gera máscara binária do polígono (True = dentro do polígono)
    _, height, width = out_image.shape
    mask_inside = geometry_mask(
        [geom],
        out_shape=(height, width),
        transform=out_transform,
        invert=True,
        all_touched=True
    )

    # 3. Extrai bandas RGB
    if out_image.shape[0] >= 3:
        r = out_image[0]
        g = out_image[1]
        b = out_image[2]
    elif out_image.shape[0] == 1:
        # Se for mono-banda, replica em escala de cinza
        r = g = b = out_image[0]
    else:
        raise ValueError(f"Número de bandas inesperado: {out_image.shape[0]}")

    # Garante tipo uint8
    if r.dtype != np.uint8:
        # Se float, normaliza para 0..255
        r_min, r_max = float(r.min()), float(r.max())
        if r_max > r_min:
            r = ((r - r_min) / (r_max - r_min) * 255).astype(np.uint8)
            g = ((g - r_min) / (r_max - r_min) * 255).astype(np.uint8)
            b = ((b - r_min) / (r_max - r_min) * 255).astype(np.uint8)
        else:
            r = g = b = r.astype(np.uint8)

    # 4. Canal Alfa: 255 dentro do polígono, 0 fora
    alpha = np.where(mask_inside, 255, 0).astype(np.uint8)

    # Zera valores RGB fora do polígono para compressão máxima no PNG
    r = np.where(mask_inside, r, 0).astype(np.uint8)
    g = np.where(mask_inside, g, 0).astype(np.uint8)
    b = np.where(mask_inside, b, 0).astype(np.uint8)

    rgba = np.dstack([r, g, b, alpha])
    return rgba, out_transform


def main():
    print("=" * 65)
    print("  Ecossistema ITPA - Pipeline de Recorte Sentinel-2 (RGB & NDVI)")
    print("=" * 65)

    vetor_path, rgb_tiff_path, ndvi_tiff_path = localizar_arquivos_entrada()
    print(f"[1/4] Vetor de Talhões : {vetor_path}")
    print(f"[1/4] Raster RGB       : {rgb_tiff_path}")
    print(f"[1/4] Raster NDVI      : {ndvi_tiff_path}")

    # Cria pasta de saída
    out_dir = Path("assets/satelite")
    out_dir.mkdir(parents=True, exist_ok=True)

    # Lê o GeoJSON
    with open(vetor_path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    features = geojson.get("features", [])
    total_features = len(features)
    print(f"\n[2/4] Total de talhões/quadrantes encontrados: {total_features}")

    # Abre os datasets Sentinel-2
    with rasterio.open(rgb_tiff_path) as src_rgb, rasterio.open(ndvi_tiff_path) as src_ndvi:
        print(f"      CRS RGB  : {src_rgb.crs} | Dimensões: {src_rgb.width}x{src_rgb.height}")
        print(f"      CRS NDVI : {src_ndvi.crs} | Dimensões: {src_ndvi.width}x{src_ndvi.height}")
        print("\n[3/4] Iniciando recorte por talhão...")

        processados = 0
        arquivos_gerados = []

        for idx, feat in enumerate(features, start=1):
            props = feat.get("properties") or {}
            geom = feat.get("geometry")
            nome = props.get("Name") or f"Talhao_{idx}"
            talhao_id = normalizar_talhao_id(props)

            if not geom or geom.get("type") not in ["Polygon", "MultiPolygon"]:
                print(f"  [!] Ignorando {nome}: Geometria inválida ou ausente.")
                continue

            try:
                # 1. Recorte RGB
                rgba_rgb, _ = recortar_raster_por_geometria(src_rgb, geom)
                img_rgb = Image.fromarray(rgba_rgb, mode="RGBA")
                out_rgb_recente = out_dir / f"{talhao_id}_rgb_recente.png"
                img_rgb.save(out_rgb_recente, format="PNG", optimize=True)
                arquivos_gerados.append(out_rgb_recente)

                # Cópia para passagem anterior (-15d) garantindo que ambas as camadas funcionem
                out_rgb_anterior = out_dir / f"{talhao_id}_rgb_anterior.png"
                img_rgb.save(out_rgb_anterior, format="PNG", optimize=True)
                arquivos_gerados.append(out_rgb_anterior)

                # 2. Recorte NDVI
                rgba_ndvi, _ = recortar_raster_por_geometria(src_ndvi, geom)
                img_ndvi = Image.fromarray(rgba_ndvi, mode="RGBA")
                out_ndvi_recente = out_dir / f"{talhao_id}_ndvi_recente.png"
                img_ndvi.save(out_ndvi_recente, format="PNG", optimize=True)
                arquivos_gerados.append(out_ndvi_recente)

                # Cópia para passagem anterior (-15d)
                out_ndvi_anterior = out_dir / f"{talhao_id}_ndvi_anterior.png"
                img_ndvi.save(out_ndvi_anterior, format="PNG", optimize=True)
                arquivos_gerados.append(out_ndvi_anterior)

                processados += 1
                h, w, _ = rgba_rgb.shape
                tamanho_rgb_kb = out_rgb_recente.stat().st_size / 1024
                tamanho_ndvi_kb = out_ndvi_recente.stat().st_size / 1024

                print(
                    f"  [{idx:02d}/{total_features:02d}] ✓ {talhao_id} ({nome}) -> "
                    f"{w}x{h}px | RGB: {tamanho_rgb_kb:.1f}KB | NDVI: {tamanho_ndvi_kb:.1f}KB"
                )

            except Exception as e:
                print(f"  [X] Erro ao processar {nome} ({talhao_id}): {e}")

    print("\n[4/4] Conclusão:")
    print(f"  - Total de talhões processados com sucesso: {processados}/{total_features}")
    print(f"  - Total de arquivos PNG gerados em {out_dir}: {len(arquivos_gerados)}")

    # Calcula tamanho total gerado
    total_bytes = sum(p.stat().st_size for p in arquivos_gerados if p.exists())
    print(f"  - Tamanho total leve otimizado: {total_bytes / (1024 * 1024):.2f} MB")
    print("=" * 65)


if __name__ == "__main__":
    main()
