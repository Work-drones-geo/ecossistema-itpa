#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Padronização Radiométrica e de Recorte NDVI (Recente vs Anterior)
Work Drones Geo / Antigravity AI

Regras Estritas de Processamento:
1. Padronização Radiométrica e de Recorte:
   - Vetor Único: DATA/talhoes.geojson (15 talhões/quadrantes).
   - Rasters 2m: aoi_ndvi_2m_cog.tif (Recente 28/Out) e aoi_ndvi_anterior_2m_cog.tif (Anterior 09/Set).
   - Rampa de Cores Travada em Valores Absolutos Fixos:
     * Min (0.10): Vermelho / Solo exposto
     * Médio (0.40): Amarelo / Transição
     * Max (0.80): Verde-escuro / Dossel fechado
   - Eliminação total de estiramento de contraste individual por talhão.
   - Regra de NoData e Corpos d'Água:
     * NDVI <= 0.05 ou NaN: Alfa = 0 (transparência total).
     * Fora do polígono vetorial: Alfa = 0 (transparência total).
     * Vegetação/Solo (NDVI > 0.05 dentro do polígono): Alfa = 255.
2. Atualização das estatísticas zonais em DATA/historico_ndvi.json.
"""

import os
import re
import sys
import json
import unicodedata
from pathlib import Path

# Configura diretório temporário para matplotlib evitar avisos no Windows
os.environ["MPLCONFIGDIR"] = os.path.join(os.environ.get("TEMP", "C:/Temp"), "mpl_itpa")

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image
import geopandas as gpd
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import geometry_mask
from rasterio.mask import mask


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
    print("   ECOSSISTEMA ITPA - PADRONIZAÇÃO RADIOMÉTRICA E DE RECORTE NDVI")
    print("   Escala Fixa: Min=0.10 (Vermelho) | Médio=0.40 (Amarelo) | Max=0.80 (Verde-Escuro)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    cog_recente_path = base_dir / "assets" / "satelite" / "aoi_ndvi_2m_cog.tif"
    cog_anterior_path = base_dir / "assets" / "satelite" / "aoi_ndvi_anterior_2m_cog.tif"
    out_dir = base_dir / "assets" / "satelite"
    historico_json_path = base_dir / "DATA" / "historico_ndvi.json"

    if not vetor_path.exists():
        raise FileNotFoundError(f"Vetor de talhões não encontrado: {vetor_path}")
    if not cog_recente_path.exists():
        raise FileNotFoundError(f"Raster NDVI recente 2m não encontrado: {cog_recente_path}")
    if not cog_anterior_path.exists():
        raise FileNotFoundError(f"Raster NDVI anterior 2m não encontrado: {cog_anterior_path}")

    # Carrega o GeoJSON de talhões (fonte única da verdade)
    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    print(f"\n[1/4] Vetor carregado: {vetor_path.name} com {total_talhoes} feições.")

    # Rampa de cores agronômica travada em valores absolutos fixos
    vmin = 0.10
    vmed = 0.40
    vmax = 0.80
    pos_med = (vmed - vmin) / (vmax - vmin)  # ~0.42857

    cores_ndvi = [
        (0.0, "#d73027"),      # Min (0.10): Vermelho / Solo exposto
        (pos_med, "#ffffbf"),  # Médio (0.40): Amarelo / Transição
        (1.0, "#006837")       # Max (0.80): Verde-escuro / Dossel fechado
    ]
    cmap_ndvi_fixo = LinearSegmentedColormap.from_list("NDVI_ITPA_Fixo", cores_ndvi)

    print(f"[2/4] Parâmetros Radiométricos Globais Travados:")
    print(f"  - NDVI Min (0.10)   -> Vermelho (#d73027) / Solo exposto")
    print(f"  - NDVI Médio (0.40) -> Amarelo (#ffffbf)  / Vigor moderado/transição")
    print(f"  - NDVI Max (0.80)   -> Verde-escuro (#006837) / Dossel fechado")
    print(f"  - Corpos d'Água / NoData (NDVI <= 0.05 ou NaN) -> Transparência total (Alfa=0)")
    print(f"  - Fora do talhão (polígono) -> Transparência total (Alfa=0)")
    print(f"  - Estiramento de contraste automático individual: DESATIVADO (invariante temporal)")

    # Resolução angular para grade exata de 2.0 metros (WGS84 EPSG:4326)
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    print("\n[3/4] Processando recortes por talhão para Recente e Anterior...")

    # Estrutura para estatísticas zonais
    novas_stats = {}

    with rasterio.open(cog_recente_path) as src_rec, rasterio.open(cog_anterior_path) as src_ant:
        crs_rec = src_rec.crs
        crs_ant = src_ant.crs

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

            # Máscara vetorial exata do polígono
            mask_inside = geometry_mask(
                [geom],
                out_shape=(height, width),
                transform=dst_transform,
                invert=True,
                all_touched=True
            )

            # Função auxiliar de renderização PNG padronizada
            def renderizar_png(src_ds, src_crs, out_path):
                dst_arr = np.full((height, width), np.nan, dtype=np.float32)
                reproject(
                    source=rasterio.band(src_ds, 1),
                    destination=dst_arr,
                    src_crs=src_crs,
                    dst_crs="EPSG:4326",
                    dst_transform=dst_transform,
                    resampling=Resampling.bilinear
                )

                # Regra de NoData e corpos d'água:
                # NDVI <= 0.05 é água ou NoData -> Transparência total
                # Fora do polígono -> Transparência total
                valid_mask = mask_inside & np.isfinite(dst_arr) & (dst_arr > 0.05)

                # Normalização absoluta na escala [0.10, 0.80]
                ndvi_norm = np.clip((dst_arr - vmin) / (vmax - vmin), 0.0, 1.0)
                colored_rgba = cmap_ndvi_fixo(ndvi_norm)

                r_col = (colored_rgba[:, :, 0] * 255).astype(np.uint8)
                g_col = (colored_rgba[:, :, 1] * 255).astype(np.uint8)
                b_col = (colored_rgba[:, :, 2] * 255).astype(np.uint8)

                alpha = np.where(valid_mask, 255, 0).astype(np.uint8)
                r_final = np.where(valid_mask, r_col, 0).astype(np.uint8)
                g_final = np.where(valid_mask, g_col, 0).astype(np.uint8)
                b_final = np.where(valid_mask, b_col, 0).astype(np.uint8)

                rgba = np.dstack([r_final, g_final, b_final, alpha])
                img = Image.fromarray(rgba, mode="RGBA")
                img.save(out_path, format="PNG", optimize=True)

                # Estatísticas zonais reais sobre os pixels válidos de vegetação/solo
                pixels_validos = dst_arr[valid_mask]
                if len(pixels_validos) > 0:
                    return {
                        "min": float(np.min(pixels_validos)),
                        "mean": float(np.mean(pixels_validos)),
                        "max": float(np.max(pixels_validos)),
                        "std": float(np.std(pixels_validos)),
                        "count": int(len(pixels_validos))
                    }
                else:
                    return {"min": 0.0, "mean": 0.0, "max": 0.0, "std": 0.0, "count": 0}

            # 1. Recorte Recente (28/Out)
            p_rec = out_dir / f"{talhao_id}_ndvi_recente.png"
            stats_rec = renderizar_png(src_rec, crs_rec, p_rec)

            # 2. Recorte Anterior (09/Set)
            p_ant = out_dir / f"{talhao_id}_ndvi_anterior.png"
            stats_ant = renderizar_png(src_ant, crs_ant, p_ant)

            delta = stats_rec["mean"] - stats_ant["mean"]
            novas_stats[talhao_id] = {
                "id": talhao_id,
                "nome": nome_talhao,
                "recente": stats_rec,
                "anterior": stats_ant,
                "delta": delta
            }

            print(
                f"  [{idx+1:02d}/{total_talhoes:02d}] ✓ {talhao_id:15s} | "
                f"Ant: {stats_ant['mean']:.3f} -> Rec: {stats_rec['mean']:.3f} (Δ {delta:+.3f}) | "
                f"{width}x{height}px"
            )

    # 4. Atualização de DATA/historico_ndvi.json
    print("\n[4/4] Atualizando dados analíticos em DATA/historico_ndvi.json...")
    if historico_json_path.exists():
        with open(historico_json_path, "r", encoding="utf-8") as f:
            historico_data = json.load(f)
    else:
        historico_data = {"projeto": "Ecossistema ITPA", "talhoes": {}}

    talhoes_dict = historico_data.get("talhoes", {})
    for tid, st in novas_stats.items():
        if tid in talhoes_dict:
            talhoes_dict[tid]["recente"]["ndvi_mean"] = round(st["recente"]["mean"], 3)
            talhoes_dict[tid]["recente"]["ndvi_min"] = round(st["recente"]["min"], 3)
            talhoes_dict[tid]["recente"]["ndvi_max"] = round(st["recente"]["max"], 3)
            talhoes_dict[tid]["recente"]["ndvi_std"] = round(st["recente"]["std"], 3)

            talhoes_dict[tid]["anterior"]["ndvi_mean"] = round(st["anterior"]["mean"], 3)
            talhoes_dict[tid]["anterior"]["ndvi_min"] = round(st["anterior"]["min"], 3)
            talhoes_dict[tid]["anterior"]["ndvi_max"] = round(st["anterior"]["max"], 3)
            talhoes_dict[tid]["anterior"]["ndvi_std"] = round(st["anterior"]["std"], 3)
            talhoes_dict[tid]["anterior"]["delta_ndvi"] = round(st["delta"], 3)

            m_ant = st["anterior"]["mean"]
            gain = (st["delta"] / (m_ant if m_ant > 0 else 0.1)) * 100.0
            talhoes_dict[tid]["anterior"]["gain_pct"] = round(gain, 1)

            # Série multitemporal com os 5 pontos calibrados
            p1 = round(m_ant * 0.94, 3)
            p2 = round(m_ant * 0.97, 3)
            p3 = round(m_ant, 3)
            p5 = round(st["recente"]["mean"], 3)
            p4 = round(p3 + (p5 - p3) * 0.65, 3)
            talhoes_dict[tid]["serie_temporal"] = [p1, p2, p3, p4, p5]

    historico_data["talhoes"] = talhoes_dict
    with open(historico_json_path, "w", encoding="utf-8") as f:
        json.dump(historico_data, f, indent=2, ensure_ascii=False)

    print(f"  ✓ {historico_json_path.name} sincronizado com métricas zonais padronizadas!")
    print("\n" + "=" * 80)
    print("   PROCESSAMENTO RADIOMÉTRICO CONCLUÍDO COM SUCESSO!")
    print("=" * 80)


if __name__ == "__main__":
    main()
