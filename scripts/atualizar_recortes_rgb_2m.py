#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Atualização dos Recortes Sentinel-2 RGB True Color (2 Metros) para WebGIS
Work Drones Geo / Antigravity AI

Recorta as imagens orbitais super-resolvidas a 2 metros (aoi_super_resolved_2m.tif e anterior)
pela geometria de cada talhão, aplicando:
1. Composição estrita True Color: Red (B04), Green (B03), Blue (B02).
2. Estiramento radiométrico por percentil (p2 a p98) por canal calibrado na AOI.
3. Proteção do piso de sombras e margem superior contra clipping em picos de luz.
4. Correção gama suave (gamma = 1.15) para preservação de tons naturais de dossel florestal.
5. Transparência alfa total fora do contorno poligonal (RGBA, A=0).
"""

import os
import re
import sys
import unicodedata
from pathlib import Path

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
    print("=" * 75)
    print("   ECOSSISTEMA ITPA - RECORTES SENTINEL-2 RGB TRUE COLOR 2M (CALIBRADO)")
    print("=" * 75)

    base_dir = Path(__file__).resolve().parent.parent
    assets_dir = base_dir / "assets" / "satelite"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"

    raster_recente = assets_dir / "aoi_super_resolved_2m.tif"
    raster_anterior = assets_dir / "aoi_super_resolved_anterior_2m.tif"

    if not raster_recente.exists():
        raise FileNotFoundError(f"Raster super-resolvido 2m não localizado: {raster_recente}")
    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor de talhões não localizado: {vetor_path}")

    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    print(f"\nTotal de talhões para processamento: {total_talhoes}")

    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    def processar_cena(raster_path, sufixo_tipo, gamma=1.15):
        print(f"\nProcessando {sufixo_tipo} ({raster_path.name})...")
        with rasterio.open(raster_path) as ds:
            src_crs = ds.crs

            r_all = ds.read(1) # B04
            g_all = ds.read(2) # B03
            b_all = ds.read(3) # B02

            valid_scene = (r_all > 0) & (g_all > 0) & (b_all > 0) & np.isfinite(r_all) & np.isfinite(g_all) & np.isfinite(b_all)
            r_vals = r_all[valid_scene]
            g_vals = g_all[valid_scene]
            b_vals = b_all[valid_scene]

            p2_r, p98_r = np.percentile(r_vals, [2, 98])
            p2_g, p98_g = np.percentile(g_vals, [2, 98])
            p2_b, p98_b = np.percentile(b_vals, [2, 98])

            p2_base = min(p2_r, p2_g, p2_b)
            p98_r_safe = p98_r * 1.08
            p98_g_safe = p98_g * 1.08
            p98_b_safe = p98_b * 1.08

            gdf_wgs84 = gdf.to_crs("EPSG:4326")

            for idx, row in gdf_wgs84.iterrows():
                geom = row.geometry
                props = row.to_dict()
                talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)

                minx, miny, maxx, maxy = geom.bounds
                width = max(1, int(round((maxx - minx) / res_lon_deg)))
                height = max(1, int(round((maxy - miny) / res_lat_deg)))

                dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

                r_crop = np.full((height, width), np.nan, dtype=np.float32)
                g_crop = np.full((height, width), np.nan, dtype=np.float32)
                b_crop = np.full((height, width), np.nan, dtype=np.float32)

                reproject(rasterio.band(ds, 1), r_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(ds, 2), g_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(ds, 3), b_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)

                mask_inside = geometry_mask(
                    [geom],
                    out_shape=(height, width),
                    transform=dst_transform,
                    invert=True,
                    all_touched=True
                )

                valid_mask = mask_inside & np.isfinite(r_crop) & np.isfinite(g_crop) & np.isfinite(b_crop) & (r_crop > 0) & (g_crop > 0) & (b_crop > 0)

                r_norm = np.clip((r_crop - p2_base) / max(p98_r_safe - p2_base, 1e-5), 0.0, 1.0)
                g_norm = np.clip((g_crop - p2_base) / max(p98_g_safe - p2_base, 1e-5), 0.0, 1.0)
                b_norm = np.clip((b_crop - p2_base) / max(p98_b_safe - p2_base, 1e-5), 0.0, 1.0)

                r_gamma = np.power(r_norm, 1.0 / gamma)
                g_gamma = np.power(g_norm, 1.0 / gamma)
                b_gamma = np.power(b_norm, 1.0 / gamma)

                r_byte = np.where(valid_mask, np.round(r_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)
                g_byte = np.where(valid_mask, np.round(g_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)
                b_byte = np.where(valid_mask, np.round(b_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)
                alpha_byte = np.where(valid_mask, 255, 0).astype(np.uint8)

                rgba = np.dstack([r_byte, g_byte, b_byte, alpha_byte])
                img = Image.fromarray(rgba, mode="RGBA")

                out_path = assets_dir / f"{talhao_id}_{sufixo_tipo}.png"
                img.save(out_path, format="PNG", optimize=True)

            print(f"  ✓ 15 recortes '{sufixo_tipo}' salvos em assets/satelite/")

    processar_cena(raster_recente, "rgb_recente", gamma=1.15)
    if raster_anterior.exists():
        processar_cena(raster_anterior, "rgb_anterior", gamma=1.15)

    print("\n" + "=" * 75)
    print("   ✓ RECORTES RGB TRUE COLOR 2M CONCLUÍDOS!")
    print("=" * 75)


if __name__ == "__main__":
    main()
