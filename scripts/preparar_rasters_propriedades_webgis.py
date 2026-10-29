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

def processar_raster_para_webgis(chave):
    try:
        import rasterio
        from rasterio.mask import mask
        import geopandas as gpd
        from PIL import Image
        import numpy as np
    except ImportError:
        print("[Aviso] Bibliotecas rasterio/geopandas/PIL necessárias para gerar os overlays PNG.")
        return

    geojson_path = BASE_DIR / f"{chave}.geojson"
    if not geojson_path.exists():
        print(f"[Pular] {geojson_path} não encontrado.")
        return

    gdf = gpd.read_file(geojson_path)
    if gdf.crs != "EPSG:4326":
        gdf = gdf.to_crs("EPSG:4326")

    bounds = gdf.total_bounds # [minx, miny, maxx, maxy]
    metadata_bounds = {
        "chave": chave,
        "leaflet_bounds": [
            [float(bounds[1]), float(bounds[0])], # [lat_min, lng_min]
            [float(bounds[3]), float(bounds[2])]  # [lat_max, lng_max]
        ]
    }

    # Salva os bounds para uso no Leaflet
    with open(BASE_DIR / f"{chave}_bounds.json", "w", encoding="utf-8") as f:
        json.dump(metadata_bounds, f, indent=2)
    print(f"-> Bounds salvos em: {BASE_DIR / f'{chave}_bounds.json'}")

    for tipo in ["rgb_10m", "ndvi_2m"]:
        tif_path = BASE_DIR / f"{chave}_{tipo}.tif"
        if not tif_path.exists():
            print(f"[Aguardando] {tif_path} ainda não foi gerado pelo GEE.")
            continue

        with rasterio.open(tif_path) as src:
            # Recorta pela máscara vetorial da fazenda
            geom = [gdf.geometry.unary_union.__geo_interface__]
            out_image, out_transform = mask(src, geom, crop=True)
            
            # Se for 3 bandas (RGB), cria canal alfa (RGBA)
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
            print(f"-> Overlay WebGIS exportado: {png_output}")

if __name__ == "__main__":
    for chave in PROJETOS:
        processar_raster_para_webgis(chave)
