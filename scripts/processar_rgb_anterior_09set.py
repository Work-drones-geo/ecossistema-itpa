#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Pipeline da Cena Anterior RGB (09/Set) a 2 Metros
Work Drones Geo / Antigravity AI

1. Baixa as bandas B04 (Red), B03 (Green), B02 (Blue) da cena Sentinel-2 L2A oficial:
   S2A_23KPQ_20240909_0_L2A (09/Set/2024, 0.02% nuvens - céus limpos).
2. Reprojeta para a grade da AOI em UTM 23S e salva 'aoi_envelope_crop_anterior_10m.tif'.
3. Aplica Super-Resolução (10m -> 2m) gerando 'aoi_super_resolved_anterior_2m.tif' (2945 x 2005 px).
4. Aplica Calibração Radiométrica Uniforme Sentinel-2 BOA sem estouro de verde (tons naturais de dossel).
5. Recorta os 15 talhões (WGS84 EPSG:4326) salvando em 'assets/satelite/{talhao_id}_rgb_anterior.png'
   com canal alfa 100% transparente fora do perímetro.
"""

import os
import re
import sys
import json
import urllib.request
import unicodedata
from pathlib import Path

# Configura diretório temporário para matplotlib evitar avisos no Windows
os.environ["MPLCONFIGDIR"] = os.path.join(os.environ.get("TEMP", "C:/Temp"), "mpl_itpa")

import numpy as np
from PIL import Image
import geopandas as gpd
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import geometry_mask


def normalizar_talhao_id(props: dict, fallback_idx: int = 1) -> str:
    """Gera identificador padronizado para o talhão (ex: quadrante_1)."""
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
    print("=" * 80)
    print("   ECOSSISTEMA ITPA - PROCESSAMENTO DE CENA ANTERIOR RGB 2M (09/SET/2024)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    assets_satelite_dir = base_dir / "assets" / "satelite"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    ref_crop_path = assets_satelite_dir / "aoi_envelope_crop_10m.tif"

    if not ref_crop_path.exists():
        raise FileNotFoundError(f"Arquivo de referência 10m não localizado: {ref_crop_path}")
    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor de talhões não localizado: {vetor_path}")

    # 1. Metadados de referência da grade do projeto (UTM 23S)
    with rasterio.open(ref_crop_path) as ref_ds:
        ref_crs = ref_ds.crs
        ref_transform = ref_ds.transform
        ref_bounds = ref_ds.bounds
        ref_width = ref_ds.width
        ref_height = ref_ds.height
        ref_meta = ref_ds.meta.copy()

    print(f"\n[1/5] Grade de Referência da AOI (UTM 23S):")
    print(f"  - Extensão : left={ref_bounds.left:.1f}, bottom={ref_bounds.bottom:.1f}, right={ref_bounds.right:.1f}, top={ref_bounds.top:.1f}")
    print(f"  - Dimensões: {ref_width} x {ref_height} pixels (10m)")

    # 2. URLs oficiais da passagem de 09/Set/2024 (S2A_23KPQ_20240909_0_L2A)
    # AWS Earth Search / Sentinel COGs (Open Data Registry)
    base_aws_cog = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/23/K/PQ/2024/9/S2A_23KPQ_20240909_0_L2A"
    band_urls = {
        "B04": f"{base_aws_cog}/B04.tif",  # Red
        "B03": f"{base_aws_cog}/B03.tif",  # Green
        "B02": f"{base_aws_cog}/B02.tif",  # Blue
        "B08": f"{base_aws_cog}/B08.tif",  # NIR
    }

    print("\n[2/5] Lendo bandas B04, B03, B02 da passagem de 09/Set/2024...")
    band_arrays = {}

    for b_name in ["B04", "B03", "B02", "B08"]:
        url = band_urls[b_name]
        print(f"  - Baixando janela COG da banda {b_name}...")
        try:
            with rasterio.open(url) as b_ds:
                dst_arr = np.zeros((ref_height, ref_width), dtype=np.float32)
                reproject(
                    source=rasterio.band(b_ds, 1),
                    destination=dst_arr,
                    src_transform=b_ds.transform,
                    src_crs=b_ds.crs,
                    dst_transform=ref_transform,
                    dst_crs=ref_crs,
                    resampling=Resampling.bilinear
                )
                band_arrays[b_name] = dst_arr
        except Exception as e:
            print(f"    [!] Erro na leitura direta de {url}: {e}")
            # Fallback para o raster 10m já gravado se existir
            crop_ant_local = assets_satelite_dir / "aoi_envelope_crop_anterior_10m.tif"
            if crop_ant_local.exists():
                print(f"    -> Recuperando banda do cache local: {crop_ant_local.name}")
                with rasterio.open(crop_ant_local) as local_ds:
                    idx_map = {"B04": 1, "B03": 2, "B02": 3, "B08": 4}
                    band_arrays[b_name] = local_ds.read(idx_map[b_name])
            else:
                raise RuntimeError(f"Impossível carregar a banda {b_name}: {e}")

    # Salva o raster 10m consolidado de 4 bandas
    crop_anterior_10m_path = assets_satelite_dir / "aoi_envelope_crop_anterior_10m.tif"
    meta_4b = ref_meta.copy()
    meta_4b.update({
        "count": 4,
        "dtype": "float32",
        "nodata": None
    })
    with rasterio.open(crop_anterior_10m_path, "w", **meta_4b) as dst_10m:
        dst_10m.write(band_arrays["B04"], 1)
        dst_10m.write(band_arrays["B03"], 2)
        dst_10m.write(band_arrays["B02"], 3)
        dst_10m.write(band_arrays["B08"], 4)
        dst_10m.set_band_description(1, "B04_Red")
        dst_10m.set_band_description(2, "B03_Green")
        dst_10m.set_band_description(3, "B02_Blue")
        dst_10m.set_band_description(4, "B08_NIR")

    print(f"  ✓ Raster 10m consolidado (B04, B03, B02, B08): {crop_anterior_10m_path.name}")

    # 3. Super-Resolução (10m -> 2m, fator 5x)
    print("\n[3/5] Aplicando Super-Resolução a 2 Metros (10m -> 2m, fator 5x)...")
    sr_anterior_2m_path = assets_satelite_dir / "aoi_super_resolved_anterior_2m.tif"
    sr_width = ref_width * 5    # 2945
    sr_height = ref_height * 5  # 2005
    sr_transform = rasterio.Affine(
        ref_transform.a / 5.0, ref_transform.b, ref_transform.c,
        ref_transform.d, ref_transform.e / 5.0, ref_transform.f
    )

    # Super-resolução com interpolação espectral cúbica conservativa
    sr_bands = {}
    for b_name in ["B04", "B03", "B02"]:
        resampled = np.zeros((sr_height, sr_width), dtype=np.float32)
        reproject(
            source=band_arrays[b_name],
            destination=resampled,
            src_transform=ref_transform,
            src_crs=ref_crs,
            dst_transform=sr_transform,
            dst_crs=ref_crs,
            resampling=Resampling.cubic
        )
        sr_bands[b_name] = resampled

    # 4. Calibração Proporcional Uniforme Sentinel-2 BOA
    # Fórmula: reflectancia = raw_band / 10000.0
    # Multiplicador uniforme para evitar estouro de verde e manter tom natural de dossel
    print("\n[4/5] Calibrando radiometria True Color (Ganho Uniforme)...")
    refl_r = sr_bands["B04"] / 10000.0
    refl_g = sr_bands["B03"] / 10000.0
    refl_b = sr_bands["B02"] / 10000.0

    # Ganho uniforme calibrado para o dossel da Mata Atlântica
    gain_uniforme = 255.0 / 0.145

    r_byte = np.clip(np.round(refl_r * gain_uniforme), 0, 255).astype(np.uint8)
    g_byte = np.clip(np.round(refl_g * gain_uniforme), 0, 255).astype(np.uint8)
    b_byte = np.clip(np.round(refl_b * gain_uniforme), 0, 255).astype(np.uint8)

    # Salva o raster consolidado de 3 bandas a 2m
    meta_rgb_3b = ref_meta.copy()
    meta_rgb_3b.update({
        "width": sr_width,
        "height": sr_height,
        "transform": sr_transform,
        "count": 3,
        "dtype": "uint8",
        "nodata": None
    })

    with rasterio.open(sr_anterior_2m_path, "w", **meta_rgb_3b) as dst_sr:
        dst_sr.write(r_byte, 1)
        dst_sr.write(g_byte, 2)
        dst_sr.write(b_byte, 3)
        dst_sr.set_band_description(1, "B04_Red")
        dst_sr.set_band_description(2, "B03_Green")
        dst_sr.set_band_description(3, "B02_Blue")

    print(f"  ✓ Raster mestre consolidado gerado: {sr_anterior_2m_path.name}")
    print(f"    - Dimensões : {sr_width} x {sr_height} pixels (2.0 metros/pixel)")
    print(f"    - Médias RGB: R={r_byte.mean():.1f}, G={g_byte.mean():.1f}, B={b_byte.mean():.1f} (Dossel Natural)")

    # 5. Recorte dos Talhões (WGS84 EPSG:4326) em PNG com Alfa Transparente
    print("\n[5/5] Exportando recortes dos 15 talhões como imagens '_rgb_anterior.png'...")
    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)

    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    with rasterio.open(sr_anterior_2m_path) as src_sr:
        for idx, row in gdf.iterrows():
            geom = row.geometry
            props = row.to_dict()
            talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)
            nome_talhao = props.get("Name") or props.get("nome") or props.get("Nome") or f"Quadrante {idx+1}"

            if not geom or geom.is_empty:
                continue

            minx, miny, maxx, maxy = geom.bounds
            width = max(1, int(round((maxx - minx) / res_lon_deg)))
            height = max(1, int(round((maxy - miny) / res_lat_deg)))
            dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

            # Reprojeta cada canal para o envelope do talhão
            r_crop = np.zeros((height, width), dtype=np.uint8)
            g_crop = np.zeros((height, width), dtype=np.uint8)
            b_crop = np.zeros((height, width), dtype=np.uint8)

            reproject(rasterio.band(src_sr, 1), r_crop, src_crs=src_sr.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_sr, 2), g_crop, src_crs=src_sr.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_sr, 3), b_crop, src_crs=src_sr.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)

            # Máscara vetorial exata do talhão
            mask_inside = geometry_mask(
                [geom],
                out_shape=(height, width),
                transform=dst_transform,
                invert=True,
                all_touched=True
            )

            # Canal Alfa: 255 dentro do talhão e onde houver dados válidos, 0 fora
            valid = mask_inside & ((r_crop > 0) | (g_crop > 0) | (b_crop > 0))
            alpha = np.where(valid, 255, 0).astype(np.uint8)

            r_final = np.where(valid, r_crop, 0).astype(np.uint8)
            g_final = np.where(valid, g_crop, 0).astype(np.uint8)
            b_final = np.where(valid, b_crop, 0).astype(np.uint8)

            rgba = np.dstack([r_final, g_final, b_final, alpha])
            img = Image.fromarray(rgba, mode="RGBA")

            out_path = assets_satelite_dir / f"{talhao_id}_rgb_anterior.png"
            img.save(out_path, format="PNG", optimize=True)

            print(f"  [{idx+1:02d}/{total_talhoes:02d}] ✓ {talhao_id:15s} -> {out_path.name} ({width}x{height}px)")

    print("\n" + "=" * 80)
    print("   ✓ CENA ANTERIOR RGB 2M (09/SET) PROCESSADA COM SUCESSO!")
    print("=" * 80)


if __name__ == "__main__":
    main()
