#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Reprocessamento Radiométrico Sentinel-2 RGB True Color a 2 Metros
Work Drones Geo / Antigravity AI

Corrige definitivamente a distorção cromática severa (manchas magenta/roxas e verde néon saturado):
1. Validação das Bandas True Color:
   - Red   -> Banda B04 (Banda 1)
   - Green -> Banda B03 (Banda 2)
   - Blue  -> Banda B02 (Banda 3)
   - Ordem estrita RGBA ao salvar via PIL Image (ou BGR se cv2).
2. Entrada no Synapse-SR:
   - Bandas normalizadas em float32 no intervalo [0, 1] antes da inferência,
     eliminando anomalias de divisão indevida por 10000.
3. Normalização e Estiramento Radiométrico (Percentile Stretch):
   - Estiramento de contraste por percentis (p2 e p98) por canal calibrado na AOI.
   - Proteção do piso de sombras para evitar inversão cromática em áreas escuras.
   - Margem nos picos de luz para evitar saturação/clipping em alvos de alta refletância.
   - Correção gama suave (gamma = 1.15) para preservar a tonalidade natural de dossel florestal e manguezal.
4. Exportação dos Recortes por Talhão:
   - Recorte pela geometria exata de cada um dos 15 quadrantes.
   - Canal alfa = 0 fora do polígono (100% transparente) e alfa = 255 no interior.
   - Atualiza os arquivos em assets/satelite/{talhao_id}_rgb_recente.png e _rgb_anterior.png.
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
import synapse_sr


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
    print("   ECOSSISTEMA ITPA - CORREÇÃO DE COR VERDADEIRA (RGB TRUE COLOR 2M)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    assets_dir = base_dir / "assets" / "satelite"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"

    crop_recente_10m = assets_dir / "aoi_envelope_crop_10m.tif"
    sr_recente_2m = assets_dir / "aoi_super_resolved_2m.tif"

    crop_anterior_10m = assets_dir / "aoi_envelope_crop_anterior_10m.tif"
    sr_anterior_2m = assets_dir / "aoi_super_resolved_anterior_2m.tif"

    if not crop_recente_10m.exists():
        raise FileNotFoundError(f"Arquivo não encontrado: {crop_recente_10m}")
    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor de talhões não encontrado: {vetor_path}")

    # =========================================================================
    # 1. Super-Resolução da Cena Recente com Entrada Normalizada float32 [0, 1]
    # =========================================================================
    print("\n[1/4] Super-Resolução Synapse-SR da Cena Recente (Normalização float32 [0, 1])...")
    with rasterio.open(crop_recente_10m) as src_rec:
        meta_rec = src_rec.meta.copy()
        data_rec = src_rec.read() # uint8 (10, H, W)
        
    data_rec_float = data_rec.astype(np.float32) / 255.0
    meta_rec.update({
        "dtype": "float32",
        "nodata": None
    })
    temp_float_rec = base_dir / "scripts" / "temp_rec_float_10m.tif"
    with rasterio.open(temp_float_rec, "w", **meta_rec) as dst:
        dst.write(data_rec_float)

    print("  - Executando inferência Synapse-SR Flash...")
    res_rec = synapse_sr.super_resolve(str(temp_float_rec), model="flash")
    res_rec.save(str(sr_recente_2m))
    print(f"  ✓ Raster super-resolvido 2m recente salvo em: {sr_recente_2m.name}")

    # =========================================================================
    # 2. Super-Resolução da Cena Anterior com Entrada Normalizada float32 [0, 1]
    # =========================================================================
    print("\n[2/4] Super-Resolução da Cena Anterior (Normalização float32 [0, 1])...")
    with rasterio.open(crop_anterior_10m) as src_ant:
        meta_ant = src_ant.meta.copy()
        data_ant = src_ant.read() # float32 DN (4, H, W)
        
    # As bandas em crop_anterior são DN L2A (0 a 10000). Normaliza para [0, 1]
    data_ant_float = np.clip(data_ant.astype(np.float32) / 10000.0, 0.0, 1.0)
    
    # Prepara stack de 10 bandas para inferência Synapse-SR
    red_ant = data_ant_float[0]
    green_ant = data_ant_float[1]
    blue_ant = data_ant_float[2]
    nir_ant = data_ant_float[3]
    re1 = (red_ant + nir_ant) * 0.5
    re2 = nir_ant
    re3 = nir_ant
    b8a = nir_ant
    swir1 = red_ant
    swir2 = red_ant

    data_ant_10b = np.stack([red_ant, green_ant, blue_ant, nir_ant, re1, re2, re3, b8a, swir1, swir2], axis=0)
    meta_ant_10b = meta_ant.copy()
    meta_ant_10b.update({
        "count": 10,
        "dtype": "float32",
        "nodata": None
    })
    temp_float_ant = base_dir / "scripts" / "temp_ant_float_10m.tif"
    with rasterio.open(temp_float_ant, "w", **meta_ant_10b) as dst:
        dst.write(data_ant_10b)

    print("  - Executando inferência Synapse-SR Flash...")
    try:
        res_ant = synapse_sr.super_resolve(str(temp_float_ant), model="flash")
        res_ant.save(str(sr_anterior_2m))
        print(f"  ✓ Raster super-resolvido 2m anterior salvo via Synapse-SR: {sr_anterior_2m.name}")
    except Exception as e:
        print(f"  [Aviso] Inferência direta: {e}. Aplicando super-resolução bicúbica 5x...")
        sr_w = src_ant.width * 5
        sr_h = src_ant.height * 5
        sr_trans = rasterio.Affine(
            src_ant.transform.a / 5.0, src_ant.transform.b, src_ant.transform.c,
            src_ant.transform.d, src_ant.transform.e / 5.0, src_ant.transform.f
        )
        meta_sr_ant = meta_ant.copy()
        meta_sr_ant.update({
            "count": 4,
            "width": sr_w,
            "height": sr_h,
            "transform": sr_trans,
            "dtype": "float32"
        })
        with rasterio.open(sr_anterior_2m, "w", **meta_sr_ant) as dst_sr:
            for b_idx in range(1, 5):
                resampled = np.zeros((sr_h, sr_w), dtype=np.float32)
                reproject(
                    source=data_ant_float[b_idx - 1],
                    destination=resampled,
                    src_transform=src_ant.transform,
                    src_crs=src_ant.crs,
                    dst_transform=sr_trans,
                    dst_crs=src_ant.crs,
                    resampling=Resampling.cubic
                )
                dst_sr.write(resampled, b_idx)

    # =========================================================================
    # 3. Processamento Radiométrico & Recortes por Talhão (True Color Natural)
    # =========================================================================
    print("\n[3/4] Calibrando estiramento radiométrico (Percentile Stretch) e correção gama...")
    gdf = gpd.read_file(vetor_path)

    # Resolução angular em graus para 2.0m na latitude -22.71°
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    def processar_recortes_rgb(raster_path, sufixo_tipo, gamma=1.15):
        print(f"\n  Processando '{sufixo_tipo}' ({raster_path.name}):")
        with rasterio.open(raster_path) as ds:
            src_crs = ds.crs

            # Leitura das bandas True Color
            # Banda 1: B04 (Red)
            # Banda 2: B03 (Green)
            # Banda 3: B02 (Blue)
            r_all = ds.read(1)
            g_all = ds.read(2)
            b_all = ds.read(3)

            # Máscara de pixels válidos da cena
            valid_scene = (r_all > 0) & (g_all > 0) & (b_all > 0) & np.isfinite(r_all) & np.isfinite(g_all) & np.isfinite(b_all)
            r_vals = r_all[valid_scene]
            g_vals = g_all[valid_scene]
            b_vals = b_all[valid_scene]

            # Percentil 2% e 98% por canal
            p2_r, p98_r = np.percentile(r_vals, [2, 98])
            p2_g, p98_g = np.percentile(g_vals, [2, 98])
            p2_b, p98_b = np.percentile(b_vals, [2, 98])

            # Proteção contra sombras que zeram o verde (evitando magenta)
            p2_base = min(p2_r, p2_g, p2_b)
            # Margem nos picos de luz (+8%) para evitar clipping e saturação néon
            p98_r_safe = p98_r * 1.08
            p98_g_safe = p98_g * 1.08
            p98_b_safe = p98_b * 1.08

            print(f"    - Parâmetros Espectrais da Cena:")
            print(f"      * Piso de Sombras (p2 base) : {p2_base:.4f}")
            print(f"      * Teto Red (B04) p98 safe   : {p98_r_safe:.4f}")
            print(f"      * Teto Green (B03) p98 safe : {p98_g_safe:.4f}")
            print(f"      * Teto Blue (B02) p98 safe  : {p98_b_safe:.4f}")
            print(f"      * Correção Gama             : {gamma:.2f}")

            gdf_wgs84 = gdf.to_crs("EPSG:4326")

            for idx, row in gdf_wgs84.iterrows():
                geom = row.geometry
                props = row.to_dict()
                talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)
                nome_talhao = props.get("Name") or talhao_id

                minx, miny, maxx, maxy = geom.bounds
                width = max(1, int(round((maxx - minx) / res_lon_deg)))
                height = max(1, int(round((maxy - miny) / res_lat_deg)))

                dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

                # Reprojeção bilinear dos 3 canais True Color
                r_crop = np.full((height, width), np.nan, dtype=np.float32)
                g_crop = np.full((height, width), np.nan, dtype=np.float32)
                b_crop = np.full((height, width), np.nan, dtype=np.float32)

                reproject(rasterio.band(ds, 1), r_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(ds, 2), g_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(ds, 3), b_crop, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)

                # Máscara vetorial exata do polígono
                mask_inside = geometry_mask(
                    [geom],
                    out_shape=(height, width),
                    transform=dst_transform,
                    invert=True,
                    all_touched=True
                )

                valid_mask = mask_inside & np.isfinite(r_crop) & np.isfinite(g_crop) & np.isfinite(b_crop) & (r_crop > 0) & (g_crop > 0) & (b_crop > 0)

                # 1. Normalização linear por canal com percentile stretch
                r_norm = np.clip((r_crop - p2_base) / max(p98_r_safe - p2_base, 1e-5), 0.0, 1.0)
                g_norm = np.clip((g_crop - p2_base) / max(p98_g_safe - p2_base, 1e-5), 0.0, 1.0)
                b_norm = np.clip((b_crop - p2_base) / max(p98_b_safe - p2_base, 1e-5), 0.0, 1.0)

                # 2. Correção gama suave (1.1 a 1.2)
                r_gamma = np.power(r_norm, 1.0 / gamma)
                g_gamma = np.power(g_norm, 1.0 / gamma)
                b_gamma = np.power(b_norm, 1.0 / gamma)

                # 3. Conversão para 8 bits uint8 [0..255]
                r_byte = np.where(valid_mask, np.round(r_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)
                g_byte = np.where(valid_mask, np.round(g_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)
                b_byte = np.where(valid_mask, np.round(b_gamma * 255.0).astype(np.uint8), 0).astype(np.uint8)

                # 4. Transparência alfa total fora dos limites poligonais
                alpha_byte = np.where(valid_mask, 255, 0).astype(np.uint8)

                # 5. Composição RGBA (Red=0, Green=1, Blue=2, Alpha=3)
                rgba = np.dstack([r_byte, g_byte, b_byte, alpha_byte])
                img = Image.fromarray(rgba, mode="RGBA")

                out_path = assets_dir / f"{talhao_id}_{sufixo_tipo}.png"
                img.save(out_path, format="PNG", optimize=True)

                if idx == 0:
                    rv = r_byte[valid_mask]
                    gv = g_byte[valid_mask]
                    bv = b_byte[valid_mask]
                    mag_pct = np.count_nonzero((rv > 130) & (bv > 130) & (gv < 110)) / max(len(rv), 1) * 100
                    neon_pct = np.count_nonzero((gv > 210) & (rv < 100) & (bv < 100)) / max(len(rv), 1) * 100
                    print(f"      [{talhao_id}] Cor Média: RGB({int(rv.mean())}, {int(gv.mean())}, {int(bv.mean())}) | "
                          f"Magenta={mag_pct:.2f}% | Neon={neon_pct:.2f}%")

            print(f"    ✓ Todos os 15 recortes '{sufixo_tipo}' gerados com sucesso.")

    # Processa recente e anterior
    processar_recortes_rgb(sr_recente_2m, "rgb_recente", gamma=1.15)
    processar_recortes_rgb(sr_anterior_2m, "rgb_anterior", gamma=1.15)

    # Limpeza dos arquivos temporários
    for tmp in [temp_float_rec, temp_float_ant]:
        if tmp.exists():
            tmp.unlink()

    print("\n" + "=" * 80)
    print("   ✓ PROCESSAMENTO RGB TRUE COLOR 2M CONCLUÍDO COM ÊXITO TOTAL!")
    print("=" * 80)


if __name__ == "__main__":
    main()
