#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Módulo de Auditoria Socioambiental e Conformidade de Crédito
Conforme Resolução CMN nº 5.303/2026 (Crédito Rural e Regularidade Territorial)

Realiza o cruzamento espacial entre o polígono oficial do imóvel (CAR)
e as camadas oficiais de alertas de desmatamento PRODES (> 31/07/2019)
e embargos ambientais (IBAMA).

Sistema de Referência de Coordenadas: SIRGAS 2000 / UTM zone 23S (EPSG:31983).
"""

import os
import sys
import argparse
from pathlib import Path
from typing import Optional, Dict, Any

import geopandas as gpd
import pandas as pd


# SRC Padrão Oficial: SIRGAS 2000 / UTM Zona 23S
CRS_UTM_23S = "EPSG:31983"


def auditar_conformidade_cmn(
    caminho_car: str,
    caminho_prodes: str,
    caminho_embargos: Optional[str] = None,
    caminho_saida_geojson: Optional[str] = None
) -> Dict[str, Any]:
    """
    Executa a auditoria socioambiental cruzando o polígono do CAR com PRODES e Embargos.

    :param caminho_car: Caminho para o arquivo vetorial do CAR (GeoJSON/SHP/KML).
    :param caminho_prodes: Caminho para a camada vetorial do PRODES (alertas pós-2019).
    :param caminho_embargos: Caminho opcional para a camada de embargos ambientais do IBAMA.
    :param caminho_saida_geojson: Caminho opcional para salvar o polígono de sobreposição/corte.
    :return: Dicionário com métricas calculadas em hectares e status técnico de conformidade.
    """
    p_car = Path(caminho_car)
    p_prodes = Path(caminho_prodes)

    if not p_car.exists():
        raise FileNotFoundError(f"Arquivo vetorial do CAR não localizado: {caminho_car}")
    if not p_prodes.exists():
        raise FileNotFoundError(f"Arquivo vetorial do PRODES não localizado: {caminho_prodes}")

    print(f"\n[Auditoria CMN 5.303] Carregando camadas territoriais:")
    print(f"  - Imóvel / CAR : {p_car.name}")
    print(f"  - PRODES       : {p_prodes.name}")

    # 1. Leitura dos vetores
    gdf_car = gpd.read_file(p_car)
    gdf_prodes = gpd.read_file(p_prodes)

    if gdf_car.empty:
        return {
            "status": "Inconclusivo",
            "motivo": "Camada do CAR vazia (sem feições)",
            "area_total_ha": 0.0,
            "sobreposicao_prodes_ha": 0.0,
            "percentual_prodes_pct": 0.0,
            "sobreposicao_embargos_ha": 0.0,
            "elegivel_cmn_5303": False
        }

    # 2. Reprojeção métrica para SIRGAS 2000 UTM 23S (EPSG:31983)
    if gdf_car.crs != CRS_UTM_23S:
        print(f"  - Reprojetando CAR para {CRS_UTM_23S}...")
        gdf_car = gdf_car.to_crs(CRS_UTM_23S)

    if gdf_prodes.crs != CRS_UTM_23S:
        print(f"  - Reprojetando PRODES para {CRS_UTM_23S}...")
        gdf_prodes = gdf_prodes.to_crs(CRS_UTM_23S)

    # 3. Cálculo da Área Total do Imóvel em Hectares
    # 1 ha = 10.000 m²
    area_total_m2 = gdf_car.geometry.area.sum()
    area_total_ha = float(area_total_m2 / 10000.0)
    print(f"  - Área Total Auditada (CAR): {area_total_ha:.4f} ha")

    # 4. Cruzamento Espacial com PRODES (Intersection Overlay)
    sobreposicao_prodes_ha = 0.0
    gdf_intersecao_prodes = None

    if not gdf_prodes.empty:
        print(f"  - Executando intersecção espacial com PRODES...")
        gdf_intersecao_prodes = gpd.overlay(gdf_car, gdf_prodes, how="intersection")
        if not gdf_intersecao_prodes.empty:
            area_overlap_m2 = gdf_intersecao_prodes.geometry.area.sum()
            sobreposicao_prodes_ha = float(area_overlap_m2 / 10000.0)

    percentual_prodes = float((sobreposicao_prodes_ha / area_total_ha * 100.0) if area_total_ha > 0 else 0.0)
    print(f"  - Sobreposição PRODES pós-2019: {sobreposicao_prodes_ha:.4f} ha ({percentual_prodes:.2f}%)")

    # 5. Cruzamento opcional com Embargos IBAMA
    sobreposicao_embargos_ha = 0.0
    if caminho_embargos:
        p_embargos = Path(caminho_embargos)
        if p_embargos.exists():
            gdf_embargos = gpd.read_file(p_embargos)
            if not gdf_embargos.empty:
                if gdf_embargos.crs != CRS_UTM_23S:
                    gdf_embargos = gdf_embargos.to_crs(CRS_UTM_23S)
                gdf_intersecao_embargos = gpd.overlay(gdf_car, gdf_embargos, how="intersection")
                if not gdf_intersecao_embargos.empty:
                    sobreposicao_embargos_ha = float(gdf_intersecao_embargos.geometry.area.sum() / 10000.0)
            print(f"  - Sobreposição Embargos IBAMA: {sobreposicao_embargos_ha:.4f} ha")

    # 6. Avaliação de Conformidade nos termos da Resolução CMN nº 5.303/2026
    # Critério: Não pode haver sobreposição com desmatamento ilegal pós-2019 ou áreas embargadas
    elegivel = (sobreposicao_prodes_ha <= 0.0001) and (sobreposicao_embargos_ha <= 0.0001)
    status_conformidade = "Conforme" if elegivel else "Inconforme"

    resultado = {
        "status": status_conformidade,
        "area_total_ha": round(area_total_ha, 4),
        "sobreposicao_prodes_ha": round(sobreposicao_prodes_ha, 4),
        "percentual_prodes_pct": round(percentual_prodes, 2),
        "sobreposicao_embargos_ha": round(sobreposicao_embargos_ha, 4),
        "elegivel_cmn_5303": elegivel
    }

    # 7. Salva o GeoJSON de corte real caso haja intersecção
    if caminho_saida_geojson and gdf_intersecao_prodes is not None and not gdf_intersecao_prodes.empty:
        p_saida = Path(caminho_saida_geojson)
        p_saida.parent.mkdir(parents=True, exist_ok=True)
        # Exporta em WGS84 para visualização em WebGIS/QGIS
        gdf_intersecao_wgs84 = gdf_intersecao_prodes.to_crs("EPSG:4326")
        gdf_intersecao_wgs84.to_file(p_saida, driver="GeoJSON")
        print(f"  ✓ Polígono de corte/intersecção exportado: {p_saida}")
        resultado["arquivo_corte_geojson"] = str(p_saida)

    return resultado


def main():
    parser = argparse.ArgumentParser(
        description="Auditoria Territorial e Conformidade de Crédito Rural (Resolução CMN nº 5.303/2026)"
    )
    parser.add_argument(
        "--car", "-c", type=str, required=True,
        help="Caminho do arquivo vetorial com o perímetro oficial do CAR (GeoJSON/SHP/KML)"
    )
    parser.add_argument(
        "--prodes", "-p", type=str, required=True,
        help="Caminho do arquivo vetorial com alertas de desmatamento PRODES (> 31/07/2019)"
    )
    parser.add_argument(
        "--embargos", "-e", type=str, default=None,
        help="Caminho opcional do arquivo vetorial de embargos ambientais do IBAMA"
    )
    parser.add_argument(
        "--saida", "-s", type=str, default=None,
        help="Caminho opcional para exportar o GeoJSON do polígono de intersecção/sobreposição"
    )

    args = parser.parse_args()

    try:
        resultado = auditar_conformidade_cmn(
            caminho_car=args.car,
            caminho_prodes=args.prodes,
            caminho_embargos=args.embargos,
            caminho_saida_geojson=args.saida
        )

        print("\n" + "=" * 70)
        print("   RESULTADO DA AUDITORIA SOCIOAMBIENTAL (CMN 5.303/2026)")
        print("=" * 70)
        print(f"  Status de Regularidade : {resultado['status']}")
        print(f"  Elegibilidade Crédito  : {'ELEGÍVEL' if resultado['elegivel_cmn_5303'] else 'IMPEDITIVO / BLOQUEADO'}")
        print(f"  Área Total Auditada    : {resultado['area_total_ha']:.4f} ha")
        print(f"  Sobreposição PRODES    : {resultado['sobreposicao_prodes_ha']:.4f} ha ({resultado['percentual_prodes_pct']:.2f}%)")
        print(f"  Sobreposição Embargos  : {resultado['sobreposicao_embargos_ha']:.4f} ha")
        print("=" * 70)

    except Exception as err:
        print(f"\n[ERRO NA AUDITORIA] {err}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    # Sem arquivos simulados: se nenhum parâmetro for fornecido, encerra solicitando os caminhos
    if len(sys.argv) == 1:
        print("=" * 75)
        print("Módulo de Auditoria Socioambiental e Conformidade de Crédito (CMN 5.303/2026)")
        print("Uso obrigatório de parâmetros reais:")
        print("  python scripts/auditoria_cmn.py --car <caminho_car.geojson> --prodes <caminho_prodes.geojson>")
        print("Parâmetros opcionais:")
        print("  --embargos <caminho_ibama.geojson> --saida <corte_resultado.geojson>")
        print("=" * 75)
        sys.exit(0)

    main()
