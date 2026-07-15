import geopandas as gpd
import os
import pandas as pd
import hashlib
import json
from datetime import datetime

# Caminhos dinâmicos
project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
gpkg_path = os.path.join(project_dir, "GeoPackageApui.gpkg")
output_dir = os.path.join(project_dir, "fgis", "data")


def _sha256_arquivo(caminho, bloco=1024 * 1024):
    """Calcula o hash SHA-256 de um arquivo, lido em blocos (seguro para arquivos grandes)."""
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for chunk in iter(lambda: f.read(bloco), b""):
            h.update(chunk)
    return h.hexdigest()


def _injetar_metadados_rastreabilidade(geojson_path, source_gpkg_path):
    """
    Adiciona metadados de rastreabilidade ao nível raiz do GeoJSON exportado:
    - generated_at: timestamp ISO 8601 da geração do arquivo derivado
    - source_gpkg: nome do GeoPackage de origem
    - source_gpkg_sha256: hash de integridade do GeoPackage no momento da exportação
    - source_gpkg_mtime: data de última modificação do GeoPackage de origem

    Isso permite, a qualquer momento, confirmar de qual versão exata da base geoespacial
    um determinado GeoJSON (e, por consequência, um plano de voo em KML) foi derivado —
    requisito básico de rastreabilidade para uso em laudos e notas técnicas.
    """
    with open(geojson_path, "r", encoding="utf-8") as f:
        gj = json.load(f)

    gj["generated_at"] = datetime.now().isoformat(timespec="seconds")
    gj["source_gpkg"] = os.path.basename(source_gpkg_path)
    gj["source_gpkg_sha256"] = _sha256_arquivo(source_gpkg_path)
    gj["source_gpkg_mtime"] = datetime.fromtimestamp(
        os.path.getmtime(source_gpkg_path)
    ).isoformat(timespec="seconds")

    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(gj, f, ensure_ascii=False)

    print(f"  - Metadados de rastreabilidade gravados em: {geojson_path}")





def export_geopackage():
    print(f"Lendo GeoPackage de: {gpkg_path}")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Diretorio criado: {output_dir}")

    # 1. Carregar e exportar Áreas
    print("Exportando camadas de areas...")
    try:
        area1 = gpd.read_file(gpkg_path, layer="AREAS_AREA_01_kmz")
        print(f"  - AREA_01 lida com sucesso ({len(area1)} feicoes)")
    except Exception as e:
        print(f"  - Erro ao ler AREA_01: {e}")
        area1 = None

    try:
        area2 = gpd.read_file(gpkg_path, layer="AREAS_AREA_02_kmz")
        print(f"  - AREA_02 lida com sucesso ({len(area2)} feicoes)")
    except Exception as e:
        print(f"  - Erro ao ler AREA_02: {e}")
        area2 = None

    # Combinar as áreas se ambas existirem
    areas_list = [a for a in [area1, area2] if a is not None]
    combined_areas_df = None
    if areas_list:
        combined_areas_df = gpd.GeoDataFrame(pd.concat(areas_list, ignore_index=True), crs=areas_list[0].crs)
        areas_geojson_path = os.path.join(output_dir, "areas.geojson")
        combined_areas_df.to_file(areas_geojson_path, driver="GeoJSON")
        _injetar_metadados_rastreabilidade(areas_geojson_path, gpkg_path)
        print(f"Areas exportadas para: {areas_geojson_path}")
    else:
        print("Erro: Nenhuma camada de area foi carregada.")

    # 2. Carregar e exportar Pontos
    print("Exportando camada de pontos...")
    try:
        pontos = gpd.read_file(gpkg_path, layer="PONTOS_PONTOS_kmz")
        pontos_geojson_path = os.path.join(output_dir, "pontos.geojson")
        pontos.to_file(pontos_geojson_path, driver="GeoJSON")
        _injetar_metadados_rastreabilidade(pontos_geojson_path, gpkg_path)
        print(f"Pontos exportados para: {pontos_geojson_path} ({len(pontos)} feicoes)")
    except Exception as e:
        print(f"Erro ao exportar pontos: {e}")

    # 3. Exportar Curvas de Nível (Mestras e Normais combinadas)
    export_contours(combined_areas_df)

    # 4. Exportar Estradas Vicinais (linhas)
    export_vicinais(combined_areas_df)

    # 5. Gerar HTML portátil único contendo todos os dados embutidos
    build_portable_html()


