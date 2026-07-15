"""
Script de auditoria/governanca dos GeoPackages do Projeto Apui.

Objetivo: comparar GeoPackageApui.gpkg (base corrente) com
GeoPackageApui_backup.gpkg (backup), reportando diferencas de camadas,
contagem de feicoes e datas de modificacao, para decidir com seguranca
qual arquivo eh a fonte de verdade antes de rodar fgis/export_data.py.

Este script NAO apaga nem renomeia nada automaticamente. Ele apenas
diagnostica e, ao final, sugere o comando de renomeacao (com sufixo de
data) para quem quiser aplicar manualmente o protocolo de nomenclatura
descrito em fgis/README.md.

Requisitos: geopandas (mesmo ambiente usado por fgis/export_data.py).
Uso:
    python check_gpkg_consistency.py
"""

import os
import hashlib
from datetime import datetime

import geopandas as gpd
import fiona

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
MAIN_GPKG = os.path.join(PROJECT_DIR, "GeoPackageApui.gpkg")
BACKUP_GPKG = os.path.join(PROJECT_DIR, "GeoPackageApui_backup.gpkg")


def sha256_arquivo(caminho, bloco=1024 * 1024):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for chunk in iter(lambda: f.read(bloco), b""):
            h.update(chunk)
    return h.hexdigest()


def resumo_gpkg(caminho):
    if not os.path.exists(caminho):
        return None

    layers = fiona.listlayers(caminho)
    contagens = {}
    for layer in layers:
        try:
            gdf = gpd.read_file(caminho, layer=layer)
            contagens[layer] = len(gdf)
        except Exception as e:
            contagens[layer] = f"ERRO ao ler: {e}"

    return {
        "path": caminho,
        "mtime": datetime.fromtimestamp(os.path.getmtime(caminho)).isoformat(timespec="seconds"),
        "size_mb": round(os.path.getsize(caminho) / (1024 * 1024), 3),
        "sha256": sha256_arquivo(caminho),
        "layers": layers,
        "feature_counts": contagens,
    }


def main():
    print("=" * 70)
    print("AUDITORIA DE CONSISTENCIA - GeoPackages Projeto Apui")
    print("=" * 70)

    main_info = resumo_gpkg(MAIN_GPKG)
    backup_info = resumo_gpkg(BACKUP_GPKG)

    for label, info in (("PRINCIPAL", main_info), ("BACKUP", backup_info)):
        print(f"\n[{label}] {MAIN_GPKG if label == 'PRINCIPAL' else BACKUP_GPKG}")
        if info is None:
            print("  -> Arquivo nao encontrado.")
            continue
        print(f"  Modificado em : {info['mtime']}")
        print(f"  Tamanho (MB)  : {info['size_mb']}")
        print(f"  SHA-256       : {info['sha256']}")
        print(f"  Camadas       : {info['layers']}")
        for layer, count in info["feature_counts"].items():
            print(f"    - {layer}: {count} feicoes")

    print("\n" + "-" * 70)
    if main_info is None or backup_info is None:
        print("Nao foi possivel comparar: um dos arquivos esta ausente.")
        return

    if main_info["sha256"] == backup_info["sha256"]:
        print("RESULTADO: os arquivos sao BIT-A-BIT IDENTICOS.")
        print("O backup pode ser considerado redundante nesta versao.")
    else:
        mesmas_camadas = main_info["layers"] == backup_info["layers"]
        mesmas_contagens = main_info["feature_counts"] == backup_info["feature_counts"]
        print("RESULTADO: os arquivos sao DIFERENTES (hash distinto).")
        print(f"  Mesmas camadas?        {'sim' if mesmas_camadas else 'NAO'}")
        print(f"  Mesmas contagens?      {'sim' if mesmas_contagens else 'NAO'}")
        if not mesmas_camadas or not mesmas_contagens:
            print("  -> Diferenca de CONTEUDO, nao apenas de metadados. Investigar")
            print("     antes de descartar qualquer um dos dois arquivos.")

    # Sugestao de nomenclatura com data, sem executar nada automaticamente
    data_tag = datetime.fromtimestamp(os.path.getmtime(BACKUP_GPKG)).strftime("%Y%m%d")
    sugestao = os.path.join(PROJECT_DIR, f"GeoPackageApui_backup_{data_tag}.gpkg")
    print("\nSugestao de nomenclatura (execute manualmente se desejar aplicar):")
    print(f'  ren "{BACKUP_GPKG}" "{os.path.basename(sugestao)}"   (Windows/cmd)')


if __name__ == "__main__":
    main()
