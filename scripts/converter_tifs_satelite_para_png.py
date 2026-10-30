import os
from osgeo import gdal
import numpy as np
from PIL import Image

SAT_DIR = os.path.join("assets", "satelite")
RASTERS_DIR = os.path.join("assets", "rasters")

tifs = [
    "nelito_rgb_10m.tif",
    "nelito_ndvi_2m.tif",
    "guanai_rgb_10m.tif",
    "guanai_ndvi_2m.tif"
]

print("=== CONVERTENDO TIFS 16-BIT PARA PNG 8-BIT RGBA TRANSPARENTE ===")

for tif_name in tifs:
    tif_path = os.path.join(SAT_DIR, tif_name)
    ds = gdal.Open(tif_path)
    if not ds:
        print(f"Erro ao abrir {tif_path}")
        continue
    
    w = ds.RasterXSize
    h = ds.RasterYSize
    nbands = ds.RasterCount
    print(f"\n-> {tif_name} ({w}x{h}, {nbands} bandas)")
    
    b1 = ds.GetRasterBand(1).ReadAsArray()
    b2 = ds.GetRasterBand(2).ReadAsArray()
    b3 = ds.GetRasterBand(3).ReadAsArray()
    
    # 16-bit to 8-bit: shift 8 bits
    r = (b1 >> 8).astype(np.uint8)
    g = (b2 >> 8).astype(np.uint8)
    b = (b3 >> 8).astype(np.uint8)
    
    if nbands >= 4:
        b4 = ds.GetRasterBand(4).ReadAsArray()
        a = (b4 >> 8).astype(np.uint8)
    else:
        # Se 3 bandas, alpha transparente onde R=G=B=0
        a = np.where((r == 0) & (g == 0) & (b == 0), 0, 255).astype(np.uint8)
    
    rgba = np.stack([r, g, b, a], axis=-1)
    img = Image.fromarray(rgba, mode="RGBA")
    
    base = os.path.splitext(tif_name)[0]
    out_sat = os.path.join(SAT_DIR, f"{base}.png")
    out_rast = os.path.join(RASTERS_DIR, f"{base}.png")
    
    img.save(out_sat, "PNG")
    img.save(out_rast, "PNG")
    
    print(f"   Exportado com sucesso para:")
    print(f"     - {out_sat} ({os.path.getsize(out_sat)} bytes)")
    print(f"     - {out_rast} ({os.path.getsize(out_rast)} bytes)")

print("\nConcluído!")