def export_contours(combined_areas):
    mestras_path = os.path.join(project_dir, "CurvasMestras", "CurvasMestras.gpkg")
    normais_path = os.path.join(project_dir, "CurvasMestras", "CurvasNormais.gpkg")
    
    if not os.path.exists(mestras_path) or not os.path.exists(normais_path):
        print("Aviso: Arquivos GPKG em 'CurvasMestras' nao encontrados. Pulando exportacao de curvas.")
        return

    print("Lendo e combinando curvas de nivel (Mestras e Normais)...")
    try:
        curvas_mestras = gpd.read_file(mestras_path)
        curvas_mestras['is_mestra'] = 1
        print(f"  - Curvas Mestras lidas ({len(curvas_mestras)} feicoes)")

        curvas_normais = gpd.read_file(normais_path)
        curvas_normais['is_mestra'] = 0
        print(f"  - Curvas Normais lidas ({len(curvas_normais)} feicoes)")

        # Combinar
        curvas = gpd.GeoDataFrame(pd.concat([curvas_mestras, curvas_normais], ignore_index=True), crs=curvas_mestras.crs)

        # Recortar usando bounding box das areas + buffer
        if combined_areas is not None and len(combined_areas) > 0:
            areas_4326 = combined_areas
            if combined_areas.crs is not None and combined_areas.crs.to_epsg() != 4326:
                areas_4326 = combined_areas.to_crs(epsg=4326)
            bbox = areas_4326.total_bounds # [minx, miny, maxx, maxy]
            buffer = 0.05 # ~5.5 km
            minx, miny, maxx, maxy = bbox
            bbox_buffered = [minx - buffer, miny - buffer, maxx + buffer, maxy + buffer]

            print("  - Recortando curvas no envelope das glebas (com buffer de ~5.5 km)...")
            curvas = curvas.cx[bbox_buffered[0]:bbox_buffered[2], bbox_buffered[1]:bbox_buffered[3]]
            print(f"  - Curvas filtradas espacialmente ({len(curvas)} feicoes restantes)")

        # Simplificar as curvas para reduzir peso do GeoJSON
        print("  - Simplificando geometrias das curvas (tolerancia = 0.0001)...")
        curvas['geometry'] = curvas.simplify(tolerance=0.0001, preserve_topology=True)

        curvas_geojson_path = os.path.join(output_dir, "curvas.geojson")
        curvas.to_file(curvas_geojson_path, driver="GeoJSON")
        # Usar o arquivo de curvas mestras como base de mtime para a rastreabilidade
        _injetar_metadados_rastreabilidade(curvas_geojson_path, mestras_path)
        print(f"Curvas exportadas para: {curvas_geojson_path}")

    except Exception as e:
        print(f"Erro ao processar curvas de nivel: {e}")


