#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Atualização dos Recortes Sentinel-2 RGB True Color (2 Metros) para WebGIS
Recorta a imagem orbital super-resolvida a 2 metros (aoi_super_resolved_2m.tif)
pela geometria de cada talhão, aplica ajuste radiométrico e normalização de contraste natural
(stretch linear 2% a 98%), preserva transparência alfa total fora dos polígonos
e salva os arquivos PNG em assets/satelite/{talhao_id}_rgb_recente.png.

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
    print("   ECOSSISTEMA ITPA - RECORTES SENTINEL-2 RGB TRUE COLOR 2M (WEBGIS)")
    print("=" * 75)

    base_dir = Path(__file__).resolve().parent.parent
    raster_sr_path = base_dir / "assets" / "satelite" / "aoi_super_resolved_2m.tif"
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    out_dir = base_dir / "assets" / "satelite"

    if not raster_sr_path.exists():
        raise FileNotFoundError(f"Raster super-resolvido 2m não localizado: {raster_sr_path}")
    if not vetor_path.exists():
        alt_vetor = base_dir / "DATA" / "KMLs.geojson"
        if alt_vetor.exists():
            vetor_path = alt_vetor
        else:
            raise FileNotFoundError(f"Vetor de talhões não localizado em DATA/: {vetor_path}")

    print(f"\n[1/3] Parâmetros de Entrada:")
    print(f"  - Raster Super-resolvido 2m : {raster_sr_path.name}")
    print(f"  - Camada Vetorial           : {vetor_path.name}")
    print(f"  - Diretório de Destino      : {out_dir}")

    # Carrega camada vetorial
    gdf = gpd.read_file(vetor_path)
    total_talhoes = len(gdf)
    print(f"\n[2/3] Total de talhões/quadrantes para processamento: {total_talhoes}")
    print(f"  - Modo de Cor       : RGB True Color (B04=Red, B03=Green, B02=Blue)")
    print(f"  - Normalização      : Stretch Linear 2% a 98% de reflectância")
    print(f"  - Fundo Externo     : Transparência alfa 100% (RGBA, A=0)")
    print(f"  - Resolução Espacial: 2.0 metros/pixel")
    print("\n[3/3] Processando e exportando recortes RGB...")

    # Resolução angular para 2.0 metros na latitude média do projeto (-22.71°)
    res_lat_deg = 2.0 / 110750.0
    res_lon_deg = 2.0 / (111320.0 * np.cos(np.radians(-22.71)))

    arquivos_atualizados = []
    processados = 0

    with rasterio.open(raster_sr_path) as src:
        src_crs = src.crs

        # Percentis de referência da cena global para balanço de cor harmonioso
        print("  - Calculando calibração espectral de referência da cena...")
        r_scene = src.read(1)
        g_scene = src.read(2)
        b_scene = src.read(3)
        valid_scene = (
            np.isfinite(r_scene) & (r_scene > 0) &
            np.isfinite(g_scene) & (g_scene > 0) &
            np.isfinite(b_scene) & (b_scene > 0)
        )
        glob_p2_r, glob_p98_r = np.percentile(r_scene[valid_scene], [2, 98])
        glob_p2_g, glob_p98_g = np.percentile(g_scene[valid_scene], [2, 98])
        glob_p2_b, glob_p98_b = np.percentile(b_scene[valid_scene], [2, 98])
        print(f"    R [2%, 98%]: [{glob_p2_r:.5f}, {glob_p98_r:.5f}]")
        print(f"    G [2%, 98%]: [{glob_p2_g:.5f}, {glob_p98_g:.5f}]")
        print(f"    B [2%, 98%]: [{glob_p2_b:.5f}, {glob_p98_b:.5f}]")

        for idx, row in gdf.iterrows():
            geom = row.geometry
            props = row.to_dict()
            talhao_id = normalizar_talhao_id(props, fallback_idx=idx + 1)
            nome_talhao = props.get("Name") or talhao_id

            if not geom or geom.is_empty:
                continue

            try:
                minx, miny, maxx, maxy = geom.bounds

                # Dimensões na grade métrica WGS84 para compatibilidade com ImageOverlay
                width = max(1, int(round((maxx - minx) / res_lon_deg)))
                height = max(1, int(round((maxy - miny) / res_lat_deg)))

                dst_transform = rasterio.transform.from_bounds(minx, miny, maxx, maxy, width, height)

                # Reprojeção bilinear das bandas Red, Green e Blue
                r = np.full((height, width), np.nan, dtype=np.float32)
                g = np.full((height, width), np.nan, dtype=np.float32)
                b = np.full((height, width), np.nan, dtype=np.float32)

                reproject(rasterio.band(src, 1), r, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(src, 2), g, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)
                reproject(rasterio.band(src, 3), b, src_crs=src_crs, dst_crs="EPSG:4326", dst_transform=dst_transform, resampling=Resampling.bilinear)

                # Máscara exata do polígono
                mask_inside = geometry_mask(
                    [geom],
                    out_shape=(height, width),
                    transform=dst_transform,
                    invert=True,
                    all_touched=True
                )

                valid_mask = mask_inside & np.isfinite(r) & np.isfinite(g) & np.isfinite(b) & (r > 0) & (g > 0) & (b > 0)

                # Normalização de contraste natural: Combina percentis locais (2% a 98%) e globais
                if np.count_nonzero(valid_mask) > 10:
                    loc_p2_r, loc_p98_r = np.percentile(r[valid_mask], [2, 98])
                    loc_p2_g, loc_p98_g = np.percentile(g[valid_mask], [2, 98])
                    loc_p2_b, loc_p98_b = np.percentile(b[valid_mask], [2, 98])

                    p2_r = 0.5 * loc_p2_r + 0.5 * glob_p2_r
                    p98_r = 0.5 * loc_p98_r + 0.5 * glob_p98_r
                    p2_g = 0.5 * loc_p2_g + 0.5 * glob_p2_g
                    p98_g = 0.5 * loc_p98_g + 0.5 * glob_p98_g
                    p2_b = 0.5 * loc_p2_b + 0.5 * glob_p2_b
                    p98_b = 0.5 * loc_p98_b + 0.5 * glob_p98_b
                else:
                    p2_r, p98_r = glob_p2_r, glob_p98_r
                    p2_g, p98_g = glob_p2_g, glob_p98_g
                    p2_b, p98_b = glob_p2_b, glob_p98_b

                # Stretch linear [0..1]
                r_norm = np.clip((r - p2_r) / max(p98_r - p2_r, 1e-6), 0.0, 1.0)
                g_norm = np.clip((g - p2_g) / max(p98_g - p2_g, 1e-6), 0.0, 1.0)
                b_norm = np.clip((b - p2_b) / max(p98_b - p2_b, 1e-6), 0.0, 1.0)

                # Ajuste suave de gamma para realce de detalhes em sombras e vegetação
                gamma = 0.95
                r_norm = np.power(r_norm, gamma)
                g_norm = np.power(g_norm, gamma)
                b_norm = np.power(b_norm, gamma)

                # Converte para uint8 [0..255]
                r_byte = np.where(valid_mask, (r_norm * 255.0).astype(np.uint8), 0).astype(np.uint8)
                g_byte = np.where(valid_mask, (g_norm * 255.0).astype(np.uint8), 0).astype(np.uint8)
                b_byte = np.where(valid_mask, (b_norm * 255.0).astype(np.uint8), 0).astype(np.uint8)

                # Canal alfa 100% transparente fora do polígono
                alpha = np.where(valid_mask, 255, 0).astype(np.uint8)

                rgba = np.dstack([r_byte, g_byte, b_byte, alpha])
                img = Image.fromarray(rgba, mode="RGBA")

                # Salva o arquivo recente
                p_recente = out_dir / f"{talhao_id}_rgb_recente.png"
                img.save(p_recente, format="PNG", optimize=True)
                arquivos_atualizados.append(p_recente)

                # Atualiza também o arquivo anterior
                p_anterior = out_dir / f"{talhao_id}_rgb_anterior.png"
                img.save(p_anterior, format="PNG", optimize=True)
                arquivos_atualizados.append(p_anterior)

                processados += 1
                size_kb = p_recente.stat().st_size / 1024

                print(
                    f"  [{processados:02d}/{total_talhoes:02d}] ✓ {talhao_id} ({nome_talhao}) -> "
                    f"{width}x{height}px | R=[{p2_r:.4f}..{p98_r:.4f}] | PNG: {size_kb:.1f} KB"
                )

            except Exception as e:
                print(f"  [X] Erro ao processar {nome_talhao} ({talhao_id}): {e}")

    print("\n" + "=" * 75)
    print(f"  Conclusão: {processados}/{total_talhoes} talhões RGB atualizados com sucesso a 2 metros!")
    print(f"  Total de arquivos PNG RGB sobrescritos em assets/satelite: {len(arquivos_atualizados)}")
    total_mb = sum(p.stat().st_size for p in arquivos_atualizados) / (1024 * 1024)
    print(f"  Tamanho total das imagens PNG geradas: {total_mb:.2f} MB")
    print("=" * 75)


if __name__ == "__main__":
    main()
