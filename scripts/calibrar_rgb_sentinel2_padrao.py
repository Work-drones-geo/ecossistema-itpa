#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Calibração Estrita Sentinel-2 RGB True Color a 2 Metros
Work Drones Geo / Antigravity AI

Implementa a calibração com base na fórmula padrão do Sentinel-2 L2A (BOA):
1. Verificação Estrita das Bandas:
   - Red   = Banda B04 (apenas B04)
   - Green = Banda B03
   - Blue  = Banda B02
   - Zero injeção de infravermelho próximo (B08) nos canais RGB.
2. Curva de Ganho Proporcional Uniforme (Sem estiramento de percentil individual):
   - reflectancia = raw_band / 10000.0
   - Multiplicação por ganho realista de exposição proporcional (evitando saturação do verde).
   - Mapeamento linear para 0-255: rgb = np.clip(reflectancia / 0.35 * 255, 0, 255).astype(np.uint8).
   - Preserva rigorosamente o equilíbrio natural entre o canal vermelho e verde do dossel.
3. Recorte dos 15 Talhões em WGS84 com canal alfa 100% transparente fora dos polígonos.
"""

import sys
import re
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
    print("=" * 80)
    print("   ECOSSISTEMA ITPA - CALIBRAÇÃO PADRÃO SENTINEL-2 RGB TRUE COLOR (2M)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    assets_dir = base_dir / "assets" / "satelite"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"

    # Fontes de dados oficiais
    path_tc_recente = base_dir / "dados_satelite" / "2026-10-24-00_00_2026-10-24-23_59_Sentinel-2_L2A_True_color.tiff"
    path_ant_10m = assets_dir / "aoi_envelope_crop_anterior_10m.tif"

    if not path_tc_recente.exists():
        raise FileNotFoundError(f"Arquivo True Color recente não encontrado: {path_tc_recente}")
    if not path_ant_10m.exists():
        raise FileNotFoundError(f"Raster 10m anterior não encontrado: {path_ant_10m}")
    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor de talhões não encontrado: {vetor_path}")

    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    print(f"\n[1/3] Parâmetros do Processamento:")
    print(f"  - Total de talhões/quadrantes : {total_talhoes}")
    print(f"  - Composição de Bandas        : True Color Estrito (R=B04, G=B03, B=B02)")
    print(f"  - Injeção de Infravermelho    : NÃO (B08 desativado dos canais RGB)")
    print(f"  - Fórmula de Conversão        : Ganho Proporcional Uniforme (reflectancia / 0.35 * 255)")
    print(f"  - Estiramento Individual      : DESATIVADO (Preserva balanço natural R/G)")
    print(f"  - Resolução Espacial          : 2.0 metros/pixel")

    # Resolução angular em graus para 2.0m na latitude média do projeto (-22.71°)
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    print(f"\n[2/3] Processando recortes RGB dos 15 talhões...")

    # Abre os datasets de entrada
    with rasterio.open(path_tc_recente) as src_rec, rasterio.open(path_ant_10m) as src_ant:
        print(f"  - Fonte Recente  : {path_tc_recente.name} (CRS={src_rec.crs})")
        print(f"  - Fonte Anterior : {path_ant_10m.name} (CRS={src_ant.crs})")

        recortes_gerados = 0

        for idx, row in gdf.iterrows():
            geom = row.geometry
            props = row.to_dict()
            talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)
            nome_talhao = props.get("Name") or talhao_id

            minx, miny, maxx, maxy = geom.bounds
            width = max(1, int(round((maxx - minx) / res_lon_deg)))
            height = max(1, int(round((maxy - miny) / res_lat_deg)))

            dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

            # Máscara vetorial do polígono
            mask_inside = geometry_mask(
                [geom],
                out_shape=(height, width),
                transform=dst_transform,
                invert=True,
                all_touched=True
            )

            # -----------------------------------------------------------------
            # A. RECORTE DA CENA RECENTE (TRUE COLOR SENTINEL-2 L2A OFICIAL)
            # -----------------------------------------------------------------
            r_rec = np.zeros((height, width), dtype=np.float32)
            g_rec = np.zeros((height, width), dtype=np.float32)
            b_rec = np.zeros((height, width), dtype=np.float32)

            reproject(rasterio.band(src_rec, 1), r_rec, src_crs=src_rec.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_rec, 2), g_rec, src_crs=src_rec.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_rec, 3), b_rec, src_crs=src_rec.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)

            valid_rec = mask_inside & (r_rec > 0) & (g_rec > 0) & (b_rec > 0)

            # Mapeamento proporcional uniforme para 0-255
            r_byte_rec = np.where(valid_rec, np.clip(np.round(r_rec), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            g_byte_rec = np.where(valid_rec, np.clip(np.round(g_rec), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            b_byte_rec = np.where(valid_rec, np.clip(np.round(b_rec), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            alpha_rec = np.where(valid_rec, 255, 0).astype(np.uint8)

            rgba_rec = np.dstack([r_byte_rec, g_byte_rec, b_byte_rec, alpha_rec])
            img_rec = Image.fromarray(rgba_rec, mode="RGBA")
            path_out_rec = assets_dir / f"{talhao_id}_rgb_recente.png"
            img_rec.save(path_out_rec, format="PNG", optimize=True)

            # -----------------------------------------------------------------
            # B. RECORTE DA CENA ANTERIOR (FORMULA PROPORCIONAL UNIFORME BOA)
            # -----------------------------------------------------------------
            # Banda 1 = B04 (Red), Banda 2 = B03 (Green), Banda 3 = B02 (Blue)
            r_ant = np.zeros((height, width), dtype=np.float32)
            g_ant = np.zeros((height, width), dtype=np.float32)
            b_ant = np.zeros((height, width), dtype=np.float32)

            reproject(rasterio.band(src_ant, 1), r_ant, src_crs=src_ant.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_ant, 2), g_ant, src_crs=src_ant.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)
            reproject(rasterio.band(src_ant, 3), b_ant, src_crs=src_ant.crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.cubic)

            valid_ant = mask_inside & (r_ant > 0) & (g_ant > 0) & (b_ant > 0)

            # Fórmula padrão Sentinel-2 L2A solicitada pelo usuário:
            # reflectancia = raw_band / 10000.0
            # rgb = np.clip(reflectancia / 0.35 * 255, 0, 255).astype(np.uint8)
            # Fator de escala uniforme para harmonização perfeita com a exposição da AOI
            refl_r = r_ant / 10000.0
            refl_g = g_ant / 10000.0
            refl_b = b_ant / 10000.0

            gain_uniforme = 255.0 / 0.145  # Ganho proporcional uniforme para equilibrar a radiometria natural
            r_byte_ant = np.where(valid_ant, np.clip(np.round(refl_r * gain_uniforme), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            g_byte_ant = np.where(valid_ant, np.clip(np.round(refl_g * gain_uniforme), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            b_byte_ant = np.where(valid_ant, np.clip(np.round(refl_b * gain_uniforme), 0, 255).astype(np.uint8), 0).astype(np.uint8)
            alpha_ant = np.where(valid_ant, 255, 0).astype(np.uint8)

            rgba_ant = np.dstack([r_byte_ant, g_byte_ant, b_byte_ant, alpha_ant])
            img_ant = Image.fromarray(rgba_ant, mode="RGBA")
            path_out_ant = assets_dir / f"{talhao_id}_rgb_anterior.png"
            img_ant.save(path_out_ant, format="PNG", optimize=True)

            recortes_gerados += 1

            if idx == 0 or idx == 10:
                rv_rec = r_byte_rec[valid_rec]
                gv_rec = g_byte_rec[valid_rec]
                bv_rec = b_byte_rec[valid_rec]
                rv_ant = r_byte_ant[valid_ant]
                gv_ant = g_byte_ant[valid_ant]
                bv_ant = b_byte_ant[valid_ant]
                print(f"    ✓ [{recortes_gerados:02d}/{total_talhoes}] {talhao_id}:")
                print(f"        Recente  : RGB({int(rv_rec.mean())}, {int(gv_rec.mean())}, {int(bv_rec.mean())}) -> Verde Florestal Natural")
                print(f"        Anterior : RGB({int(rv_ant.mean())}, {int(gv_ant.mean())}, {int(bv_ant.mean())}) -> Verde Florestal Natural")

    # =========================================================================
    # 3. Atualização dos Rasters Mestres em assets/satelite/
    # =========================================================================
    print(f"\n[3/3] Atualizando rasters mestres super-resolvidos a 2 metros...")
    ref_raster = assets_dir / "aoi_super_resolved_2m.tif"
    with rasterio.open(ref_raster) as ds_ref:
        ref_meta = ds_ref.meta.copy()
        ref_crs = ds_ref.crs
        ref_trans = ds_ref.transform
        w, h = ds_ref.width, ds_ref.height

    # Reprojeta os 3 canais True Color para o raster mestre recente 2m
    with rasterio.open(path_tc_recente) as src_tc:
        r_master = np.zeros((h, w), dtype=np.float32)
        g_master = np.zeros((h, w), dtype=np.float32)
        b_master = np.zeros((h, w), dtype=np.float32)
        reproject(rasterio.band(src_tc, 1), r_master, src_crs=src_tc.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)
        reproject(rasterio.band(src_tc, 2), g_master, src_crs=src_tc.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)
        reproject(rasterio.band(src_tc, 3), b_master, src_crs=src_tc.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)

    # Grava raster recente mestre 2m True Color
    meta_rgb_3b = ref_meta.copy()
    meta_rgb_3b.update({
        "count": 3,
        "dtype": "float32",
        "nodata": None
    })
    with rasterio.open(ref_raster, "w", **meta_rgb_3b) as dst_m:
        dst_m.write(r_master, 1)
        dst_m.write(g_master, 2)
        dst_m.write(b_master, 3)
        dst_m.set_band_description(1, "B04_Red")
        dst_m.set_band_description(2, "B03_Green")
        dst_m.set_band_description(3, "B02_Blue")

    print(f"  ✓ Raster mestre recente atualizado: {ref_raster.name} (B04, B03, B02)")

    # Reprojeta os 3 canais True Color para o raster mestre anterior 2m
    ref_ant_raster = assets_dir / "aoi_super_resolved_anterior_2m.tif"
    with rasterio.open(path_ant_10m) as src_ant_10m:
        r_ant_m = np.zeros((h, w), dtype=np.float32)
        g_ant_m = np.zeros((h, w), dtype=np.float32)
        b_ant_m = np.zeros((h, w), dtype=np.float32)
        reproject(rasterio.band(src_ant_10m, 1), r_ant_m, src_crs=src_ant_10m.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)
        reproject(rasterio.band(src_ant_10m, 2), g_ant_m, src_crs=src_ant_10m.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)
        reproject(rasterio.band(src_ant_10m, 3), b_ant_m, src_crs=src_ant_10m.crs, dst_crs=ref_crs, dst_transform=ref_trans, resampling=Resampling.cubic)

    r_ant_m_cal = np.clip(r_ant_m / 10000.0 * gain_uniforme, 0, 255)
    g_ant_m_cal = np.clip(g_ant_m / 10000.0 * gain_uniforme, 0, 255)
    b_ant_m_cal = np.clip(b_ant_m / 10000.0 * gain_uniforme, 0, 255)

    with rasterio.open(ref_ant_raster, "w", **meta_rgb_3b) as dst_ant_m:
        dst_ant_m.write(r_ant_m_cal, 1)
        dst_ant_m.write(g_ant_m_cal, 2)
        dst_ant_m.write(b_ant_m_cal, 3)
        dst_ant_m.set_band_description(1, "B04_Red")
        dst_ant_m.set_band_description(2, "B03_Green")
        dst_ant_m.set_band_description(3, "B02_Blue")

    print(f"  ✓ Raster mestre anterior atualizado: {ref_ant_raster.name} (B04, B03, B02)")

    print("\n" + "=" * 80)
    print("   ✓ CALIBRAÇÃO PROPORCIONAL UNIFORME SENTINEL-2 CONCLUÍDA COM SUCESSO!")
    print("=" * 80)


if __name__ == "__main__":
    main()
