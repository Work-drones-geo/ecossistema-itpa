#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Ecossistema ITPA - Pipeline de Super-Resolução Sentinel-2 (2 Metros) & COG NDVI
Módulo responsável por executar super-resolução espacial (10m -> 2m) via Synapse-SR,
recorte prévio do envelope da área de interesse (AOI) e exportação de NDVI em
formato Cloud Optimized GeoTIFF (COG) comprimido.

Autor: Antigravity AI / Work Drones Geo
Projeto: Ecossistema ITPA - Restauração Florestal
"""

import os
import sys
import argparse
from pathlib import Path
from typing import Optional, Union, Tuple

import numpy as np
import rasterio
from rasterio.mask import mask
from rasterio.enums import Resampling
import geopandas as gpd
from shapely.geometry import box
import synapse_sr


class ITPASuperResolutionPipeline:
    """
    Pipeline de super-resolução geoespacial para o projeto ITPA.
    
    Aplica modelos de redes neurais profundas (Synapse-SR Flash/Pro) em imagens orbitais
    Sentinel-2 L2A para sintetizar bandas de alta resolução (2 metros/pixel) e gerar
    índices de vigor vegetativo (NDVI) com qualidade sub-métrica, salvos em formato COG.
    """

    def __init__(self, model_type: str = 'flash', device: Optional[str] = None):
        """
        Inicializa o pipeline de super-resolução.

        :param model_type: Tipo de modelo Synapse-SR ('flash' para alta velocidade, 'pro' para detalhes finos).
        :param device: Dispositivo de execução ('cuda', 'cpu' ou None para detecção automática).
        """
        self.model_type = model_type.lower()
        self.device = device

        print(f"[ITPASuperResolutionPipeline] Inicializado com sucesso.")
        print(f"  - Modelo Synapse-SR : {self.model_type.upper()}")
        print(f"  - Dispositivo de inferência : {self.device if self.device else 'Detecção Automática (GPU/CPU)'}")

    def crop_to_aoi(
        self,
        input_raster: Union[str, Path],
        vector_path: Union[str, Path],
        output_crop_path: Union[str, Path],
        buffer_meters: float = 0.0
    ) -> Path:
        """
        Recorta apenas o envelope/bounding box da área de interesse (AOI) a partir
        de uma camada vetorial (GeoJSON/KML/SHP) antes da inferência, economizando
        tempo computacional e consumo de memória.

        :param input_raster: Caminho do arquivo raster de entrada (Sentinel-2 TIFF original).
        :param vector_path: Caminho da camada vetorial com os talhões/quadrantes.
        :param output_crop_path: Caminho onde o GeoTIFF recortado pelo envelope será salvo.
        :param buffer_meters: Margem opcional de expansão ao redor do envelope (em metros).
        :return: Path do arquivo recortado gerado.
        """
        input_raster = Path(input_raster)
        vector_path = Path(vector_path)
        output_crop_path = Path(output_crop_path)

        if not input_raster.exists():
            raise FileNotFoundError(f"Raster de entrada não encontrado: {input_raster}")
        if not vector_path.exists():
            raise FileNotFoundError(f"Vetor de talhões não encontrado: {vector_path}")

        output_crop_path.parent.mkdir(parents=True, exist_ok=True)

        print(f"[crop_to_aoi] Lendo camada vetorial: {vector_path.name}")
        gdf = gpd.read_file(vector_path)

        if gdf.empty:
            raise ValueError(f"A camada vetorial {vector_path} não contém geometrias válidas.")

        with rasterio.open(input_raster) as src:
            raster_crs = src.crs
            print(f"[crop_to_aoi] CRS do Raster: {raster_crs} | CRS do Vetor original: {gdf.crs}")

            # Harmoniza o CRS do vetor com o SRC do raster
            if gdf.crs != raster_crs:
                print(f"[crop_to_aoi] Reprojetando vetor para o CRS do raster ({raster_crs})...")
                gdf = gdf.to_crs(raster_crs)

            # Extrai o envelope total (bounding box) de todos os talhões
            minx, miny, maxx, maxy = gdf.total_bounds
            if buffer_meters > 0:
                minx -= buffer_meters
                miny -= buffer_meters
                maxx += buffer_meters
                maxy += buffer_meters

            aoi_envelope = box(minx, miny, maxx, maxy)
            shapes = [aoi_envelope]

            print(
                f"[crop_to_aoi] Bounding Box da AOI: "
                f"minX={minx:.4f}, minY={miny:.4f}, maxX={maxx:.4f}, maxY={maxy:.4f}"
            )

            # Recorte rápido pelo envelope retangular
            out_image, out_transform = mask(src, shapes, crop=True, all_touched=True)
            out_meta = src.meta.copy()

            out_meta.update({
                "driver": "GTiff",
                "height": out_image.shape[1],
                "width": out_image.shape[2],
                "transform": out_transform
            })

            with rasterio.open(output_crop_path, "w", **out_meta) as dest:
                dest.write(out_image)

        print(f"[crop_to_aoi] ✓ Envelope recortado salvo em: {output_crop_path} "
              f"({out_image.shape[2]}x{out_image.shape[1]} pixels, {out_image.shape[0]} bandas)")
        return output_crop_path

    def run_super_resolution(
        self,
        input_tiff: Union[str, Path],
        output_2m_tiff: Union[str, Path],
        with_confidence: bool = True
    ) -> synapse_sr.Result:
        """
        Executa a super-resolução profunda via Synapse-SR, elevando a resolução
        espacial nativa de 10m para 2m com predição de incerteza por pixel.

        :param input_tiff: Caminho do GeoTIFF de entrada (recortado ou cena completa).
        :param output_2m_tiff: Caminho onde o GeoTIFF super-resolvido a 2m será gravado.
        :param with_confidence: Se True, grava bandas auxiliares de escala de erro e suporte.
        :return: Objeto synapse_sr.Result com as bandas estimadas e métodos auxiliares.
        """
        input_tiff = Path(input_tiff)
        output_2m_tiff = Path(output_2m_tiff)

        if not input_tiff.exists():
            raise FileNotFoundError(f"Arquivo de entrada não encontrado: {input_tiff}")

        output_2m_tiff.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n[run_super_resolution] Iniciando super-resolução via Synapse-SR...")
        print(f"  - Entrada : {input_tiff}")
        print(f"  - Modelo  : {self.model_type}")
        print(f"  - Destino : {output_2m_tiff}")

        # Chamada direta da engine Synapse-SR
        result = synapse_sr.super_resolve(
            str(input_tiff),
            model=self.model_type,
            device=self.device
        )

        print(f"[run_super_resolution] Inferência concluída. Salvando GeoTIFF super-resolvido a 2m...")
        result.save(str(output_2m_tiff), with_confidence=with_confidence, cog=False)

        print(f"[run_super_resolution] ✓ Imagem a 2 metros salva com sucesso em: {output_2m_tiff}")
        return result

    def compute_and_export_cog_ndvi(
        self,
        input_2m_tiff: Union[str, Path, synapse_sr.Result],
        output_ndvi_cog: Union[str, Path]
    ) -> Path:
        """
        Calcula o NDVI na resolução de 2 metros a partir das bandas super-resolvidas
        (NIR e Vermelho) e exporta em Cloud Optimized GeoTIFF (COG) comprimido com pirâmides internas.

        :param input_2m_tiff: Caminho do TIFF a 2m gerado pelo Synapse-SR ou o objeto synapse_sr.Result.
        :param output_ndvi_cog: Caminho de saída para o arquivo COG do NDVI.
        :return: Path do arquivo COG gerado.
        """
        output_ndvi_cog = Path(output_ndvi_cog)
        output_ndvi_cog.parent.mkdir(parents=True, exist_ok=True)

        print(f"\n[compute_and_export_cog_ndvi] Calculando NDVI e estruturando COG...")

        # Caso 1: Objeto synapse_sr.Result direto
        if isinstance(input_2m_tiff, synapse_sr.Result):
            ndvi_array = input_2m_tiff.ndvi()
            profile = input_2m_tiff.profile.copy() if input_2m_tiff.profile else {}
            crs = profile.get("crs")
            transform = profile.get("transform")
        else:
            # Caso 2: Leitura do GeoTIFF salvo a 2 metros
            input_path = Path(input_2m_tiff)
            if not input_path.exists():
                raise FileNotFoundError(f"Arquivo GeoTIFF de 2m não encontrado: {input_path}")

            with rasterio.open(input_path) as src:
                profile = src.profile.copy()
                crs = src.crs
                transform = src.transform
                num_bands = src.count

                print(f"[compute_and_export_cog_ndvi] Raster de entrada possui {num_bands} bandas.")

                if num_bands >= 4:
                    # Conforme convenção Synapse-SR: Banda 1 = B04 (Red), Banda 4 = B08 (NIR)
                    red = src.read(1).astype(np.float32)
                    nir = src.read(4).astype(np.float32)

                    # Cálculo agronômico robusto de NDVI: (NIR - RED) / (NIR + RED)
                    denom = nir + red
                    ndvi_array = np.where(
                        (denom > 0) & np.isfinite(denom),
                        (nir - red) / denom,
                        np.nan
                    )
                else:
                    # Fallback para raster de 1 canal (caso já seja NDVI) ou cálculo aproximado
                    print("[compute_and_export_cog_ndvi] Aviso: Menos de 4 bandas detectadas. Lendo banda 1.")
                    ndvi_array = src.read(1).astype(np.float32)

        # Normaliza e limita intervalo físico do NDVI [-1.0, 1.0]
        ndvi_array = np.clip(ndvi_array, -1.0, 1.0)

        height, width = ndvi_array.shape

        # Metadados estritos para Cloud Optimized GeoTIFF (COG)
        cog_profile = {
            "driver": "GTiff",
            "dtype": "float32",
            "nodata": np.nan,
            "width": width,
            "height": height,
            "count": 1,
            "crs": crs,
            "transform": transform,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "compress": "deflate",
            "predictor": 3  # Predictor floating-point para máxima compressão
        }

        print(f"[compute_and_export_cog_ndvi] Gravando COG ({width}x{height} px, compress=deflate, tiled=256x256)...")
        with rasterio.open(output_ndvi_cog, "w", **cog_profile) as dest:
            dest.write(ndvi_array.astype(np.float32), 1)

            # Constrói níveis de pirâmide (overviews) para navegação fluida em mapas web e GIS
            overviews = [2, 4, 8, 16]
            dest.build_overviews(overviews, Resampling.average)
            dest.update_tags(ns="rio_overview", resampling="average")

        tamanho_mb = output_ndvi_cog.stat().st_size / (1024 * 1024)
        print(f"[compute_and_export_cog_ndvi] ✓ COG NDVI a 2 metros gerado com sucesso!")
        print(f"  - Arquivo COG : {output_ndvi_cog}")
        print(f"  - Tamanho     : {tamanho_mb:.2f} MB")
        return output_ndvi_cog


def localizar_dados_projeto(root_dir: Path) -> Tuple[Optional[Path], Optional[Path]]:
    """Localiza automaticamente o vetor de talhões e os TIFFs Sentinel-2 do projeto."""
    caminhos_vetor = [
        root_dir / "DATA" / "talhoes.geojson",
        root_dir / "DATA" / "KMLs.geojson",
        root_dir / "data" / "talhoes.geojson",
    ]
    vetor_path = next((p for p in caminhos_vetor if p.exists()), None)

    # Locais candidatos para rasters Sentinel-2
    candidatos_busca = [
        Path(os.path.expanduser("~/Downloads")),
        root_dir / "DATA",
        root_dir / "assets",
        root_dir / "dados_satelite",
        root_dir,
    ]

    raster_rgb = None
    for folder in candidatos_busca:
        if folder.exists():
            matches = list(folder.glob("*Sentinel-2*True_color*.tiff")) + \
                      list(folder.glob("*True_color*.tif*")) + \
                      list(folder.glob("*RGB*.tif*"))
            if matches:
                raster_rgb = matches[0]
                break

    return vetor_path, raster_rgb


if __name__ == "__main__":
    print("=" * 75)
    print("   ECOSSISTEMA ITPA - PIPELINE DE SUPER-RESOLUÇÃO & NDVI (2 METROS)")
    print("=" * 75)

    parser = argparse.ArgumentParser(
        description="Pipeline de Super-Resolução Sentinel-2 e Geração de COG NDVI para o ITPA"
    )
    parser.add_argument("--model", type=str, default="flash", choices=["flash", "pro"],
                        help="Modelo Synapse-SR ('flash' ou 'pro')")
    parser.add_argument("--device", type=str, default=None,
                        help="Dispositivo ('cuda', 'cpu' ou None)")
    parser.add_argument("--input-raster", type=str, default=None,
                        help="TIFF Sentinel-2 de entrada")
    parser.add_argument("--vector", type=str, default=None,
                        help="Camada vetorial de talhões (GeoJSON/KML)")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Diretório de saída para os rasters")

    args = parser.parse_args()

    # Resolução de diretórios padrão
    scripts_dir = Path(__file__).resolve().parent
    workspace_root = scripts_dir.parent
    assets_satelite_dir = workspace_root / "assets" / "satelite"
    assets_satelite_dir.mkdir(parents=True, exist_ok=True)

    vetor_encontrado, raster_encontrado = localizar_dados_projeto(workspace_root)

    vetor_path = Path(args.vector) if args.vector else vetor_encontrado
    input_raster_path = Path(args.input_raster) if args.input_raster else raster_encontrado
    out_base_dir = Path(args.output_dir) if args.output_dir else assets_satelite_dir

    print(f"\n[Configuração de Caminhos]")
    print(f"  - Pasta Scripts       : {scripts_dir}")
    print(f"  - Pasta Assets Satélite: {assets_satelite_dir}")
    print(f"  - Vetor de Talhões    : {vetor_path if vetor_path else 'Não encontrado'}")
    print(f"  - Raster Sentinel-2   : {input_raster_path if input_raster_path else 'Não encontrado'}")
    print(f"  - Destino dos Saídas  : {out_base_dir}")

    # Instancia o Pipeline
    pipeline = ITPASuperResolutionPipeline(model_type=args.model, device=args.device)

    if vetor_path and input_raster_path and vetor_path.exists() and input_raster_path.exists():
        try:
            print("\n[Execução de Demonstração]")
            crop_path = out_base_dir / "aoi_envelope_crop_10m.tif"
            sr_output_path = out_base_dir / "aoi_super_resolved_2m.tif"
            ndvi_cog_path = out_base_dir / "aoi_ndvi_2m_cog.tif"

            # 1. Recorte do Envelope da AOI
            pipeline.crop_to_aoi(
                input_raster=input_raster_path,
                vector_path=vetor_path,
                output_crop_path=crop_path,
                buffer_meters=50.0
            )

            # 2. Super-resolução
            sr_result = pipeline.run_super_resolution(
                input_tiff=crop_path,
                output_2m_tiff=sr_output_path
            )

            # 3. Cálculo de NDVI em COG
            pipeline.compute_and_export_cog_ndvi(
                input_2m_tiff=sr_result,
                output_ndvi_cog=ndvi_cog_path
            )

            print("\n[Sucesso] Pipeline concluído com sucesso!")
        except Exception as e:
            print(f"\n[Aviso na Execução] {e}")
            print("Para executar manualmente: python scripts/super_resolution_pipeline.py --help")
    else:
        print("\n[Modo Standalone] Módulo carregado e pronto para importação.")
        print("Exemplo de uso em outros scripts:")
        print("  from scripts.super_resolution_pipeline import ITPASuperResolutionPipeline")
        print("  pipeline = ITPASuperResolutionPipeline(model_type='flash')")
        print("  pipeline.crop_to_aoi('sentinel.tif', 'DATA/talhoes.geojson', 'crop.tif')")
        print("  pipeline.run_super_resolution('crop.tif', 'super_2m.tif')")
        print("  pipeline.compute_and_export_cog_ndvi('super_2m.tif', 'ndvi_2m_cog.tif')")

    print("\n" + "=" * 75)
