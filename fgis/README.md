# FGIS Apuí — Planejador de Voo Inteligente

Nota técnica do sistema de planejamento de aerolevantamento por drone para as glebas
do Projeto Apuí (AM). Documenta o pipeline de dados, a metodologia do algoritmo de
cobertura, os parâmetros operacionais e as decisões técnicas tomadas na revisão de
2026-07-11.

## 1. Visão geral

O FGIS é uma aplicação web local (Leaflet + Turf.js) que:

1. Lê uma base geoespacial de referência (`GeoPackageApui.gpkg`) contendo as glebas
   de interesse e uma malha de pontos geodésicos (levantamento GNSS);
2. Sobre esses dados, executa um algoritmo de cobertura que seleciona um subconjunto
   de pontos como bases de decolagem, gerando polígonos de voo sem sobreposição e
   recortados pelos limites das glebas;
3. Exporta o plano final em KML, pronto para uso em software de planejamento de voo
   (DJI Pilot, Litchi, etc.) ou em GIS de campo.

## 2. Pipeline de dados

```
GeoPackageApui.gpkg
        │  (fgis/export_data.py — GeoPandas)
        ▼
fgis/data/areas.geojson, pontos.geojson   (+ metadados de rastreabilidade)
        │  (fgis/app.js — Leaflet/Turf, no navegador)
        ▼
Plano de voo (polígonos otimizados)
        │  (fgis/server.py — POST /api/export-kml)
        ▼
fgis/exports/*.kml
```

### Como abrir o FGIS

**Forma rápida (Windows)**: dê duplo clique em `fgis/Iniciar_FGIS.bat`. Ele detecta
o Python instalado, sobe o servidor local (`server.py`) em uma janela separada e
abre `http://localhost:8001` automaticamente no navegador padrão. Para encerrar,
feche a janela de servidor que ele abriu.

**Forma manual**:
```bash
python fgis/export_data.py   # apenas quando o GeoPackage de origem for atualizado
python fgis/server.py        # sobe o servidor local em http://localhost:8001
```

Reexecute `export_data.py` sempre que `GeoPackageApui.gpkg` for atualizado — os
GeoJSON em `fgis/data/` não se atualizam sozinhos.

## 3. Rastreabilidade dos dados (adicionado em 2026-07-11)

Desde esta revisão, `export_data.py` grava, no nível raiz de cada GeoJSON exportado:

| Campo | Descrição |
|---|---|
| `generated_at` | Timestamp ISO 8601 de quando o GeoJSON foi exportado |
| `source_gpkg` | Nome do arquivo GeoPackage de origem |
| `source_gpkg_sha256` | Hash de integridade do GeoPackage no momento da exportação |
| `source_gpkg_mtime` | Data de última modificação do GeoPackage de origem |

A interface (rodapé da barra lateral) exibe automaticamente `generated_at` e
`source_gpkg` quando presentes, permitindo ao operador confirmar em campo qual
versão da base está sendo usada. **Os arquivos `fgis/data/*.geojson` atualmente em
disco foram gerados pela versão anterior do script e ainda não contêm esses campos
— rode `export_data.py` novamente para populá-los.**

## 4. Metodologia do algoritmo de cobertura (`generateSmartPlan`)

Algoritmo guloso (greedy), não exato:

1. Une as glebas (`AREAS_AREA_01`, `AREAS_AREA_02`) em uma única geometria-alvo
   (`turf.union`);
2. Para cada um dos pontos geodésicos candidatos, gera uma "área de voo" (quadrado
   ou retângulo) centrada no ponto, de acordo com os parâmetros do operador;
3. A cada iteração (máx. 35), seleciona o candidato ainda não usado cuja área de voo
   **maximiza a interseção** com a área ainda não coberta, e subtrai essa área da
   pendência (`turf.difference`);
4. Repete até cobrir 99,5% da área-alvo ou até a melhor sobreposição cair abaixo de
   5.000 m² (ponto de corte para evitar bases residuais de baixo valor).

