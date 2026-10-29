#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Reprocessamento de Cenas Sentinel-2 com Buffer Expandido (18%)
Garante cobertura total sem corte nos talhões do Norte.

1. Bounding Box Expandido (18% de margem geográfica):
   bbox = talhoes_gdf.total_bounds
   buffer = (bbox[2] - bbox[0]) * 0.18
   bbox_expandido = [bbox[0] - buffer, bbox[1] - buffer, bbox[2] + buffer, bbox[3] + buffer]

2. Geração dos 4 Rasters Mestres Consolidados (2 Metros / EPSG:4326):
   - aoi_ndvi_recente_2m.png    (leftPane)
   - aoi_rgb_recente_2m.png     (leftPane)
   - aoi_ndvi_anterior_2m.png   (rightPane)
   - aoi_rgb_anterior_2m.png    (rightPane)

3. Regeneração dos 15 Recortes por Talhão ({talhao_id}_...png) para Ficha Técnica e Popups.
4. Exportação das coordenadas de alinhamento para o Leaflet em bounds_expandido.json.
"""

import os
import re
import sys
import json
import unicodedata
from pathlib import Path

# Configura diretório temporário para matplotlib no Windows
os.environ["MPLCONFIGDIR"] = os.path.join(os.environ.get("TEMP", "C:/Temp"), "mpl_itpa")

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image
import geopandas as gpd
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import geometry_mask

# Tabela de calibração espectral Sentinel-2 NDVI
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
    print("   ECOSSISTEMA ITPA - REPROCESSAMENTO COM BUFFER EXPANDIDO (18%)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    assets_dir = base_dir / "assets" / "satelite"
    dados_satelite_dir = base_dir / "dados_satelite"

    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor não encontrado: {vetor_path}")

    # 1. Carrega camada de talhões
    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    bbox = gdf.total_bounds  # [minx, miny, maxx, maxy] em EPSG:4326

    # 2. Buffer Geográfico de 18% (entre 15% e 20% conforme instrução)
    width_deg = bbox[2] - bbox[0]
    buffer_deg = width_deg * 0.18
    bbox_expandido = [
        float(bbox[0] - buffer_deg),
        float(bbox[1] - buffer_deg),
        float(bbox[2] + buffer_deg),
        float(bbox[3] + buffer_deg)
    ]
    lng_min_exp, lat_min_exp, lng_max_exp, lat_max_exp = bbox_expandido

    print(f"\n[1/6] Bounding Box dos Talhões e Expansão:")
    print(f"  - BBox Original : minX={bbox[0]:.6f}, minY={bbox[1]:.6f}, maxX={bbox[2]:.6f}, maxY={bbox[3]:.6f}")
    print(f"  - Buffer (18%)  : {buffer_deg:.6f}° (~{buffer_deg * 110750:.1f} metros)")
    print(f"  - BBox Expandido: minX={lng_min_exp:.6f}, minY={lat_min_exp:.6f}, maxX={lng_max_exp:.6f}, maxY={lat_max_exp:.6f}")
    print(f"  - Sobra Norte   : {lat_max_exp - bbox[3]:.6f}° (~{(lat_max_exp - bbox[3]) * 110750:.1f} m acima do talhão norte)")

    # 3. Grade de Destino (EPSG:4326 a 2 metros/pixel)
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))
    out_width = int(round((lng_max_exp - lng_min_exp) / res_lon_deg))
    out_height = int(round((lat_max_exp - lat_min_exp) / res_lat_deg))
    dst_transform = rasterio.transform.from_bounds(lng_min_exp, lat_min_exp, lng_max_exp, lat_max_exp, out_width, out_height)

    print(f"\n[2/6] Dimensões da Grade 2M Expandida:")
    print(f"  - Dimensões : {out_width} x {out_height} pixels (2.0 metros/pixel)")
    print(f"  - Transform : {dst_transform}")

    # Cria máscara vetorial unificada de todos os talhões
    geoms = [geom for geom in gdf.geometry if geom and not geom.is_empty]
    mask_talhoes = geometry_mask(geoms, out_shape=(out_height, out_width), transform=dst_transform, invert=True, all_touched=True)
    print(f"  - Pixels dentro dos talhões: {np.count_nonzero(mask_talhoes)} pixels")

    # Colormap NDVI Fixo [0.10, 0.80] RdYlGn
    vmin = 0.10
    vmed = 0.40
    vmax = 0.80
    pos_med = (vmed - vmin) / (vmax - vmin)
    cores_ndvi = [
        (0.0, "#d73027"),      # Min (0.10): Vermelho / Solo exposto
        (pos_med, "#ffffbf"),  # Médio (0.40): Amarelo / Transição
        (1.0, "#006837")       # Max (0.80): Verde-escuro / Dossel fechado
    ]
    cmap_ndvi_fixo = LinearSegmentedColormap.from_list("NDVI_ITPA_Fixo", cores_ndvi)

    # 4. Processamento da CENA ANTERIOR (09/Set/2024 - S2A_23KPQ_20240909_0_L2A)
    print("\n[3/6] Processando Cena Anterior (09/Set/2024) com BBox Expandido...")
    base_aws_cog = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/23/K/PQ/2024/9/S2A_23KPQ_20240909_0_L2A"
    band_urls = {
        "B04": f"{base_aws_cog}/B04.tif",
        "B03": f"{base_aws_cog}/B03.tif",
        "B02": f"{base_aws_cog}/B02.tif",
        "B08": f"{base_aws_cog}/B08.tif",
    }
    sr_bands_ant = {}
    for b_name in ["B04", "B03", "B02", "B08"]:
        url = band_urls[b_name]
        print(f"  - Lendo banda {b_name} (AWS COG)...")
        with rasterio.open(url) as b_ds:
            dst_arr = np.zeros((out_height, out_width), dtype=np.float32)
            reproject(
                source=rasterio.band(b_ds, 1),
                destination=dst_arr,
                src_transform=b_ds.transform,
                src_crs=b_ds.crs,
                dst_transform=dst_transform,
                dst_crs="EPSG:4326",
                resampling=Resampling.cubic
            )
            sr_bands_ant[b_name] = dst_arr

    # a) RGB Anterior (Ganho BOA Uniforme)
    gain_boa = 255.0 / 0.145
    r_ant = np.clip(np.round((sr_bands_ant["B04"] / 10000.0) * gain_boa), 0, 255).astype(np.uint8)
    g_ant = np.clip(np.round((sr_bands_ant["B03"] / 10000.0) * gain_boa), 0, 255).astype(np.uint8)
    b_ant = np.clip(np.round((sr_bands_ant["B02"] / 10000.0) * gain_boa), 0, 255).astype(np.uint8)

    val_ant = mask_talhoes & ((r_ant > 0) | (g_ant > 0) | (b_ant > 0))
    alpha_rgb_ant = np.where(val_ant, 255, 0).astype(np.uint8)
    r_ant_f = np.where(val_ant, r_ant, 0).astype(np.uint8)
    g_ant_f = np.where(val_ant, g_ant, 0).astype(np.uint8)
    b_ant_f = np.where(val_ant, b_ant, 0).astype(np.uint8)
    img_rgb_ant = Image.fromarray(np.dstack([r_ant_f, g_ant_f, b_ant_f, alpha_rgb_ant]), mode="RGBA")
    path_rgb_ant = assets_dir / "aoi_rgb_anterior_2m.png"
    img_rgb_ant.save(path_rgb_ant, format="PNG", optimize=True)
    print(f"  ✓ Exportado: {path_rgb_ant.name} ({out_width}x{out_height})")

    # b) NDVI Anterior
    b08_ant = sr_bands_ant["B08"]
    b04_ant = sr_bands_ant["B04"]
    ndvi_ant = np.where((b08_ant + b04_ant) > 0, (b08_ant - b04_ant) / (b08_ant + b04_ant + 1e-7), np.nan)
    val_ndvi_ant = mask_talhoes & np.isfinite(ndvi_ant) & (ndvi_ant > 0.05)

    ndvi_ant_norm = np.clip((ndvi_ant - vmin) / (vmax - vmin), 0.0, 1.0)
    col_ndvi_ant = cmap_ndvi_fixo(ndvi_ant_norm)
    r_ndvi_ant = np.where(val_ndvi_ant, (col_ndvi_ant[:, :, 0] * 255).astype(np.uint8), 0).astype(np.uint8)
    g_ndvi_ant = np.where(val_ndvi_ant, (col_ndvi_ant[:, :, 1] * 255).astype(np.uint8), 0).astype(np.uint8)
    b_ndvi_ant = np.where(val_ndvi_ant, (col_ndvi_ant[:, :, 2] * 255).astype(np.uint8), 0).astype(np.uint8)
    alpha_ndvi_ant = np.where(val_ndvi_ant, 255, 0).astype(np.uint8)
    img_ndvi_ant = Image.fromarray(np.dstack([r_ndvi_ant, g_ndvi_ant, b_ndvi_ant, alpha_ndvi_ant]), mode="RGBA")
    path_ndvi_ant = assets_dir / "aoi_ndvi_anterior_2m.png"
    img_ndvi_ant.save(path_ndvi_ant, format="PNG", optimize=True)
    print(f"  ✓ Exportado: {path_ndvi_ant.name} ({out_width}x{out_height})")

    # 5. Processamento da CENA RECENTE (28/Out/2024)
    print("\n[4/6] Processando Cena Recente (28/Out/2024) com BBox Expandido...")
    raw_rgb_rec_path = dados_satelite_dir / "2026-10-24-00_00_2026-10-24-23_59_Sentinel-2_L2A_True_color.tiff"
    raw_ndvi_rec_path = dados_satelite_dir / "2026-10-24-00_00_2026-10-24-23_59_Sentinel-2_L2A_NDVI.tiff"

    # a) RGB Recente
    with rasterio.open(raw_rgb_rec_path) as src_rgb_rec:
        r_rec_raw = np.zeros((out_height, out_width), dtype=np.float32)
        g_rec_raw = np.zeros((out_height, out_width), dtype=np.float32)
        b_rec_raw = np.zeros((out_height, out_width), dtype=np.float32)
        reproject(rasterio.band(src_rgb_rec, 1), r_rec_raw, src_transform=src_rgb_rec.transform, src_crs=src_rgb_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
        reproject(rasterio.band(src_rgb_rec, 2), g_rec_raw, src_transform=src_rgb_rec.transform, src_crs=src_rgb_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
        reproject(rasterio.band(src_rgb_rec, 3), b_rec_raw, src_transform=src_rgb_rec.transform, src_crs=src_rgb_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)

    # Calibração proporcional uniforme sem estouro de verde
    r_rec_byte = np.clip(np.round(r_rec_raw), 0, 255).astype(np.uint8)
    g_rec_byte = np.clip(np.round(g_rec_raw * 0.92), 0, 255).astype(np.uint8)
    b_rec_byte = np.clip(np.round(b_rec_raw), 0, 255).astype(np.uint8)

    val_rec = mask_talhoes & ((r_rec_byte > 0) | (g_rec_byte > 0) | (b_rec_byte > 0))
    alpha_rgb_rec = np.where(val_rec, 255, 0).astype(np.uint8)
    r_rec_f = np.where(val_rec, r_rec_byte, 0).astype(np.uint8)
    g_rec_f = np.where(val_rec, g_rec_byte, 0).astype(np.uint8)
    b_rec_f = np.where(val_rec, b_rec_byte, 0).astype(np.uint8)
    img_rgb_rec = Image.fromarray(np.dstack([r_rec_f, g_rec_f, b_rec_f, alpha_rgb_rec]), mode="RGBA")
    path_rgb_rec = assets_dir / "aoi_rgb_recente_2m.png"
    img_rgb_rec.save(path_rgb_rec, format="PNG", optimize=True)
    print(f"  ✓ Exportado: {path_rgb_rec.name} ({out_width}x{out_height})")

    # b) NDVI Recente
    with rasterio.open(raw_ndvi_rec_path) as src_ndvi_rec:
        r_n_rec = np.zeros((out_height, out_width), dtype=np.float32)
        g_n_rec = np.zeros((out_height, out_width), dtype=np.float32)
        b_n_rec = np.zeros((out_height, out_width), dtype=np.float32)
        reproject(rasterio.band(src_ndvi_rec, 1), r_n_rec, src_transform=src_ndvi_rec.transform, src_crs=src_ndvi_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
        reproject(rasterio.band(src_ndvi_rec, 2), g_n_rec, src_transform=src_ndvi_rec.transform, src_crs=src_ndvi_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
        reproject(rasterio.band(src_ndvi_rec, 3), b_n_rec, src_transform=src_ndvi_rec.transform, src_crs=src_ndvi_rec.crs, dst_transform=dst_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)

    # Converte paleta para valor contínuo de NDVI
    ref_rgb = SENTINEL_NDVI_PALETTE[:, :3]
    ref_ndvi = SENTINEL_NDVI_PALETTE[:, 3]
    pix_rgb = np.stack([r_n_rec, g_n_rec, b_n_rec], axis=-1).reshape(-1, 3)
    diff = pix_rgb[:, None, :] - ref_rgb[None, :, :]
    nearest = np.argmin(np.sum(diff ** 2, axis=2), axis=1)
    ndvi_rec_cont = ref_ndvi[nearest].reshape(out_height, out_width)

    val_ndvi_rec = mask_talhoes & np.isfinite(ndvi_rec_cont) & (ndvi_rec_cont > 0.05)
    ndvi_rec_norm = np.clip((ndvi_rec_cont - vmin) / (vmax - vmin), 0.0, 1.0)
    col_ndvi_rec = cmap_ndvi_fixo(ndvi_rec_norm)
    r_ndvi_rec = np.where(val_ndvi_rec, (col_ndvi_rec[:, :, 0] * 255).astype(np.uint8), 0).astype(np.uint8)
    g_ndvi_rec = np.where(val_ndvi_rec, (col_ndvi_rec[:, :, 1] * 255).astype(np.uint8), 0).astype(np.uint8)
    b_ndvi_rec = np.where(val_ndvi_rec, (col_ndvi_rec[:, :, 2] * 255).astype(np.uint8), 0).astype(np.uint8)
    alpha_ndvi_rec = np.where(val_ndvi_rec, 255, 0).astype(np.uint8)
    img_ndvi_rec = Image.fromarray(np.dstack([r_ndvi_rec, g_ndvi_rec, b_ndvi_rec, alpha_ndvi_rec]), mode="RGBA")
    path_ndvi_rec = assets_dir / "aoi_ndvi_recente_2m.png"
    img_ndvi_rec.save(path_ndvi_rec, format="PNG", optimize=True)
    print(f"  ✓ Exportado: {path_ndvi_rec.name} ({out_width}x{out_height})")

    # 6. Regeneração dos 15 Recortes Individuais por Talhão (com folga total sem corte de topo)
    print("\n[5/6] Regenerando recortes individuais dos 15 talhões a partir da grade expandida...")
    for idx, row in gdf.iterrows():
        geom = row.geometry
        props = row.to_dict()
        talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)

        if not geom or geom.is_empty:
            continue

        minx, miny, maxx, maxy = geom.bounds
        t_width = max(1, int(round((maxx - minx) / res_lon_deg)))
        t_height = max(1, int(round((maxy - miny) / res_lat_deg)))
        t_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, t_width, t_height)

        t_mask = geometry_mask([geom], out_shape=(t_height, t_width), transform=t_transform, invert=True, all_touched=True)

        # Helper para recortar qualquer array mestre
        def extrair_talhao_rgba(r_master, g_master, b_master, is_ndvi=False, ndvi_raw=None):
            r_t = np.zeros((t_height, t_width), dtype=np.uint8)
            g_t = np.zeros((t_height, t_width), dtype=np.uint8)
            b_t = np.zeros((t_height, t_width), dtype=np.uint8)
            reproject(r_master, r_t, src_transform=dst_transform, src_crs="EPSG:4326", dst_transform=t_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
            reproject(g_master, g_t, src_transform=dst_transform, src_crs="EPSG:4326", dst_transform=t_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
            reproject(b_master, b_t, src_transform=dst_transform, src_crs="EPSG:4326", dst_transform=t_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)

            if is_ndvi and ndvi_raw is not None:
                n_t = np.zeros((t_height, t_width), dtype=np.float32)
                reproject(ndvi_raw, n_t, src_transform=dst_transform, src_crs="EPSG:4326", dst_transform=t_transform, dst_crs="EPSG:4326", resampling=Resampling.cubic)
                v_t = t_mask & np.isfinite(n_t) & (n_t > 0.05)
            else:
                v_t = t_mask & ((r_t > 0) | (g_t > 0) | (b_t > 0))

            a_t = np.where(v_t, 255, 0).astype(np.uint8)
            rf = np.where(v_t, r_t, 0).astype(np.uint8)
            gf = np.where(v_t, g_t, 0).astype(np.uint8)
            bf = np.where(v_t, b_t, 0).astype(np.uint8)
            return Image.fromarray(np.dstack([rf, gf, bf, a_t]), mode="RGBA")

        # Recorte 1: RGB Recente
        extrair_talhao_rgba(r_rec_f, g_rec_f, b_rec_f).save(assets_dir / f"{talhao_id}_rgb_recente.png", format="PNG", optimize=True)
        # Recorte 2: NDVI Recente
        extrair_talhao_rgba(r_ndvi_rec, g_ndvi_rec, b_ndvi_rec, is_ndvi=True, ndvi_raw=ndvi_rec_cont).save(assets_dir / f"{talhao_id}_ndvi_recente.png", format="PNG", optimize=True)
        # Recorte 3: RGB Anterior
        extrair_talhao_rgba(r_ant_f, g_ant_f, b_ant_f).save(assets_dir / f"{talhao_id}_rgb_anterior.png", format="PNG", optimize=True)
        # Recorte 4: NDVI Anterior
        extrair_talhao_rgba(r_ndvi_ant, g_ndvi_ant, b_ndvi_ant, is_ndvi=True, ndvi_raw=ndvi_ant).save(assets_dir / f"{talhao_id}_ndvi_anterior.png", format="PNG", optimize=True)

        print(f"  [{idx+1:02d}/{total_talhoes:02d}] ✓ {talhao_id:15s} (sem corte no topo)")

    # 7. Salva metadados de alinhamento para o Leaflet em bounds_expandido.json
    print("\n[6/6] Gravando arquivo de metadados bounds_expandido.json...")
    bounds_json_data = {
        "lat_min_expandida": round(lat_min_exp, 6),
        "lng_min_expandida": round(lng_min_exp, 6),
        "lat_max_expandida": round(lat_max_exp, 6),
        "lng_max_expandida": round(lng_max_exp, 6),
        "bounds": [
            [round(lat_min_exp, 6), round(lng_min_exp, 6)],
            [round(lat_max_exp, 6), round(lng_max_exp, 6)]
        ],
        "width_px": out_width,
        "height_px": out_height,
        "resolution_m": 2.0,
        "buffer_percent": 18.0
    }
    bounds_json_path = assets_dir / "bounds_expandido.json"
    with open(bounds_json_path, "w", encoding="utf-8") as f:
        json.dump(bounds_json_data, f, indent=2)

    print(f"  ✓ Arquivo de bounds gerado: {bounds_json_path.name}")
    print(f"  - bounds: {bounds_json_data['bounds']}")
    print("\n" + "=" * 80)
    print("   ✓ REPROCESSAMENTO COM BUFFER EXPANDIDO CONCLUÍDO COM SUCESSO!")
    print("=" * 80)


if __name__ == "__main__":
    main()
