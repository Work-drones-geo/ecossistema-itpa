# Imagens de Satélite dos Talhões (RGB & NDVI)

Este diretório armazena os recortes georreferenciados em PNG com transparência (canal alfa) para sobreposição direta sobre cada talhão/quadrante no mapa Leaflet.

## Padrão de Nomenclatura dos Arquivos
Para cada talhão/quadrante (ex: `quadrante_1`, `quadrante_2`, ... `quadrante_15`):

- **RGB Recente:** `{talhaoId}_rgb_recente.png` (ex: `quadrante_1_rgb_recente.png`)
- **NDVI Recente:** `{talhaoId}_ndvi_recente.png` (ex: `quadrante_1_ndvi_recente.png`)
- **RGB Passagem Anterior (-15d):** `{talhaoId}_rgb_anterior.png` (ex: `quadrante_1_rgb_anterior.png`)
- **NDVI Passagem Anterior (-15d):** `{talhaoId}_ndvi_anterior.png` (ex: `quadrante_1_ndvi_anterior.png`)

## Especificações Técnicas
- Formato: PNG-24 ou PNG-32 com canal alfa (fundo transparente fora dos limites do talhão).
- Bounding Box: Ajustado exatamente às coordenadas do polígono do talhão.
- Opacidade configurada no Leaflet: 0.90 (com mapa base visível ao fundo).