**Limitação conhecida**: por ser guloso, o algoritmo não garante o número mínimo de
bases nem uma solução ótima global — apenas uma solução localmente boa e
determinística para o conjunto de pontos e parâmetros dados. Planos gerados com
parâmetros diferentes (ex. os KML de 6 e 9 bases em `fgis/exports/`) não são
diretamente comparáveis em "eficiência" sem registrar os parâmetros usados em cada
execução.

### Parâmetros operacionais

| Parâmetro | Faixa | Uso |
|---|---|---|
| Formato da área de voo | Circular (→ quadrado) / Retangular | Define a geometria gerada por base |
| Range de voo (raio centro→vértice) | 500–3000 m | Usado no modo circular |
| Largura / Altura | 100–5000 m | Usado no modo retangular |
| Sobreposição lateral | 0–200 m | Parâmetro de UI; a subtração geométrica atual (`turf.difference`) não aplica esse valor ao recorte — ver seção 6 |

## 5. Precisão geodésica dos polígonos de voo (revisado em 2026-07-11)

**Antes**: os vértices de cada polígono eram calculados por aproximação cartesiana
plana (`graus = metros / 111132`, com correção de `cos(latitude)` apenas na
longitude). Esse método ignora a convergência de meridianos e acumula erro métrico
crescente com o alcance de voo.

**Agora**: `makeFlightSquare` e `makeFlightRectangle` (em `app.js`) usam
`turf.destination()` — resolução do problema geodésico direto (ponto de partida +
distância + azimute) sobre um modelo esférico da Terra. Isso elimina a distorção da
aproximação plana anterior para os alcances usados neste projeto (500–5000 m).

**Limitação remanescente**: `turf.destination()` opera sobre uma esfera de raio
médio (~6.371.008,8 m), não sobre o elipsoide GRS80/WGS84 usado pelo SIRGAS2000/UTM.
Para trabalhos que exijam precisão cadastral (ex. memorial descritivo
georreferenciado, apoio a regularização fundiária), a recomendação é uma reprojeção
elipsoidal completa (ex. via `proj4js`, com EPSG:32721 — UTM 21S), com conversão
inversa validada. A função `latLngToUTM21S()` já existente no código é apenas
direta (WGS84→UTM) e serve hoje só para exibição informativa nos popups — não é
usada no cálculo dos polígonos para não introduzir uma segunda fonte de erro sem
validação de uma inversa correspondente.

## 6. Segurança do servidor local (`server.py`, revisado em 2026-07-11)

O `server.py` é um servidor HTTP simples (`http.server`) que expõe dois endpoints
que alteram o sistema de arquivos do usuário: `/api/export-kml` (grava KML) e
`/api/select-dir` (abre diálogo nativo de pasta). Riscos identificados e mitigados:

| Risco | Mitigação aplicada |
|---|---|
| CORS `Access-Control-Allow-Origin: *` permitia que qualquer página aberta no navegador (fora do FGIS) chamasse esses endpoints e gravasse arquivos no disco do usuário | CORS restrito: apenas `http://localhost:8001` e `http://127.0.0.1:8001` recebem o cabeçalho de permissão; POSTs com `Origin` não reconhecida recebem `403` antes de qualquer efeito colateral |
| `filename` vindo do cliente podia conter `../` e escrever fora do diretório pretendido | `filename` sanitizado com `os.path.basename()` e extensão `.kml` garantida |
| `target_dir` sem normalização | `os.path.normpath()` aplicado antes de `os.makedirs` |

**Não é um risco eliminado, é mitigado**: como o `target_dir` continua sendo
qualquer pasta escolhida pelo usuário (por design — é a função de exportação para
pasta local), o servidor não deve ser exposto fora de `localhost` nem rodado em
rede compartilhada sem VPN/firewall.

## 7. Governança dos GeoPackages

Há dois arquivos na raiz do projeto: `GeoPackageApui.gpkg` (base corrente) e
`GeoPackageApui_backup.gpkg`. Para evitar ambiguidade sobre qual é a fonte de
verdade:

1. Rode `python check_gpkg_consistency.py` (raiz do projeto) para comparar hash,
   camadas e contagem de feições dos dois arquivos;
