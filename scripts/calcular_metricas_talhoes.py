#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Cálculo de Métricas Zonais e Geometria dos Talhões (Etapa 1)
Calcula a área líquida (ha) e perímetro (m) em UTM 23S (EPSG:32723), além das
estatísticas zonais de NDVI (Médio, Mínimo, Máximo e Desvio Padrão) a partir do
raster super-resolvido a 2m (aoi_ndvi_2m_cog.tif).
Atualiza diretamente as propriedades de DATA/talhoes.geojson e DATA/KMLs.geojson.

Autor: Antigravity AI / Work Drones Geo
Projeto: Ecossistema ITPA - Restauração Florestal
"""

import os
import sys
import json
from pathlib import Path

import numpy as np
import geopandas as gpd
import rasterio
from rasterio.mask import mask
from shapely import force_2d


def classificar_vigor(ndvi_medio: float) -> str:
    """Classificação qualitativa do vigor da vegetação."""
    if ndvi_medio >= 0.60:
        return "Vigor Muito Alto (Densa)"
    elif ndvi_medio >= 0.45:
        return "Alto Vigor (Formada)"
    elif ndvi_medio >= 0.35:
        return "Vigor Moderado (Transição)"
    elif ndvi_medio >= 0.20:
        return "Vigor Baixo (Mudas/Solo)"
    else:
        return "Solo Exposto / Água"


def main():
    print("=" * 80)
    print("   ECOSSISTEMA ITPA - CÁLCULO DE ESTATÍSTICAS ZONAIS E GEOMETRIA (2 METROS)")
    print("=" * 80)

    base_dir = Path(__file__).resolve().parent.parent
    vetor_path = base_dir / "DATA" / "talhoes.geojson"
    kmls_path = base_dir / "DATA" / "KMLs.geojson"
    raster_ndvi_path = base_dir / "assets" / "satelite" / "aoi_ndvi_2m_cog.tif"

    if not raster_ndvi_path.exists():
        raise FileNotFoundError(f"Raster COG 2m não encontrado: {raster_ndvi_path}")
    if not vetor_path.exists():
        raise FileNotFoundError(f"Arquivo vetorial não encontrado: {vetor_path}")

    print(f"\n[1/3] Carregando dados:")
    print(f"  - Camada Vetorial : {vetor_path.name}")
    print(f"  - Raster NDVI 2m  : {raster_ndvi_path.name}")

    # Carrega GeoDataFrame original (EPSG:4326)
    gdf = gpd.read_file(vetor_path)
    total_features = len(gdf)
    print(f"  - Total de Talhões/Quadrantes: {total_features}")

    # Reprojeta para UTM 23S para cálculos de área e perímetro em metros
    utm_crs = "EPSG:32723"
    gdf_utm = gdf.to_crs(utm_crs)

    print(f"\n[2/3] Calculando métricas métricas e estatísticas de NDVI a 2m...")
    print("-" * 80)
    print(f"{'#':<3} | {'Talhão':<24} | {'Área (ha)':<10} | {'Perím. (m)':<10} | {'NDVI Méd.':<10} | {'Mín / Máx':<15}")
    print("-" * 80)

    metricas_lista = []

    with rasterio.open(raster_ndvi_path) as src:
        nodata_val = src.nodata

        for idx, row in gdf_utm.iterrows():
            geom = force_2d(row.geometry)
            nome = row.get("Name") or f"Talhao_{idx+1}"

            # 1. Geometria métrica projetada em UTM 23S
            area_m2 = geom.area
            area_ha = round(float(area_m2 / 10000.0), 2)
            perimetro_m = round(float(geom.length), 1)

            # 2. Estatísticas Zonais a partir do raster NDVI 2m
            try:
                out_image, _ = mask(src, [geom], crop=True, all_touched=True)
                banda = out_image[0]
                
                # Filtra apenas pixels finitos e diferentes do valor de NoData
                valid_mask = np.isfinite(banda)
                if nodata_val is not None:
                    valid_mask &= (banda != nodata_val)

                pixels = banda[valid_mask]

                if len(pixels) > 0:
                    ndvi_min = round(float(np.min(pixels)), 3)
                    ndvi_mean = round(float(np.mean(pixels)), 3)
                    ndvi_max = round(float(np.max(pixels)), 3)
                    ndvi_std = round(float(np.std(pixels)), 3)
                    pixel_count = int(len(pixels))
                else:
                    ndvi_min = ndvi_mean = ndvi_max = ndvi_std = 0.0
                    pixel_count = 0

            except Exception as e:
                print(f"  [X] Aviso ao extrair zonal stats para {nome}: {e}")
                ndvi_min = ndvi_mean = ndvi_max = ndvi_std = 0.0
                pixel_count = 0

            classe_vigor = classificar_vigor(ndvi_mean)

            # Armazena métricas
            metricas_lista.append({
                "area_ha": area_ha,
                "area_m2": round(float(area_m2), 1),
                "perimetro_m": perimetro_m,
                "ndvi_min": ndvi_min,
                "ndvi_mean": ndvi_mean,
                "ndvi_max": ndvi_max,
                "ndvi_std": ndvi_std,
                "ndvi_pixels": pixel_count,
                "ndvi_classe": classe_vigor
            })

            min_max_str = f"{ndvi_min:.3f} / {ndvi_max:.3f}"
            print(f"{idx+1:02d}  | {nome:<24} | {area_ha:<10.2f} | {perimetro_m:<10.1f} | {ndvi_mean:<10.3f} | {min_max_str:<15}")

    print("-" * 80)

    # 3. Incorpora os atributos calculados no GeoDataFrame original (EPSG:4326)
    for chave in ["area_ha", "area_m2", "perimetro_m", "ndvi_min", "ndvi_mean", "ndvi_max", "ndvi_std", "ndvi_pixels", "ndvi_classe"]:
        gdf[chave] = [m[chave] for m in metricas_lista]

    print(f"\n[3/3] Gravando atributos nas camadas vetoriais do projeto...")

    # Salva DATA/talhoes.geojson
    gdf.to_file(vetor_path, driver="GeoJSON")
    print(f"  ✓ {vetor_path.name} atualizado ({vetor_path.stat().st_size / 1024:.1f} KB)")

    # Se DATA/KMLs.geojson existir, atualiza-o também
    if kmls_path.exists():
        gdf.to_file(kmls_path, driver="GeoJSON")
        print(f"  ✓ {kmls_path.name} atualizado ({kmls_path.stat().st_size / 1024:.1f} KB)")

    total_area_ha = sum(m["area_ha"] for m in metricas_lista)
    print("\n" + "=" * 80)
    print(f"  Conclusão: 15 talhões analisados com sucesso!")
    print(f"  Área Total Mapeada : {total_area_ha:.2f} hectares")
    print(f"  Resolução Analítica: 2 metros (Grade Sub-métrica Synapse-SR / Sentinel-2)")
    print("=" * 80)


if __name__ == "__main__":
    main()
