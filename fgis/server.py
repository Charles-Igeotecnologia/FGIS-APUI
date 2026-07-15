import http.server
import socketserver
import os
import json

PORT = 8001
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# Origens confiáveis para requisições que alteram estado (POST). Isso evita que uma página
# maliciosa aberta no mesmo navegador (fora do FGIS) consiga escrever arquivos no disco do
# usuário via este servidor local ("drive-by" contra serviços em localhost) — risco real
# quando o CORS é aberto com '*' em endpoints que gravam arquivos.
ALLOWED_ORIGINS = {
    f"http://localhost:{PORT}",
    f"http://127.0.0.1:{PORT}",
}

# Cache global para as curvas de nível (interpolação offline)
_CURVAS_CACHE = None

def _limpar_float(val):
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    try:
        s = str(val).strip()
        # Remove sufixos como " m", "m", e converte vírgula em ponto
        s = s.replace(" m", "").replace("m", "").replace(",", ".").strip()
        return float(s)
    except Exception:
        return None

def _obter_altitude_local(lat, lon):
    global _CURVAS_CACHE
    
    # Carrega o arquivo curvas.geojson em memória na primeira chamada
    if _CURVAS_CACHE is None:
        curvas_path = os.path.join(DIRECTORY, "data", "curvas.geojson")
        if not os.path.exists(curvas_path):
            return None
            
        try:
            import geopandas as gpd
            _CURVAS_CACHE = gpd.read_file(curvas_path)
            print(f"[Elevation API] Cache de curvas de nível carregado: {len(_CURVAS_CACHE)} feições.")
        except Exception as e:
            print(f"[Elevation API] Falha ao ler cache de curvas: {e}")
            return None

    if _CURVAS_CACHE is None or len(_CURVAS_CACHE) == 0:
        return None

    try:
        from shapely.geometry import Point
        pt = Point(lon, lat)
        
        # Encontra a curva de nível geometricamente mais próxima (distância em graus)
        idx_min = _CURVAS_CACHE.distance(pt).idxmin()
        closest_row = _CURVAS_CACHE.iloc[idx_min]
        
        # Procura coluna de cota usando termos comuns
        possible_cols = ['elevation', 'ele', 'elev', 'cota', 'altitude', 'z', 'value', 'contour']
        for col in closest_row.index:
            if col.lower() in possible_cols:
                val = closest_row[col]
                f_val = _limpar_float(val)
                if f_val is not None:
                    return f_val
                    
        # Fallback para qualquer coluna que pareça uma cota plausível
        for col in closest_row.index:
            if col.lower() not in ('geometry', 'fid', 'id', 'is_mestra', 'type'):
                val = closest_row[col]
                f_val = _limpar_float(val)
                if f_val is not None and -50 < f_val < 9000:
                    return f_val
        return None
    except Exception as e:
        print(f"[Elevation API] Erro ao buscar altitude para ({lat}, {lon}): {e}")
        return None

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    # Configurar cabeçalhos CORS de controle
    def end_headers(self):
        origin = self.headers.get('Origin')
        if origin in ALLOWED_ORIGINS:
            self.send_header('Access-Control-Allow-Origin', origin)
        elif origin is None:
            # Requisição sem cabeçalho Origin (ex.: acesso direto/local, não é navegador cross-site)
            self.send_header('Access-Control-Allow-Origin', '*')
        # Se a origem não é reconhecida, nenhum cabeçalho CORS é emitido: o navegador
        # bloqueia a leitura da resposta pela página de origem não confiável.
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def _origin_confiavel(self):
        origin = self.headers.get('Origin')
        return origin is None or origin in ALLOWED_ORIGINS

    def do_POST(self):
        # Bloqueia POSTs de páginas cross-origin não confiáveis antes de qualquer efeito colateral
        if self.path in ("/api/export-kml", "/api/select-dir", "/api/elevation-local") and not self._origin_confiavel():
            response = {"success": False, "message": "Origem não autorizada."}
            self.send_response(403)
            self.send_header("Content-type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(response).encode('utf-8'))
            return

        if self.path == "/api/export-kml":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)

            try:
                data = json.loads(post_data.decode('utf-8'))

                # Sanitiza o nome do arquivo: remove qualquer componente de diretório
                # (impede traversal via filename, ex. "../../algo_importante.txt") e
                # força a extensão .kml para não sobrescrever arquivos de outro tipo.
                raw_filename = data.get("filename", "export.kml").strip()
                filename = os.path.basename(raw_filename) or "export.kml"
                if not filename.lower().endswith(".kml"):
                    filename += ".kml"

                kml_content = data.get("kml", "")
                target_dir = data.get("directory", "").strip()

                # Se o diretório local estiver vazio, salvar em uma pasta "exports" do FGIS
                if not target_dir:
                    target_dir = os.path.join(DIRECTORY, "exports")

                # Tratar eventuais aspas do caminho que o usuário possa ter deixado
                target_dir = target_dir.replace('"', '').replace("'", "")
                target_dir = os.path.normpath(target_dir)

                # Criar pasta física se não existir no computador
                if not os.path.exists(target_dir):
                    os.makedirs(target_dir, exist_ok=True)

                full_path = os.path.join(target_dir, filename)
                
                # Salvar o arquivo KML
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(kml_content)

                print(f"[API] Sucesso: KML gravado localmente em '{full_path}'")

                response = {
                    "success": True,
                    "message": f"Arquivo salvo com sucesso em: {full_path}",
                    "path": full_path
                }
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"[API] Erro ao gravar KML: {str(e)}")
                response = {
                    "success": False,
                    "message": f"Erro ao salvar arquivo: {str(e)}"
                }
                self.send_response(500)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
        elif self.path == "/api/select-dir":
            try:
                import tkinter as tk
                from tkinter import filedialog
                
                # Ocultar janela base do Tkinter
                root = tk.Tk()
                root.withdraw()
                root.attributes("-topmost", True)
                
                # Abrir seletor de diretório nativo
                directory = filedialog.askdirectory(title="Selecione a pasta de destino dos KMLs")
                root.destroy()
                
                response = {
                    "success": True,
                    "directory": directory
                }
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"[API] Erro ao abrir seletor de pasta: {str(e)}")
                response = {
                    "success": False,
                    "message": str(e)
                }
                self.send_response(500)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
        elif self.path == "/api/elevation-local":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                # Se o arquivo curvas.geojson nao existir localmente, forca erro para usar o Open-Meteo
                curvas_path = os.path.join(DIRECTORY, "data", "curvas.geojson")
                if not os.path.exists(curvas_path):
                    raise Exception("Arquivo de curvas locais (curvas.geojson) nao encontrado.")

                data = json.loads(post_data.decode('utf-8'))
                lats = data.get("latitudes", [])
                lngs = data.get("longitudes", [])
                
                elevations = []
                for lat, lon in zip(lats, lngs):
                    alt = _obter_altitude_local(float(lat), float(lon))
                    if alt is not None:
                        elevations.append(alt)
                    else:
                        elevations.append(0.0)
                        
                response = {
                    "success": True,
                    "elevation": elevations
                }
                self.send_response(200)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
                
            except Exception as e:
                print(f"[API] Erro ao calcular altimetria local: {str(e)}")
                response = {
                    "success": False,
                    "message": f"Erro ao calcular altimetria: {str(e)}"
                }
                self.send_response(500)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(response).encode('utf-8'))
        else:
            # Encaminhar outras requisições POST padrão se existirem
            super().do_POST()

def run_server():
    os.chdir(DIRECTORY)
    
    # Permitir reuso de endereço para evitar erro de Address already in use
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Servidor ativo em: http://localhost:{PORT}")
        print(f"Servindo arquivos da pasta: {DIRECTORY}")
        print("Pressione Ctrl+C para encerrar.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServidor finalizado pelo usuario.")

if __name__ == "__main__":
    run_server()