2. Se forem idênticos, o backup pode ser considerado redundante nesta versão;
3. Se forem diferentes, **não descarte nenhum dos dois sem investigar** — o script
   reporta se a diferença é de conteúdo (camadas/contagens) ou só de metadados;
4. Ao criar um novo backup, use sufixo de data: `GeoPackageApui_backup_AAAAMMDD.gpkg`,
   em vez de sobrescrever o backup anterior sem versionamento.

Este script apenas diagnostica — nenhuma renomeação ou exclusão é feita
automaticamente.

## 8. Publicação no GitHub

Repositório: https://github.com/Charles-Igeotecnologia/planejamento-de-voo.git

**Forma rápida (Windows)**: dê duplo clique em `Publicar_no_GitHub.bat` (raiz do
projeto). Ele detecta o Git instalado, inicializa o repositório local se
necessário, configura o remoto `origin`, faz commit das mudanças e envia (`push`)
para o repositório acima — usando o Git e as credenciais já configurados no seu
computador (não requer nenhum token informado a uma IA). Se o repositório remoto já
tiver commits (ex. README/licença criados pelo próprio GitHub), o script tenta
mesclar automaticamente antes do push; em caso de conflito, ele para e informa os
comandos para resolver manualmente — nenhum push forçado é feito sem você mandar.

**O que NÃO sobe para o GitHub** (ver `.gitignore` na raiz):
- `GeoPackageApui.gpkg` e `GeoPackageApui_backup.gpkg` — dados binários grandes,
  ficam apenas locais/no Google Drive. Os GeoJSON derivados em `fgis/data/`
  (o que a aplicação web realmente consome) continuam versionados normalmente.
- Pastas de ambiente Python (`.venv/`), cache (`__pycache__/`) e arquivos de
  sistema/editor (`Thumbs.db`, `.vscode/`, etc.).

