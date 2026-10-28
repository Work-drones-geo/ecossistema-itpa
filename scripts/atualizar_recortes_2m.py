#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Atualização dos Recortes de Satélite (2 Metros) para WebGIS
Recorta o raster COG NDVI de 2m (aoi_ndvi_2m_cog.tif) pela geometria de cada talhão,
aplica a rampa agronômica RdYlGn (-0.1 a 0.85), aplica transparência alfa 100%
fora do polígono e substitui os arquivos PNG correspondentes em assets/satelite/.

Autor: Antigravity AI / Work Drones Geo
Projeto: Ecossistema ITPA - Restauração Florestal
"""

import os
import re
import sys
import json
import unicodedata
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from PIL import Image
import geopandas as gpd
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import geometry_mask


def normalizar_talhao_id(props: dict, fallback_idx: int = 1) -> str:
    """Gera o identificador padronizado para o talhão (ex: quadrante_1)."""
    id_val = props.get("id")
    if id_val:
        return str(id_val).strip().lower()

    nome = props.get("Name") or props.get("nome") or props.get("Nome") or ""
    match_quad = re.search(r"quadrante\s*(\d+)", nome, re.IGNORECASE)
    if match_quad:
        return f"quadrante_{match_quad.group(1)}"

    slug = re.sub(
        r"[^a-z0-9]+",
        "_",
        unicodedata.normalize("NFD", nome)
        .encode("ascii", "ignore")
        .decode("utf-8")
        .lower()
    ).strip("_")

    return slug or f"talhao_{fallback_idx}"


def main():
    print("=" * 75)
    print("   ECOSSISTEMA ITPA - ATUALIZAÇÃO DOS RECORTES NDVI 2M (WEBGIS)")
    print("=" * 75)

    base_dir = Path(__file__).resolve().parent.parent
    raster_cog_path = base_dir / "assets" / "satelite" / "aoi_ndvi_2m_cog.tif"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    out_dir = base_dir / "assets" / "satelite"

    if not raster_cog_path.exists():
        raise FileNotFoundError(f"Raster COG 2m não localizado: {raster_cog_path}")
    if not vetor_path.exists():
        alt_vetor = base_dir / "DATA" / "KMLs.geojson"
        if alt_vetor.exists():
            vetor_path = alt_vetor
        else:
            raise FileNotFoundError(f"Vetor de talhões não localizado em DATA/: {vetor_path}")

    print(f"\n[1/3] Parâmetros de Entrada:")
    print(f"  - Raster NDVI 2m (COG) : {raster_cog_path.name}")
    print(f"  - Vetor de Talhões     : {vetor_path.name}")
    print(f"  - Diretório de Destino : {out_dir}")

    # Carrega camada vetorial
    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    print(f"\n[2/3] Total de talhões/quadrantes para processamento: {total_talhoes}")

    vmin = -0.10
    vmax = 0.85
    cmap = plt.colormaps['RdYlGn']

    print(f"  - Rampa Espectral: RdYlGn (Normalização vmin={vmin:.2f} a vmax={vmax:.2f})")
    print(f"  - Vermelho: Baixo vigor / Solo exposto (NDVI <= {vmin})")
    print(f"  - Amarelo : Transição / Vigor moderado (NDVI ~ 0.38)")
    print(f"  - Verde   : Alto vigor vegetal / Floresta densa (NDVI >= {vmax})")
    print(f"  - Fundo   : Transparência alfa 100% (RGBA, A=0)")
    print("\n[3/3] Processando recortes a 2 metros pixel a pixel...")

    # Resolução angular aproximada para 2.0 metros na latitude local (-22.7°)
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    arquivos_atualizados = []
    processados = 0

    with rasterio.open(raster_cog_path) as src:
        src_crs = src.crs

        for idx, row in gdf.iterrows():
            geom = row.geometry
            props = row.to_dict()
            talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)
            nome_talhao = props.get("Name") or talhao_id

            if not geom or geom.is_empty:
                continue

            try:
                minx, miny, maxx, maxy = geom.bounds

                # Dimensões exatas da grade com base na resolução de 2 metros
                width = max(1, int(round((maxx - minx) / res_lon_deg)))
                height = max(1, int(round((maxy - miny) / res_lat_deg)))

                # Transformada afim precisa para o bounding box do talhão no Leaflet (EPSG:4326)
                dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

                # Reprojeta os dados de NDVI 2m diretamente para o grid do envelope
                dst_ndvi = np.full((height, width), np.nan, dtype=np.float32)
                reproject(
                    source=rasterio.band(src, 1),
                    destination=dst_ndvi,
                    src_crs=src_crs,
                    dst_crs="EPSG:4326",
                    dst_transform=dst_transform,
                    resampling=Resampling.bilinear
                )

                # Máscara binária exata do polígono do talhão
                mask_inside = geometry_mask(
                    [geom],
                    out_shape=(height, width),
                    transform=dst_transform,
                    invert=True,
                    all_touched=True
                )

                # Normalização e aplicação da Rampa RdYlGn
                ndvi_norm = np.clip((dst_ndvi - vmin) / (vmax - vmin), 0.0, 1.0)
                colored_rgba = cmap(ndvi_norm)

                r_col = (colored_rgba[:, :, 0] * 255).astype(np.uint8)
                g_col = (colored_rgba[:, :, 1] * 255).astype(np.uint8)
                b_col = (colored_rgba[:, :, 2] * 255).astype(np.uint8)

                # Canal Alfa: 255 somente dentro do polígono e onde o NDVI for numérico válido
                valid_mask = mask_inside & np.isfinite(dst_ndvi)
                alpha = np.where(valid_mask, 255, 0).astype(np.uint8)

                r_final = np.where(valid_mask, r_col, 0).astype(np.uint8)
                g_final = np.where(valid_mask, g_col, 0).astype(np.uint8)
                b_final = np.where(valid_mask, b_col, 0).astype(np.uint8)

                rgba = np.dstack([r_final, g_final, b_final, alpha])
                img = Image.fromarray(rgba, mode="RGBA")

                # Salva o arquivo recente
                p_recente = out_dir / f"{talhao_id}_ndvi_recente.png"
                img.save(p_recente, format="PNG", optimize=True)
                arquivos_atualizados.append(p_recente)

                # Atualiza também o arquivo anterior para coerência visual
                p_anterior = out_dir / f"{talhao_id}_ndvi_anterior.png"
                img.save(p_anterior, format="PNG", optimize=True)
                arquivos_atualizados.append(p_anterior)

                processados += 1
                size_kb = p_recente.stat().st_size / 1024

                # Métricas do talhão
                pixels_validos = dst_ndvi[valid_mask]
                val_min = float(pixels_validos.min()) if len(pixels_validos) > 0 else 0.0
                val_mean = float(pixels_validos.mean()) if len(pixels_validos) > 0 else 0.0
                val_max = float(pixels_validos.max()) if len(pixels_validos) > 0 else 0.0

                print(
                    f"  [{processados:02d}/{total_talhoes:02d}] ✓ {talhao_id} ({nome_talhao}) -> "
                    f"{width}x{height}px | NDVI min={val_min:.2f}, med={val_mean:.2f}, max={val_max:.2f} | "
                    f"PNG: {size_kb:.1f} KB"
                )

            except Exception as e:
                print(f"  [X] Erro ao processar {nome_talhao} ({talhao_id}): {e}")

    print("\n" + "=" * 75)
    print(f"  Conclusão: {processados}/{total_talhoes} talhões atualizados com sucesso a 2 metros!")
    print(f"  Total de arquivos PNG sobrescritos em assets/satelite: {len(arquivos_atualizados)}")
    total_mb = sum(p.stat().st_size for p in arquivos_atualizados) / (1024 * 1024)
    print(f"  Tamanho total das imagens PNG geradas: {total_mb:.2f} MB")
    print("=" * 75)


if __name__ == "__main__":
    main()