def export_vicinais(combined_areas):
    vicinais_gpkg = os.path.join(project_dir, "VICINAIS", "Vicinais.gpkg")
    if not os.path.exists(vicinais_gpkg):
        print("Aviso: Arquivo GPKG de vicinais nao encontrado. Pulando exportacao de vicinais.")
        return

    print("Exportando camada de vicinais...")
    try:
        vicinais = gpd.read_file(vicinais_gpkg)
        print(f"  - Vicinais lidas com sucesso ({len(vicinais)} feicoes)")

        # Reprojetar para EPSG:4326 se necessario
        if vicinais.crs is not None and vicinais.crs.to_epsg() != 4326:
            print("  - Reprojetando vicinais para EPSG:4326...")
            vicinais = vicinais.to_crs(epsg=4326)

        # Recortar usando bounding box das areas + buffer
        if combined_areas is not None and len(combined_areas) > 0:
            areas_4326 = combined_areas
            if combined_areas.crs is not None and combined_areas.crs.to_epsg() != 4326:
                areas_4326 = combined_areas.to_crs(epsg=4326)
            bbox = areas_4326.total_bounds # [minx, miny, maxx, maxy]
            buffer = 0.05 # ~5.5 km
            minx, miny, maxx, maxy = bbox
            bbox_buffered = [minx - buffer, miny - buffer, maxx + buffer, maxy + buffer]

            print("  - Recortando vicinais no envelope das glebas (com buffer de ~5.5 km)...")
            vicinais = vicinais.cx[bbox_buffered[0]:bbox_buffered[2], bbox_buffered[1]:bbox_buffered[3]]
            print(f"  - Vicinais filtradas espacialmente ({len(vicinais)} feicoes restantes)")

        vicinais_geojson_path = os.path.join(output_dir, "vicinais.geojson")
        vicinais.to_file(vicinais_geojson_path, driver="GeoJSON")
        _injetar_metadados_rastreabilidade(vicinais_geojson_path, vicinais_gpkg)
        print(f"Vicinais exportadas para: {vicinais_geojson_path}")

    except Exception as e:
        print(f"Erro ao processar vicinais: {e}")


def build_portable_html():
    index_path = os.path.join(output_dir, "..", "index.html")
    style_path = os.path.join(output_dir, "..", "style.css")
    app_path = os.path.join(output_dir, "..", "app.js")
    output_path = os.path.join(output_dir, "..", "fgis_portatil.html")

    if not all(os.path.exists(p) for p in [index_path, style_path, app_path]):
        print("Aviso: Arquivos base index/style/app nao encontrados para gerar HTML portatil.")
        return

    print("Compilando arquivo HTML portatil unico (fgis_portatil.html)...")
    try:
        import re
        
        with open(index_path, "r", encoding="utf-8") as f:
            html = f.read()
        with open(style_path, "r", encoding="utf-8") as f:
            css = f.read()
        with open(app_path, "r", encoding="utf-8") as f:
            js = f.read()

        def load_geojson_content(filename):
            path = os.path.join(output_dir, filename)
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return f.read()
            return "null"

        areas_json = load_geojson_content("areas.geojson")
        pontos_json = load_geojson_content("pontos.geojson")
        curvas_json = load_geojson_content("curvas.geojson")
        vicinais_json = load_geojson_content("vicinais.geojson")

        # Substituir o CSS
        css_match = re.search(r'<link\s+rel="stylesheet"\s+href="style\.css(?:\?v=[^"]*)?">', html)
        if css_match:
            html = html.replace(css_match.group(0), f"<style>\n{css}\n</style>")

        # Substituir o JS e injetar GeoJSONs
        js_match = re.search(r'<script\s+src="app\.js(?:\?v=[^"]*)?"></script>', html)
        if js_match:
            js_block = f"""<script>
// DADOS PORTATEIS INJETADOS STATICAMENTE
window.PORTABLE_AREAS = {areas_json};
window.PORTABLE_PONTOS = {pontos_json};
window.PORTABLE_CURVAS = {curvas_json};
window.PORTABLE_VICINAIS = {vicinais_json};

{js}
</script>"""
            html = html.replace(js_match.group(0), js_block)

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html)
            
        print(f"  - HTML portatil compilado com sucesso: {os.path.basename(output_path)} ({os.path.getsize(output_path) / (1024*1024):.2f} MB)")

    except Exception as e:
        print(f"Erro ao compilar HTML portatil: {e}")


if __name__ == "__main__":
    export_geopackage()