**Pré-requisito**: Git instalado (https://git-scm.com/download/win) e uma conta
GitHub com acesso de escrita ao repositório. No primeiro `push`, o Git pode abrir
uma janela de login do GitHub ou pedir um Personal Access Token no lugar da senha.

## 9. Estrutura de diretórios

```
0010 PROJETO APUI PLANO/
├── .gitignore                       # exclui os .gpkg e arquivos de ambiente (novo)
├── Publicar_no_GitHub.bat           # publica o projeto no GitHub com um clique (novo)
├── GeoPackageApui.gpkg              # base corrente (fora do Git)
├── GeoPackageApui_backup.gpkg       # backup (fora do Git)
├── check_gpkg_consistency.py        # auditoria dos dois GPKG
└── fgis/
    ├── README.md                    # este documento
    ├── Iniciar_FGIS.bat             # atalho: sobe o servidor e abre o navegador
    ├── export_data.py               # GPKG -> GeoJSON (com metadados de rastreabilidade)
    ├── server.py                    # servidor local + API de exportação KML (endurecido)
    ├── index.html / app.js / style.css
    ├── data/
    │   ├── areas.geojson
    │   └── pontos.geojson
    └── exports/
        └── *.kml
```

## 10. Changelog

**2026-07-11 (5) — Correção: script de publicação travava em silêncio**
- `Publicar_no_GitHub.bat`: a etapa de commit usava `set /p` para perguntar a
  mensagem do commit no próprio terminal. Isso deixava o script parado esperando
  digitação sem nenhum aviso visual chamativo — na prática, o script "travava" sem
  nunca chegar a dar `push`. Corrigido: a mensagem de commit agora é gerada
  automaticamente (com data/hora), sem pausar para entrada nenhuma. O único
  momento em que o script pode esperar por você agora é uma eventual janela de
  login do GitHub (Git Credential Manager), na primeira vez que autenticar.

**2026-07-11 (4) — Publicação no GitHub**
- Criado `.gitignore` na raiz, excluindo `GeoPackageApui.gpkg` e
  `GeoPackageApui_backup.gpkg` (dados binários grandes) e artefatos de
  ambiente/sistema comuns.
- Criado `Publicar_no_GitHub.bat` (raiz), script local que inicializa/atualiza o
  repositório Git, aponta o remoto `origin` para
  https://github.com/Charles-Igeotecnologia/planejamento-de-voo.git, faz commit e
  push usando as credenciais Git já configuradas no computador do usuário.

**2026-07-11 (3) — Remoção de hachuras (linhas tracejadas) nos polígonos de voo**
- `app.js` (`renderFlightPlans`): removido `dashArray` do contorno do polígono de
  voo (antes tracejado quando o plano estava desmarcado) e das 4 linhas de
  referência centro→vértice (antes tracejadas em vermelho) — ambas passam a ser
  traços sólidos. Os rótulos de distância (`dist-tooltip`, ex. "1800m") sobre
  essas linhas de referência **permanecem exibindo a informação**, apenas a
  linha deixou de ser hachurada.
- `style.css`: removida também a seta/triângulo padrão do Leaflet no tooltip que
  acompanha o cursor durante o desenho (`.live-distance-tooltip::before`).
- Cache-busting incrementado para `v=1.0.6` (app.js e style.css).

**2026-07-11 (2) — Feedback métrico em tempo real e rótulos editáveis de lado**
- `app.js`: durante o uso das ferramentas "Régua", "Linha" e "Polígono", um tooltip
  passa a acompanhar o cursor mostrando a distância do segmento em construção
  (`updateLiveDistanceTooltip`), e o widget flutuante exibe comprimento
  total/perímetro/área parcial em tempo real.
- `app.js`: ao finalizar um polígono ou linha desenhado manualmente, cada lado
  recebe um rótulo permanente e clicável (`renderSegmentLabels`) com sua distância.
  Clicar no rótulo abre um campo para digitar a distância exata desejada; o
  vértice correspondente é reposicionado geodesicamente (`turf.bearing` +
  `turf.destination`, mesmo azimute, nova distância) via `editSegmentLength`.
  Útil para redesenhar um limite a partir de medidas conhecidas (memorial
  descritivo, croqui de campo).
- `app.js`: popups de polígono/linha desenhados manualmente foram centralizados em
  `buildDrawnPolygonPopupHTML`/`buildDrawnLinePopupHTML`, reutilizados na criação,
  na edição por arraste de vértice e na edição de lado por distância exata (área/
  comprimento exibidos sempre atualizados).
- `style.css`: novas classes `.live-distance-tooltip` (tooltip que segue o cursor)
  e `.segment-label-marker`/`.segment-label-bubble` (rótulos de lado clicáveis).
- Cache-busting incrementado para `v=1.0.5`.
- **Limitação conhecida**: ao editar um lado de um polígono fechado, apenas o
  vértice final daquele lado é movido — o lado adjacente compartilha esse vértice
  e tem seu comprimento recalculado como consequência (comportamento padrão em
  ferramentas de edição vetorial por vértice único; o rótulo desse lado adjacente
  é atualizado automaticamente para refletir o novo valor).

**2026-07-11 (1)**
- `export_data.py`: metadados de rastreabilidade (`generated_at`, `source_gpkg`,
  `source_gpkg_sha256`, `source_gpkg_mtime`) injetados nos GeoJSON exportados.
- `app.js`: `makeFlightSquare`/`makeFlightRectangle` recalculados com distância
  geodésica (`turf.destination`) em vez de aproximação cartesiana plana; rodapé da
  UI passa a exibir a origem/data dos dados carregados.
- `server.py`: CORS restrito por Origin em endpoints de escrita; sanitização de
  `filename` (basename + extensão `.kml` obrigatória); normalização de `target_dir`.
- `check_gpkg_consistency.py` (novo, raiz do projeto): auditoria de consistência
  entre `GeoPackageApui.gpkg` e o backup.
- Cache-busting de `app.js`/`style.css` incrementado para `v=1.0.4`.

### Não testado nesta sessão

As alterações em `export_data.py` e `check_gpkg_consistency.py` **não foram
executadas** neste ambiente (o sandbox de execução não tem acesso à pasta do
projeto, apenas leitura/escrita de arquivo). Recomenda-se rodar localmente:

```bash
python fgis/export_data.py
python check_gpkg_consistency.py
```

e validar no navegador (`python fgis/server.py`) que o plano de voo e a exportação
KML continuam funcionando como esperado antes de usar em campo.
