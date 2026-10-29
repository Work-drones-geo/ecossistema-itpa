#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Pipeline GEE Sentinel-2 L2A (Harmonized)
Processamento automatizado de imagens Sentinel-2 para Fazenda Nelito e Fazenda Guanaí:
1. Filtragem de nuvens e sombras via máscara SCL (Scene Classification Layer).
2. Composição mediana temporal dos últimos 60 dias.
3. Exportação RGB Nativo (10m) com calibração anti-estouro (clamp 0 a 0.28).
4. Exportação NDVI Reamostrado (2m bicúbico) com paleta contínua de 8 classes de biomassa.
"""

import os
import json
import ee
import geemap

# 1. Inicialização do Google Earth Engine
# Dica: Em versões recentes da API, forneça o ID do projeto GCP: ee.Initialize(project='seu-projeto-gcp')
try:
    ee.Initialize()
except Exception as e:
    print(f"[GEE] Inicialização padrão falhou ({e}), tentando autenticação...")
    ee.Authenticate()
    ee.Initialize()

# 2. Configurações e Caminhos
BASE_DIR = "DATA"
PROJETOS = {
    "nelito": {
        "geojson": os.path.join(BASE_DIR, "nelito.geojson"),
        "nome": "Fazenda Nelito"
    },
    "guanai": {
        "geojson": os.path.join(BASE_DIR, "guanai.geojson"),
        "nome": "Fazenda Guanaí"
    }
}

# 3. Funções de Pré-processamento Sentinel-2 L2A (Harmonized)
def mascarar_nuvens_scl(image):
    """
    Usa a camada SCL (Scene Classification Layer) para filtrar:
    - Sombra de nuvem (3)
    - Nuvem de média/alta probabilidade (8, 9)
    - Cirrus fino (10)
    - Neve/Gelo (11)
    """
    scl = image.select('SCL')
    mascara_valida = scl.neq(3).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11))
    
    # Fator de escala oficial L2A (10000 para reflectância 0.0 a 1.0)
    scaled = image.select(['B2', 'B3', 'B4', 'B8']).divide(10000)
    return scaled.updateMask(mascara_valida).copyProperties(image, ['system:time_start'])

def processar_propriedade(chave, config):
    print(f"\n==========================================")
    print(f"Processando: {config['nome']} ({chave})")
    print(f"==========================================")
    
    caminho_geojson = config["geojson"]
    if not os.path.exists(caminho_geojson):
        print(f"[ERRO] Arquivo GeoJSON não encontrado: {caminho_geojson}")
        return

    with open(caminho_geojson, 'r', encoding='utf-8') as f:
        geo_data = json.load(f)
    
    # Converte feição para geometria EE
    ee_feature = geemap.geojson_to_ee(geo_data)
    roi = ee_feature.geometry()
    
    # Busca a imagem mais recente com baixa nebulosidade nos últimos 60 dias
    colecao = (ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
               .filterBounds(roi)
               .filterDate('2026-08-01', '2026-10-29')
               .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
               .map(mascarar_nuvens_scl)
               .sort('system:time_start', False))
    
    # Composição pela mediana dos pixels limpos mais recentes (até 3 imagens)
    imagem = colecao.limit(3).median().clip(roi)
    
    # ----------------------------------------------------
    # A. RGB NATIVO (10 METROS) - BLINDADO CONTRA MANCHAS ROXAS
    # ----------------------------------------------------
    # Estiramento fixo e seguro (0 a 0.28 de reflectância)
    # Evita saturação que transforma clareiras e estradas em tons roxos/magenta
    rgb_visual = imagem.select(['B4', 'B3', 'B2']).clamp(0.0, 0.28).unitScale(0.0, 0.28).multiply(255).toUint8()
    
    rgb_output = os.path.join(BASE_DIR, f"{chave}_rgb_10m.tif")
    print(f"-> Exportando RGB 10m (resolução nativa) para: {rgb_output}")
    geemap.ee_export_image(
        rgb_visual,
        filename=rgb_output,
        scale=10,
        region=roi,
        file_per_band=False
    )
    
    # ----------------------------------------------------
    # B. NDVI REAMOSTRADO (2 METROS) COM RAMPA DE CORES
    # ----------------------------------------------------
    ndvi = imagem.normalizedDifference(['B8', 'B4']).rename('NDVI')
    
    # Reamostragem contínua bicúbica para 2 metros
    ndvi_2m = ndvi.resample('bicubic')
    
    # Rampa padrão profissional de biomassa (Vermelho -> Amarelo -> Verde Escuro)
    # Faixa: -0.1 a 0.85
    paleta_ndvi = [
        '#d73027', # Solo exposto / água (-0.1 a 0.1)
        '#f46d43', # Vegetação rasteira seca (0.1 a 0.25)
        '#fdae61', # Transição / pasto degradado (0.25 a 0.4)
        '#fee08b', # Pastagem em regeneração (0.4 a 0.5)
        '#d9ef8b', # Capoeira / regeneração inicial (0.5 a 0.6)
        '#a6d96a', # Dossel em formação (0.6 a 0.7)
        '#66bd63', # Floresta densa / restauração consolidada (0.7 a 0.8)
        '#1a9850'  # Mata Atlântica primária / densa (> 0.8)
    ]
    
    ndvi_colorizado = ndvi_2m.visualize(
        min=-0.1,
        max=0.85,
        palette=paleta_ndvi
    )
    
    ndvi_output = os.path.join(BASE_DIR, f"{chave}_ndvi_2m.tif")
    print(f"-> Exportando NDVI 2m (colorizado suave) para: {ndvi_output}")
    geemap.ee_export_image(
        ndvi_colorizado,
        filename=ndvi_output,
        scale=2,
        region=roi,
        file_per_band=False
    )

if __name__ == "__main__":
    for chave, config in PROJETOS.items():
        processar_propriedade(chave, config)
    print("\nProcessamento concluído com sucesso!")
