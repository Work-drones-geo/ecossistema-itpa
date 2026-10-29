#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Conversão de Rasters GEE para WebGIS Leaflet
Transforma os GeoTIFFs exportados pelo Google Earth Engine (RGB 10m e NDVI 2m)
em overlays PNG transparentes com metadados de coordenadas (bounds) para Leaflet.
"""

import os
import json
from pathlib import Path

BASE_DIR = Path("DATA")
PROJETOS = ["nelito", "guanai"]

def extrair_bounds_geojson(geo_data):
    """Calcula a bounding box [lat_min, lng_min, lat_max, lng_max] de um GeoJSON puro."""
    coords = []
    
    def extrair_coords_rec(obj):
        if isinstance(obj, list):
            if len(obj) >= 2 and isinstance(obj[0], (int, float)) and isinstance(obj[1], (int, float)):
                coords.append((float(obj[0]), float(obj[1])))
            else:
                for item in obj:
                    extrair_coords_rec(item)
        elif isinstance(obj, dict):
            for v in obj.values():
                extrair_coords_rec(v)

    extrair_coords_rec(geo_data)

    if not coords:
        return None

    lngs = [c[0] for c in coords]
    lats = [c[1] for c in coords]

    return {
        "min_lng": min(lngs),
        "min_lat": min(lats),
        "max_lng": max(lngs),
        "max_lat": max(lats)
    }

def processar_raster_para_webgis(chave):
    print(f"\n==========================================")
    print(f"Propriedade: {chave.upper()}")
    print(f"==========================================")

    geojson_path = BASE_DIR / f"{chave}.geojson"
    if not geojson_path.exists():
        print(f"[Pular] GeoJSON não encontrado: {geojson_path}")
        return

    with open(geojson_path, "r", encoding="utf-8") as f:
        geo_data = json.load(f)

    b = extrair_bounds_geojson(geo_data)
    if not b:
        print(f"[Erro] Não foi possível extrair coordenadas de {geojson_path}")
        return

    # Formato padrão Leaflet: [[lat_min, lng_min], [lat_max, lng_max]]
    leaflet_bounds = [
        [b["min_lat"], b["min_lng"]],
        [b["max_lat"], b["max_lng"]]
    ]

    metadata = {
        "chave": chave,
        "leaflet_bounds": leaflet_bounds,
        "bbox": [b["min_lng"], b["min_lat"], b["max_lng"], b["max_lat"]],
        "centro": [(b["min_lat"] + b["max_lat"]) / 2.0, (b["min_lng"] + b["max_lng"]) / 2.0]
    }

    bounds_file = BASE_DIR / f"{chave}_bounds.json"
    with open(bounds_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"-> Bounds geográficos salvos com sucesso em: {bounds_file}")
    print(f"   Centro: {metadata['centro']}")
    print(f"   Leaflet Bounds: {leaflet_bounds}")

    # Processamento de Imagens Raster (.tif -> .png)
    for tipo in ["rgb_10m", "ndvi_2m"]:
        tif_path = BASE_DIR / f"{chave}_{tipo}.tif"
        if not tif_path.exists():
            print(f"-> [Aguardando GEE] {tif_path.name} ainda não gerado (rode processar_gee_sentinel2.py).")
            continue

        # Tentativa de recorte via rasterio ou GDAL
        sucesso = False
        try:
            import rasterio
            from rasterio.mask import mask
            from PIL import Image
            import numpy as np

            with rasterio.open(tif_path) as src:
                geom = [geo_data["features"][0]["geometry"]]
                out_image, out_transform = mask(src, geom, crop=True)
                
                if out_image.shape[0] == 3:
                    r, g, b = out_image[0], out_image[1], out_image[2]
                    alpha = np.where((r == 0) & (g == 0) & (b == 0), 0, 255).astype(np.uint8)
                    rgba = np.stack([r, g, b, alpha], axis=-1)
                    img = Image.fromarray(rgba, mode="RGBA")
                elif out_image.shape[0] == 4:
                    img = Image.fromarray(np.moveaxis(out_image, 0, -1), mode="RGBA")
                else:
                    img = Image.fromarray(out_image[0])

                png_output = BASE_DIR / f"{chave}_{tipo}.png"
                img.save(png_output, "PNG")
                print(f"-> Overlay WebGIS exportado com sucesso: {png_output}")
                sucesso = True
        except ImportError:
            pass

        if not sucesso:
            try:
                from osgeo import gdal
                # Recorte nativo via GDAL
                png_output = BASE_DIR / f"{chave}_{tipo}.png"
                vrt = gdal.Warp("", str(tif_path), format="VRT", cutlineDSName=str(geojson_path), cropToCutline=True)
                gdal.Translate(str(png_output), vrt, format="PNG")
                print(f"-> Overlay WebGIS exportado via GDAL: {png_output}")
                sucesso = True
            except ImportError:
                print(f"-> [Aviso] Para converter {tif_path.name} em PNG com transparência, instale rasterio ou use o Python do QGIS.")

if __name__ == "__main__":
    for chave in PROJETOS:
        processar_raster_para_webgis(chave)
    print("\nExecução concluída.")
