// FGIS - Planejador de Voo Inteligente - Lógica da Aplicação (app.js)

document.addEventListener("DOMContentLoaded", () => {
    // === ESTADO DA APLICAÇÃO ===
    const state = {
        map: null,
        layers: {
            osm: null,
            satellite: null,
            googleSatellite: null,
            googleHybrid: null,
            areas: L.layerGroup(),
            points: L.layerGroup(),
            flightplans: L.layerGroup(),
            activeBases: L.layerGroup(), // Camada dedicada para bases estratégicas ativas
            drawings: L.layerGroup(),
            importedKML: L.layerGroup(), // Camada dedicada para KML importado pelo usuário
            altimetryMarkers: L.layerGroup(), // Marcadores coropléticos de relevo
            curvas: L.layerGroup(), // Camada de curvas de nível
            vicinais: L.layerGroup() // Camada de estradas vicinais
        },
        rawGeoJSON: {
            areas: null,
            pontos: null,
            curvas: null,
            vicinais: null
        },
        geolocation: {
            active: false,
            watchId: null,
            marker: null,
            accuracyCircle: null
        },
        flightPlansData: [], // Lista de planos { id, pointID, center: [lng, lat], elevation: 145.3, polygon: TurfPoly, range: 1800, selected: true }
        activeTool: null, // 'measure', 'draw-point', 'draw-line', 'draw-poly'
        drawState: {
            points: [],
            markers: [],
            tempLine: null,
            activeGeometry: null,
            liveTooltip: null // tooltip de distância que acompanha o cursor durante o desenho
        },
        params: {
            shape: "circle",
            range: 1800,
            width: 2000,
            height: 2000,
            overlap: 20
        }
    };

    // === INICIALIZAÇÃO DO MAPA ===
    function initMap() {
        const defaultCenter = [-7.40, -59.81];
        state.map = L.map("map", {
            center: defaultCenter,
            zoom: 12,
            zoomControl: false
        });

        L.control.zoom({ position: 'topright' }).addTo(state.map);

        // Basemaps
        state.layers.osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: '&copy; OpenStreetMap contributors',
            maxZoom: 19
        });

        state.layers.satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 19
        });

        state.layers.googleSatellite = L.tileLayer("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", {
            attribution: '&copy; Google Maps',
            maxZoom: 20
        });

        state.layers.googleHybrid = L.tileLayer("https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", {
            attribution: '&copy; Google Maps',
            maxZoom: 20
        });

        // Adicionar Google Satélite por padrão
        state.layers.googleSatellite.addTo(state.map);

        // Adicionar grupos de camadas ao mapa
        state.layers.areas.addTo(state.map);
        state.layers.points.addTo(state.map);
        state.layers.flightplans.addTo(state.map);
        state.layers.activeBases.addTo(state.map);
        state.layers.drawings.addTo(state.map);
        state.layers.importedKML.addTo(state.map);
        state.layers.altimetryMarkers.addTo(state.map);
        state.layers.curvas.addTo(state.map);
        state.layers.vicinais.addTo(state.map);

        const baseMaps = {
            "Google Satélite": state.layers.googleSatellite,
            "Google Híbrido": state.layers.googleHybrid,
            "Satélite (Esri)": state.layers.satellite,
            "Mapa de Ruas (OSM)": state.layers.osm
        };
        L.control.layers(baseMaps, null, { position: 'topright' }).addTo(state.map);

        // Controle de Geolocalização em Tempo Real (📍)
        const LocationControl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function (map) {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-location-control');
                const button = L.DomUtil.create('a', 'leaflet-location-button', container);
                button.innerHTML = '📍';
                button.href = '#';
                button.title = 'Minha Localização';

                L.DomEvent.on(button, 'click', function (e) {
                    L.DomEvent.stopPropagation(e);
                    L.DomEvent.preventDefault(e);
                    toggleGeolocation();
                });

                return container;
            }
        });
        new LocationControl().addTo(state.map);

        state.map.on("click", handleMapClick);
        state.map.on("mousemove", handleMapMouseMove);
        state.map.on("contextmenu", handleMapRightClick);

        setupPopupEventListeners();
    }

    // === CONVERSÃO GEODÉSICA WGS84 PARA UTM ZONA 21S ===
    function latLngToUTM21S(lat, lng) {
        const a = 6378137.0; // Semieixo maior
        const f = 1 / 298.257223563; // Achatamento
        const b = a * (1 - f);
        const e2 = (a*a - b*b) / (a*a);
        const ep2 = (a*a - b*b) / (b*b);
        
        const k0 = 0.9996;
        const falseEasting = 500000.0;
        const falseNorthing = 10000000.0; // Hemisfério Sul
        const zoneCentralMeridian = -57.0; // Zona 21
        
        const latRad = lat * Math.PI / 180.0;
        const lngRad = lng * Math.PI / 180.0;
        const centralMeridianRad = zoneCentralMeridian * Math.PI / 180.0;
        const deltaLng = lngRad - centralMeridianRad;
        
        const sinLat = Math.sin(latRad);
        const cosLat = Math.cos(latRad);
        const tanLat = Math.tan(latRad);
        
        const N = a / Math.sqrt(1.0 - e2 * sinLat * sinLat);
        const T = tanLat * tanLat;
        const C = ep2 * cosLat * cosLat;
        const A = deltaLng * cosLat;
        
        const M = a * (
            (1.0 - e2/4.0 - 3.0*e2*e2/64.0 - 5.0*e2*e2/256.0) * latRad -
            (3.0*e2/8.0 + 3.0*e2*e2/32.0 + 45.0*e2*e2/1024.0) * Math.sin(2.0*latRad) +
            (15.0*e2*e2/256.0 + 45.0*e2*e2/1024.0) * Math.sin(4.0*latRad) -
            (35.0*e2*e2*e2/3072.0) * Math.sin(6.0*latRad)
        );
        
        const easting = falseEasting + k0 * N * (
            A +
            (1.0 - T + C) * A*A*A / 6.0 +
            (5.0 - 18.0*T + T*T + 72.0*C - 58.0*ep2) * A*A*A*A*A / 120.0
        );
        
        const northing = falseNorthing + k0 * (
            M +
            N * tanLat * (
                A*A / 2.0 +
                (5.0 - T + 9.0*C + 4.0*C*C) * A*A*A*A / 24.0 +
                (61.0 - 58.0*T + T*T + 600.0*C - 330.0*ep2) * A*A*A*A*A*A / 720.0
            )
        );
        
        return {
            easting: Math.round(easting),
            northing: Math.round(northing)
        };
    }

    // === CARREGAMENTO DOS DADOS ===
    async function loadData() {
        try {
            if (window.PORTABLE_AREAS) {
                state.rawGeoJSON.areas = window.PORTABLE_AREAS;
                renderAreas();
            } else {
                const areasRes = await fetch("data/areas.geojson?t=" + new Date().getTime());
                if (areasRes.ok) {
                    state.rawGeoJSON.areas = await areasRes.json();
                    renderAreas();
                }
            }

            if (window.PORTABLE_PONTOS) {
                state.rawGeoJSON.pontos = window.PORTABLE_PONTOS;
                renderPoints();
            } else {
                const pontosRes = await fetch("data/pontos.geojson?t=" + new Date().getTime());
                if (pontosRes.ok) {
                    state.rawGeoJSON.pontos = await pontosRes.json();
                    renderPoints();
                }
            }

            if (window.PORTABLE_CURVAS) {
                state.rawGeoJSON.curvas = window.PORTABLE_CURVAS;
                renderCurvas();
            } else {
                const curvasRes = await fetch("data/curvas.geojson?t=" + new Date().getTime());
                if (curvasRes.ok) {
                    state.rawGeoJSON.curvas = await curvasRes.json();
                    renderCurvas();
                }
            }

            if (window.PORTABLE_VICINAIS) {
                state.rawGeoJSON.vicinais = window.PORTABLE_VICINAIS;
                renderVicinais();
            } else {
                const vicinaisRes = await fetch("data/vicinais.geojson?t=" + new Date().getTime());
                if (vicinaisRes.ok) {
                    state.rawGeoJSON.vicinais = await vicinaisRes.json();
                    renderVicinais();
                }
            }

            if (state.rawGeoJSON.areas) {
                const geojsonLayer = L.geoJSON(state.rawGeoJSON.areas);
                state.map.fitBounds(geojsonLayer.getBounds(), { padding: [40, 40] });
            }

            renderDataVintage();
            updateStats();
        } catch (error) {
            console.error("Erro ao carregar arquivos de dados:", error);
        }
    }

    function getElevationFromProperties(properties) {
        if (!properties) return null;
        const possible_cols = ['elevation', 'ele', 'cota', 'altitude', 'z', 'value', 'contour'];
        
        for (let col in properties) {
            if (possible_cols.includes(col.toLowerCase())) {
                const valStr = String(properties[col]).trim();
                const cleanStr = valStr.replace(/\s*[m|M]$/, "").replace(",", ".").trim();
                const val = parseFloat(cleanStr);
                if (!isNaN(val)) {
                    return val;
                }
            }
        }
        
        // Fallback para qualquer chave numérica que pareça uma cota plausível
        for (let col in properties) {
            if (col !== 'fid') {
                const val = parseFloat(properties[col]);
                if (!isNaN(val) && val > -50 && val < 9000) {
                    return val;
                }
            }
        }
        return null;
    }



    // Exibe no rodapé a rastreabilidade dos dados: quando e a partir de qual
    // GeoPackage os GeoJSON atuais foram exportados (metadados gravados por
    // export_data.py). Se os arquivos ainda não tiverem sido reexportados com a
    // versão atualizada do script, o campo simplesmente não aparece.
    function renderDataVintage() {
        const el = document.getElementById("data-vintage");
        if (!el) return;

        const meta = state.rawGeoJSON.pontos || state.rawGeoJSON.areas;
        if (!meta || !meta.generated_at) {
            el.textContent = "";
            return;
        }

        const dt = new Date(meta.generated_at);
        const dataStr = isNaN(dt.getTime()) ? meta.generated_at : dt.toLocaleString("pt-BR");
        const source = meta.source_gpkg ? ` • Fonte: ${meta.source_gpkg}` : "";
        el.textContent = `Dados exportados em ${dataStr}${source}`;
        el.title = meta.source_gpkg_sha256 ? `SHA-256: ${meta.source_gpkg_sha256}` : "";
    }

    function renderAreas() {
        state.layers.areas.clearLayers();
        if (!state.rawGeoJSON.areas) return;

        const slider = document.getElementById("layer-areas-opacity");
        const currentOpacity = slider ? parseFloat(slider.value) : 0.10;

        L.geoJSON(state.rawGeoJSON.areas, {
            style: (feature) => {
                const name = feature.properties.NAME || "";
                const isArea2 = name.includes("02") || name.includes("REA");
                return {
                    color: isArea2 ? "#06b6d4" : "#10b981",
                    weight: 3,
                    fillColor: isArea2 ? "#06b6d4" : "#10b981",
                    fillOpacity: currentOpacity,
                    dashArray: "4, 6",
                    className: "gleba-layer"
                };
            },
            onEachFeature: (feature, layer) => {
                const name = feature.properties.NAME || "Gleba";
                layer.bindPopup(`<h3>Área de Interesse</h3><p><b>Identificador:</b> ${name}</p>`);
            }
        }).addTo(state.layers.areas);
    }

    // Renderizar curvas de nível (Mestras e Normais)
    function renderCurvas() {
        state.layers.curvas.clearLayers();
        if (!state.rawGeoJSON.curvas) return;

        const slider = document.getElementById("layer-curvas-opacity");
        const currentOpacity = slider ? parseFloat(slider.value) : 0.75;

        L.geoJSON(state.rawGeoJSON.curvas, {
            style: (feature) => {
                const isMestra = feature.properties.is_mestra === 1;
                return {
                    color: isMestra ? "#d97706" : "#b45309", // Tom de laranja escuro para mestra, mais claro/terra para normais
                    weight: isMestra ? 1.8 : 0.7,             // Linha mais evidente para mestras
                    opacity: isMestra ? currentOpacity : currentOpacity * 0.65 // Menos opacidade nas normais
                };
            },
            onEachFeature: (feature, layer) => {
                // Rotula APENAS as curvas mestras
                const isMestra = feature.properties.is_mestra === 1;
                if (isMestra) {
                    const elevVal = feature.properties.ELEV || feature.properties.elev || feature.properties.elevation || 0;
                    layer.bindTooltip(`${elevVal}m`, {
                        permanent: true,
                        direction: "center",
                        className: "contour-label-tooltip"
                    });
                }
            }
        }).addTo(state.layers.curvas);
    }

    // Renderizar estradas vicinais (linhas)
    function renderVicinais() {
        state.layers.vicinais.clearLayers();
        if (!state.rawGeoJSON.vicinais) return;

        const slider = document.getElementById("layer-vicinais-opacity");
        const currentOpacity = slider ? parseFloat(slider.value) : 0.80;

        L.geoJSON(state.rawGeoJSON.vicinais, {
            style: {
                color: "#eab308", // Amarelo/Laranja terra para vicinais
                weight: 1.5,
                dashArray: "6, 4", // Linha tracejada
                opacity: currentOpacity
            },
            onEachFeature: (feature, layer) => {
                const nome = feature.properties.Nome || feature.properties.nome || feature.properties.NOME;
                if (nome && nome.trim() !== "") {
                    layer.bindTooltip(`Vicinal: ${nome}`, { sticky: true });
                }
            }
        }).addTo(state.layers.vicinais);
    }

    // Função de ativação/desativação da Geolocalização em Tempo Real (GPS do dispositivo)
    function toggleGeolocation() {
        const controlContainer = document.querySelector('.leaflet-location-control');
        
        if (state.geolocation.active) {
            // Desativar geolocalização
            if (state.geolocation.watchId !== null) {
                navigator.geolocation.clearWatch(state.geolocation.watchId);
                state.geolocation.watchId = null;
            }
            if (state.geolocation.marker) {
                state.map.removeLayer(state.geolocation.marker);
                state.geolocation.marker = null;
            }
            if (state.geolocation.accuracyCircle) {
                state.map.removeLayer(state.geolocation.accuracyCircle);
                state.geolocation.accuracyCircle = null;
            }
            state.geolocation.active = false;
            if (controlContainer) controlContainer.classList.remove('active');
            showInfoWidget("Rastreamento de localização desativado.");
        } else {
            // Ativar geolocalização
            if (!navigator.geolocation) {
                alert("Geolocalização não é suportada pelo seu dispositivo.");
                return;
            }

            showInfoWidget("Buscando sinal GPS...");
            if (controlContainer) controlContainer.classList.add('active');

            state.geolocation.active = true;
            state.geolocation.watchId = navigator.geolocation.watchPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    const accuracy = position.coords.accuracy; // Precisão em metros

                    console.log(`[GPS] Pos: (${lat}, ${lng}), Precisão: ${accuracy}m`);

                    const latlng = L.latLng(lat, lng);

                    // Desenhar ou atualizar o círculo de precisão
                    if (state.geolocation.accuracyCircle) {
                        state.geolocation.accuracyCircle.setLatLng(latlng);
                        state.geolocation.accuracyCircle.setRadius(accuracy);
                    } else {
                        state.geolocation.accuracyCircle = L.circle(latlng, {
                            radius: accuracy,
                            color: "#06b6d4",
                            fillColor: "#06b6d4",
                            fillOpacity: 0.15,
                            weight: 1,
                            interactive: false
                        }).addTo(state.map);
                    }

                    // Desenhar ou atualizar o marcador
                    if (state.geolocation.marker) {
                        state.geolocation.marker.setLatLng(latlng);
                    } else {
                        // Marcador azul dinâmico premium
                        state.geolocation.marker = L.circleMarker(latlng, {
                            radius: 8,
                            color: "#ffffff",
                            fillColor: "#06b6d4",
                            fillOpacity: 0.9,
                            weight: 2,
                            className: "gps-position-marker"
                        }).addTo(state.map);
                        
                        state.geolocation.marker.bindPopup("<b>Você está aqui</b>").openPopup();
                        // Centraliza o mapa apenas no primeiro posicionamento
                        state.map.setView(latlng, 15);
                    }
                },
                (error) => {
                    console.error("[GPS] Erro:", error);
                    let msg = "Erro desconhecido ao obter localização.";
                    if (error.code === error.PERMISSION_DENIED) msg = "Permissão de geolocalização negada pelo operador.";
                    else if (error.code === error.POSITION_UNAVAILABLE) msg = "Sinal de GPS indisponível.";
                    else if (error.code === error.TIMEOUT) msg = "Tempo esgotado ao buscar GPS.";
                    
                    showInfoWidget(`<b>Falha no GPS:</b> ${msg}`);
                    // Reverter estado se houver erro crítico
                    if (state.geolocation.active) {
                        toggleGeolocation();
                    }
                },
                {
                    enableHighAccuracy: true, // Força o uso do GPS do chip móvel
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        }
    }

    // Renderizar os pontos de decolagem originais do GPKG
    function renderPoints() {
        state.layers.points.clearLayers();
        if (!state.rawGeoJSON.pontos) return;

        const hasActivePlans = state.flightPlansData.length > 0;

        state.rawGeoJSON.pontos.features.forEach((feature) => {
            const coords = feature.geometry.coordinates;
            const props = feature.properties;
            
            // Se o ponto geodésico estiver ATIVO, ele não é renderizado nesta camada de pontos inativos,
            // mas sim na camada dedicada state.layers.activeBases.
            const isStrategicSelected = state.flightPlansData.some(p => p.pointID === props.PointID);
            if (isStrategicSelected) return;

            const marker = L.circleMarker([coords[1], coords[0]], {
                radius: hasActivePlans ? 5.5 : 5,
                fillColor: "#ffffff",
                color: hasActivePlans ? "rgba(31, 41, 55, 0.7)" : "#1f2937",
                weight: hasActivePlans ? 2 : 1.5,
                fillOpacity: hasActivePlans ? 0.55 : 0.8,
                className: "inactive-point-layer"
            });

            // Ativação direta ao clicar no ponto geodésico original inativo
            const lat = coords[1];
            const lng = coords[0];
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                
                if (state.activeTool) return; // Se estiver medindo, ignora ativação

                const pointID = props.PointID;
                const planId = `flight-${pointID.replace(/\D/g, '') || Math.floor(Math.random()*1000)}`;
                const elevation = props.ELEVATION || 0;

                state.flightPlansData.push({
                    id: planId,
                    pointID: pointID,
                    center: coords,
                    elevation: elevation,
                    polygon: null,
                    range: state.params.range,
                    selected: true
                });
                
                recalculateActiveFlightGeometries();
                
                setTimeout(() => {
                    openPlanPopup(planId, e.latlng);
                }, 120);
            });

            const easting = props.Easting || props.EASTING || latLngToUTM21S(lat, lng).easting;
            const northing = props.Northing || props.NORTHING || latLngToUTM21S(lat, lng).northing;

            marker.bindPopup(`
                <div class="leaflet-custom-popup">
                    <h3>Ponto de Decolagem</h3>
                    <p><b>ID:</b> ${props.PointID || 'S/N'}</p>
                    <p><b>Altitude:</b> ${props.ELEVATION ? props.ELEVATION.toFixed(2) + ' m' : 'N/A'}</p>
                    <p><b>UTM (m):</b> E: ${easting.toFixed(0)} • N: ${northing.toFixed(0)} (21S)</p>
                    <p><b>Graus Decimais:</b> Lat: ${lat.toFixed(7)}° • Lng: ${lng.toFixed(7)}°</p>
                    <p>🌎 <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="color:#3b82f6; font-weight:600; text-decoration:none;">Ver no Google Maps</a></p>
                    <button class="btn btn-primary btn-sm btn-activate-base" data-point-id="${props.PointID}" data-coords='${JSON.stringify(coords)}' data-elevation="${props.ELEVATION || 0}" style="margin-top:8px; width:100%;">
                        🟢 Ativar no Plano de Voo
                    </button>
                </div>
            `);

            state.layers.points.addLayer(marker);
        });
    }

    // === GERAÇÃO E OTIMIZAÇÃO DO PLANO DE VOO ===
    
    // NOTA DE PRECISÃO GEODÉSICA:
    // A versão anterior calculava os vértices por aproximação cartesiana plana
    // (graus = metros / 111132, com correção de cos(lat) apenas na longitude).
    // Isso ignora a convergência de meridianos e acumula erro métrico crescente
    // conforme o alcance de voo (range) aumenta. A partir desta versão, os vértices
    // são calculados com turf.destination(), que resolve o problema geodésico direto
    // (ponto de partida + distância + azimute) sobre um modelo esférico da Terra —
    // eliminando a distorção da aproximação plana anterior. Para precisão cadastral
    // de altíssima exigência (ex.: memorial descritivo georreferenciado), o ideal é
    // uma reprojeção ellipsoidal completa em UTM 21S (ex. via proj4js); a função
    // latLngToUTM21S() já disponível neste arquivo cobre a exibição informativa nos
    // popups, mas não é usada aqui para não introduzir uma segunda fonte de erro
    // sem uma inversa UTM→WGS84 devidamente validada.
    function _stripAltitude(coords) {
        return [coords[0], coords[1]];
    }

    function makeFlightSquare(centerCoords, radiusMeters) {
        const center = _stripAltitude(centerCoords);

        // Quadrado alinhado aos eixos: "radiusMeters" é a distância geodésica do
        // centro a cada vértice (rótulo da UI: "Raio do Centro ao Vértice").
        const bearings = [315, 45, 135, 225]; // NW, NE, SE, SW
        const corners = bearings.map(
            (bearing) => turf.destination(center, radiusMeters, bearing, { units: "meters" }).geometry.coordinates
        );
        corners.push(corners[0]); // fechar o anel

        return turf.polygon([corners]);
    }

    function makeFlightRectangle(centerCoords, widthM, heightM) {
        const center = _stripAltitude(centerCoords);
        const halfW = widthM / 2;
        const halfH = heightM / 2;

        // Desloca em dois passos geodésicos (Norte/Sul e depois Leste/Oeste a partir
        // de cada um) em vez de somar offsets em graus diretamente — mais fiel em
        // retângulos largos (até 5000 m) e em latitudes fora do equador.
        const north = turf.destination(center, halfH, 0, { units: "meters" });
        const south = turf.destination(center, halfH, 180, { units: "meters" });

        const ne = turf.destination(north, halfW, 90, { units: "meters" }).geometry.coordinates;
        const nw = turf.destination(north, halfW, 270, { units: "meters" }).geometry.coordinates;
        const se = turf.destination(south, halfW, 90, { units: "meters" }).geometry.coordinates;
        const sw = turf.destination(south, halfW, 270, { units: "meters" }).geometry.coordinates;

        return turf.polygon([[nw, ne, se, sw, nw]]);
    }

    // Algoritmo de cobertura inteligente
    function generateSmartPlan() {
        if (!state.rawGeoJSON.areas || !state.rawGeoJSON.pontos) {
            alert("Dados de áreas ou pontos não carregados.");
            return;
        }

        showInfoWidget("Calculando plano de voo otimizado restrito às glebas...");

        const range = state.params.range;

        // 1. Unir glebas
        let targetGeometry = null;
        try {
            state.rawGeoJSON.areas.features.forEach((f) => {
                const poly = turf.polygon(f.geometry.coordinates);
                if (!targetGeometry) targetGeometry = poly;
                else targetGeometry = turf.union(targetGeometry, poly);
            });
        } catch (err) {
            targetGeometry = state.rawGeoJSON.areas.features[0];
        }

        if (!targetGeometry) {
            showInfoWidget("Erro ao processar geometria.");
            return;
        }

        const totalAreaToCover = turf.area(targetGeometry);

        // 2. Preparar candidatos geodésicos
        const shape = state.params.shape;
        const width = state.params.width;
        const height = state.params.height;

        const candidatePoints = state.rawGeoJSON.pontos.features.map((feature, idx) => {
            const coords = feature.geometry.coordinates;
            const flightSquare = shape === "rectangle"
                ? makeFlightRectangle(coords, width, height)
                : makeFlightSquare(coords, range);
            return {
                idx: idx,
                pointID: feature.properties.PointID || `PT-${idx}`,
                center: coords,
                elevation: feature.properties.ELEVATION || 0,
                flightSquare: flightSquare,
                selected: false,
                cutPoly: null
            };
        });

        // 3. Algoritmo guloso
        let remainingGeometry = JSON.parse(JSON.stringify(targetGeometry));
        const selectedPlans = [];
        let iteration = 0;
        const maxIterations = 35;
        const stopAreaLimit = totalAreaToCover * 0.005;

        while (turf.area(remainingGeometry) > stopAreaLimit && iteration < maxIterations) {
            let bestCandidate = null;
            let maxOverlapArea = 0;
            let bestIntersectPoly = null;

            for (let i = 0; i < candidatePoints.length; i++) {
                const candidate = candidatePoints[i];
                if (candidate.selected) continue;

                try {
                    const intersection = turf.intersect(candidate.flightSquare, remainingGeometry);
                    if (intersection) {
                        const intersectArea = turf.area(intersection);
                        if (intersectArea > maxOverlapArea) {
                            maxOverlapArea = intersectArea;
                            bestCandidate = candidate;
                            bestIntersectPoly = intersection;
                        }
                    }
                } catch (e) {}
            }

            if (!bestCandidate || maxOverlapArea < 5000) {
                break;
            }

            bestCandidate.selected = true;
            bestCandidate.cutPoly = bestIntersectPoly;
            selectedPlans.push(bestCandidate);

            try {
                const diff = turf.difference(remainingGeometry, bestCandidate.flightSquare);
                if (diff) {
                    remainingGeometry = diff;
                } else {
                    remainingGeometry = turf.polygon([[[0,0], [0,0], [0,0], [0,0]]]);
                }
            } catch (err) {
                break;
            }

            iteration++;
        }

        // 4. Configurar estado do plano
        state.flightPlansData = selectedPlans.map((plan) => {
            return {
                id: `flight-${plan.idx}`,
                pointID: plan.pointID,
                center: plan.center,
                elevation: plan.elevation,
                polygon: plan.cutPoly,
                range: range,
                width: width,
                height: height,
                selected: true
            };
        });

        recalculateActiveFlightGeometries();

        const pctCovered = ((1 - (turf.area(remainingGeometry) / totalAreaToCover)) * 100).toFixed(1);
        showInfoWidget(`Plano inteligente sugerido: <b>${selectedPlans.length} bases</b> cobrindo <b>${pctCovered}%</b> das glebas.`);
    }

    // Recalcular geometrias sem sobreposição
    function recalculateActiveFlightGeometries() {
        if (state.flightPlansData.length === 0) {
            state.layers.flightplans.clearLayers();
            state.layers.activeBases.clearLayers();
            renderPoints();
            renderFlightsList();
            updateStats();
            return;
        }

        // 1. Obter gleba unida
        let remainingGeometry = null;
        try {
            state.rawGeoJSON.areas.features.forEach((f) => {
                const poly = turf.polygon(f.geometry.coordinates);
                if (!remainingGeometry) remainingGeometry = poly;
                else remainingGeometry = turf.union(remainingGeometry, poly);
            });
        } catch (e) {
            remainingGeometry = state.rawGeoJSON.areas.features[0];
        }

        if (!remainingGeometry) return;

        // 2. Processar cada base ativa na ordem do estado
        state.flightPlansData.forEach((plan) => {
            if (!plan.selected) {
                plan.polygon = null;
                return;
            }

            const shape = state.params.shape;
            let square;
            if (shape === "rectangle") {
                const w = plan.width || state.params.width;
                const h = plan.height || state.params.height;
                square = makeFlightRectangle(plan.center, w, h);
            } else {
                square = makeFlightSquare(plan.center, plan.range);
            }
            
            try {
                const intersection = turf.intersect(square, remainingGeometry);
                if (intersection) {
                    plan.polygon = intersection;
                    const diff = turf.difference(remainingGeometry, square);
                    if (diff) {
                        remainingGeometry = diff;
                    } else {
                        remainingGeometry = turf.polygon([[[0,0], [0,0], [0,0], [0,0]]]);
                    }
                } else {
                    plan.polygon = null;
                }
            } catch (err) {
                plan.polygon = null;
            }
        });

        // 3. Renderizar tudo
        renderFlightPlans();
        renderPoints();
        renderFlightsList();
        updateStats();
    }

    // Renderizar planos e polígonos no mapa
    function renderFlightPlans() {
        state.layers.flightplans.clearLayers();
        state.layers.activeBases.clearLayers();
        
        let activeIndex = 0; // Para numeração sequencial (Ponto 1, Ponto 2...)

        const slider = document.getElementById("layer-flightplans-opacity");
        const currentOpacity = slider ? parseFloat(slider.value) : 0.28;

        state.flightPlansData.forEach((plan) => {
            if (!plan.polygon || !plan.selected) return;

            const latlngs = plan.polygon.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
            const polyColor = plan.selected ? "#eab308" : varColorFromId(plan.id);
            const polyWeight = plan.selected ? 3.5 : 2;
            const polyFillOpacity = plan.selected ? currentOpacity : currentOpacity * (0.12 / 0.28);

            // 1. Polígono de voo recortado pelas glebas (contorno sempre sólido, sem hachura)
            const polygonLayer = L.polygon(latlngs, {
                color: polyColor,
                weight: polyWeight,
                fillColor: varColorFromId(plan.id),
                fillOpacity: polyFillOpacity,
                className: "flight-poly-layer",
                isSelectedActive: plan.selected
            });

            // Clique no polígono para visualizar popup de readequação
            polygonLayer.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                openPlanPopup(plan.id, e.latlng);
            });

            // 2. Linhas de Range/Diagonal
            const centerLatLng = [plan.center[1], plan.center[0]];
            const lineLayers = [];
            
            const lat = plan.center[1];
            const lng = plan.center[0];
            const shape = state.params.shape;
            
            let theoreticalCorners = [];
            let displayDistStr = "";

            if (shape === "rectangle") {
                const w = plan.width || state.params.width;
                const h = plan.height || state.params.height;
                const latOffset = (h / 2) / 111132;
                const lngOffset = (w / 2) / (111132 * Math.cos(lat * Math.PI / 180));
                
                theoreticalCorners = [
                    [lat + latOffset, lng - lngOffset],
                    [lat + latOffset, lng + lngOffset],
                    [lat - latOffset, lng + lngOffset],
                    [lat - latOffset, lng - lngOffset]
                ];
                
                const semiDiag = Math.sqrt(Math.pow(w/2, 2) + Math.pow(h/2, 2));
                displayDistStr = `${semiDiag.toFixed(0)}m`;
            } else {
                const radiusM = plan.range;
                const latOffset = (radiusM * Math.cos(Math.PI / 4)) / 111132;
                const lngOffset = (radiusM * Math.sin(Math.PI / 4)) / (111132 * Math.cos(lat * Math.PI / 180));
                
                theoreticalCorners = [
                    [lat + latOffset, lng - lngOffset],
                    [lat + latOffset, lng + lngOffset],
                    [lat - latOffset, lng + lngOffset],
                    [lat - latOffset, lng - lngOffset]
                ];
                displayDistStr = `${plan.range}m`;
            }

            theoreticalCorners.forEach((corner) => {
                // Linha de referência sólida (sem hachura) até cada vértice teórico;
                // o rótulo de distância (dist-tooltip) permanece mostrando a informação.
                const line = L.polyline([centerLatLng, corner], {
                    color: "#ef4444",
                    weight: 1.5,
                    opacity: plan.selected ? 0.65 : 0.25
                });
                lineLayers.push(line);

                if (plan.selected) {
                    const midLatLng = [
                        (centerLatLng[0] + corner[0]) / 2,
                        (centerLatLng[1] + corner[1]) / 2
                    ];
                    const distLabel = L.tooltip({
                        permanent: true,
                        direction: 'center',
                        className: 'dist-tooltip'
                    })
                    .setContent(displayDistStr)
                    .setLatLng(midLatLng);
                    lineLayers.push(distLabel);
                }
            });

            const flightGroup = L.featureGroup([polygonLayer, ...lineLayers]);
            state.layers.flightplans.addLayer(flightGroup);

            // 3. Bases Estratégicas Ativas (NUMERAÇÃO SEQUENCIAL)
            const seqNumber = activeIndex + 1;
            activeIndex++;

            const isVirtual = plan.isVirtual;
            const coreClass = isVirtual ? 'virtual-core' : '';
            const ringClass = isVirtual ? 'virtual-ring' : '';
            const activeRingClass = plan.selected ? 'active' : '';

            const pulseIcon = L.divIcon({
                className: 'custom-pulse-marker',
                html: `<div class="pulse-marker-ring ${ringClass} ${activeRingClass}"></div><div class="pulse-marker-core ${coreClass}">${seqNumber}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });

            const centerMarker = L.marker(centerLatLng, {
                icon: pulseIcon
            });

            const labelText = isVirtual ? `Ponto ${seqNumber} (Virtual - ${plan.pointID})` : `Ponto ${seqNumber} (${plan.pointID})`;
            centerMarker.bindTooltip(labelText, {
                permanent: true,
                direction: 'top',
                offset: [0, -10],
                className: 'base-label-tooltip'
            });

            centerMarker.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                openPlanPopup(plan.id, e.latlng);
            });

            state.layers.activeBases.addLayer(centerMarker);
        });
    }

    // Abrir popup unificado para o plano de voo
    function openPlanPopup(planId, latlng) {
        const plan = state.flightPlansData.find(p => p.id === planId);
        if (!plan || !plan.polygon) return;
        
        const lat = plan.center[1];
        const lng = plan.center[0];
        const isVirtual = plan.isVirtual;
        const altitudeText = isVirtual ? 'N/A (Ponto Virtual criado manualmente)' : `${plan.elevation ? plan.elevation.toFixed(2) + ' m' : 'N/A'}`;
        const titleText = isVirtual ? `Ponto Virtual: ${plan.pointID}` : `Plano de Voo: ${plan.pointID}`;

        let slidersHtml = "";
        if (state.params.shape === "rectangle") {
            const w = plan.width || state.params.width;
            const h = plan.height || state.params.height;
            slidersHtml = `
                <div class="input-group" style="margin: 6px 0;">
                    <label style="font-size:11px; font-weight:600; color:var(--text-secondary);">
                        ↔️ Largura de Voo: <span id="popup-width-val-${plan.id}">${w}m</span>
                    </label>
                    <input type="range" class="popup-width-slider" data-id="${plan.id}" min="100" max="5000" step="100" value="${w}" style="width:100%;">
                </div>
                <div class="input-group" style="margin: 6px 0;">
                    <label style="font-size:11px; font-weight:600; color:var(--text-secondary);">
                        ↕️ Altura de Voo: <span id="popup-height-val-${plan.id}">${h}m</span>
                    </label>
                    <input type="range" class="popup-height-slider" data-id="${plan.id}" min="100" max="5000" step="100" value="${h}" style="width:100%;">
                </div>
            `;
        } else {
            slidersHtml = `
                <div class="input-group" style="margin: 8px 0;">
                    <label style="font-size:11px; font-weight:600; color:var(--text-secondary);">
                        📏 Range de Voo: <span id="popup-range-val-${plan.id}">${plan.range}m</span>
                    </label>
                    <input type="range" class="popup-range-slider" data-id="${plan.id}" min="500" max="3000" step="100" value="${plan.range}" style="width:100%;">
                </div>
            `;
        }

        const originalPoint = state.rawGeoJSON.pontos 
            ? state.rawGeoJSON.pontos.features.find(f => f.properties.PointID === plan.pointID) 
            : null;
            
        const easting = originalPoint && originalPoint.properties 
            ? (originalPoint.properties.Easting || originalPoint.properties.EASTING || latLngToUTM21S(lat, lng).easting) 
            : latLngToUTM21S(lat, lng).easting;
            
        const northing = originalPoint && originalPoint.properties 
            ? (originalPoint.properties.Northing || originalPoint.properties.NORTHING || latLngToUTM21S(lat, lng).northing) 
            : latLngToUTM21S(lat, lng).northing;

        const popupContent = `
            <div class="leaflet-custom-popup">
                <h3>${titleText}</h3>
                <p><b>Altitude:</b> ${altitudeText}</p>
                <p>🌎 <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="color:#3b82f6; font-weight:600; text-decoration:none;">Ver no Google Maps</a></p>
                ${slidersHtml}
                <p><b>UTM (m):</b> E: ${easting.toFixed(0)} • N: ${northing.toFixed(0)} (21S)</p>
                <p><b>Graus Decimais:</b> Lat: ${lat.toFixed(7)}° • Lng: ${lng.toFixed(7)}°</p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:10px;">
                    <button class="btn btn-secondary btn-sm btn-remove-base" data-id="${plan.id}" style="border-color:var(--danger-color); color:var(--danger-color); font-weight:700; font-size:10px;">
                        ❌ Remover Base
                    </button>
                    <button class="btn btn-primary btn-sm btn-export-single" data-id="${plan.id}" style="font-weight:700; font-size:10px;">
                        💾 Exportar Polígono
                    </button>
                    <button class="btn btn-secondary btn-sm btn-altimetry-flight" data-id="${plan.id}" style="font-weight:700; grid-column: span 2; font-size:10px;">
                        📊 Analisar Altimetria (MDE)
                    </button>
                </div>
            </div>
        `;

        L.popup()
            .setLatLng(latlng || [lat, lng])
            .setContent(popupContent)
            .openOn(state.map);
    }

    function varColorFromId(id) {
        const colors = ["#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#14b8a6", "#06b6d4"];
        const num = parseInt(id.replace(/\D/g, '')) || 0;
        return colors[num % colors.length];
    }

    function renderFlightsList() {
        const container = document.getElementById("flights-list-container");
        container.innerHTML = "";

        const activePlans = state.flightPlansData.filter(p => p.polygon);

        if (activePlans.length === 0) {
            container.innerHTML = '<p class="placeholder-text">Nenhum polígono de voo gerado ainda. Clique em "Gerar Plano Inteligente".</p>';
            document.getElementById("btn-export-kml").disabled = true;
            return;
        }

        document.getElementById("btn-export-kml").disabled = false;

        let seqNum = 1;
        state.flightPlansData.forEach((plan) => {
            if (!plan.polygon) return;
            const currentSeq = seqNum;
            seqNum++;

            const card = document.createElement("div");
            card.className = `flight-item-card ${plan.selected ? 'active' : ''}`;
            card.dataset.id = plan.id;

            card.innerHTML = `
                <div class="flight-item-left">
                    <div class="flight-color-indicator" style="background-color: ${varColorFromId(plan.id)};"></div>
                    <div class="flight-info-text">
                        <span class="flight-name">Ponto ${currentSeq} (${plan.pointID})</span>
                        <span class="flight-detail">Range: ${plan.range}m (Lim. Gleba)</span>
                    </div>
                </div>
                <input type="checkbox" class="flight-checkbox" ${plan.selected ? 'checked' : ''}>
            `;

            card.addEventListener("click", (e) => {
                if (e.target.type === "checkbox") return;
                state.map.setView([plan.center[1], plan.center[0]], 13);
            });

            const checkbox = card.querySelector(".flight-checkbox");
            checkbox.addEventListener("change", (e) => {
                plan.selected = e.target.checked;
                recalculateActiveFlightGeometries();
            });

            container.appendChild(card);
        });
    }

    function clearFlightPlan() {
        state.flightPlansData = [];
        state.layers.flightplans.clearLayers();
        state.layers.activeBases.clearLayers();
        state.layers.altimetryMarkers.clearLayers();
        renderPoints();
        renderFlightsList();
        updateStats();
        showInfoWidget("Plano de voo limpo.");
    }

    // Configuração dos sliders e botões dinâmicos dos popups
    function setupPopupEventListeners() {
        state.map.on('popupopen', (e) => {
            const container = e.popup.getElement();

            // 1. Slider de Range
            const slider = container.querySelector('.popup-range-slider');
            if (slider) {
                const planId = slider.getAttribute('data-id');
                const valDisplay = container.querySelector(`#popup-range-val-${planId}`);
                
                slider.addEventListener('input', (event) => {
                    const newVal = parseInt(event.target.value);
                    if (valDisplay) valDisplay.textContent = `${newVal}m`;
                    
                    const plan = state.flightPlansData.find(p => p.id === planId);
                    if (plan) plan.range = newVal;
                });
                
                slider.addEventListener('change', () => {
                    recalculateActiveFlightGeometries();
                });
            }

            // Slider de Largura Individual
            const sliderWidth = container.querySelector('.popup-width-slider');
            if (sliderWidth) {
                const planId = sliderWidth.getAttribute('data-id');
                const valDisplay = container.querySelector(`#popup-width-val-${planId}`);
                
                sliderWidth.addEventListener('input', (event) => {
                    const newVal = parseInt(event.target.value);
                    if (valDisplay) valDisplay.textContent = `${newVal}m`;
                    
                    const plan = state.flightPlansData.find(p => p.id === planId);
                    if (plan) plan.width = newVal;
                });
                
                sliderWidth.addEventListener('change', () => {
                    recalculateActiveFlightGeometries();
                });
            }

            // Slider de Altura Individual
            const sliderHeight = container.querySelector('.popup-height-slider');
            if (sliderHeight) {
                const planId = sliderHeight.getAttribute('data-id');
                const valDisplay = container.querySelector(`#popup-height-val-${planId}`);
                
                sliderHeight.addEventListener('input', (event) => {
                    const newVal = parseInt(event.target.value);
                    if (valDisplay) valDisplay.textContent = `${newVal}m`;
                    
                    const plan = state.flightPlansData.find(p => p.id === planId);
                    if (plan) plan.height = newVal;
                });
                
                sliderHeight.addEventListener('change', () => {
                    recalculateActiveFlightGeometries();
                });
            }

            // 2. Botão de Remover
            const btnRemove = container.querySelector('.btn-remove-base');
            if (btnRemove) {
                const planId = btnRemove.getAttribute('data-id');
                btnRemove.addEventListener('click', () => {
                    state.flightPlansData = state.flightPlansData.filter(p => p.id !== planId);
                    recalculateActiveFlightGeometries();
                    state.map.closePopup();
                });
            }

            // 3. Botão KML popup
            const btnExport = container.querySelector('.btn-export-single');
            if (btnExport) {
                const planId = btnExport.getAttribute('data-id');
                btnExport.addEventListener('click', () => {
                    const plan = state.flightPlansData.find(p => p.id === planId);
                    if (plan) exportSingleToKML(plan);
                });
            }

            // 4. Botão Ativar Base (Pontos Inativos)
            const btnActivate = container.querySelector('.btn-activate-base');
            if (btnActivate) {
                const pointID = btnActivate.getAttribute('data-point-id');
                const coords = JSON.parse(btnActivate.getAttribute('data-coords'));
                const elevation = parseFloat(btnActivate.getAttribute('data-elevation')) || 0;
                
                btnActivate.addEventListener('click', () => {
                    const planId = `flight-${pointID.replace(/\D/g, '') || Math.floor(Math.random()*1000)}`;
                    
                    state.flightPlansData.push({
                        id: planId,
                        pointID: pointID,
                        center: coords,
                        elevation: elevation,
                        polygon: null,
                        range: state.params.range,
                        width: state.params.width,
                        height: state.params.height,
                        selected: true
                    });
                    
                    recalculateActiveFlightGeometries();
                    state.map.closePopup();
                    
                    setTimeout(() => {
                        openPlanPopup(planId, [coords[1], coords[0]]);
                    }, 120);
                });
            }

            // 5. Botão de Exportar Polígono Desenhado Manualmente
            const btnExportDrawn = container.querySelector('.btn-export-drawn-poly');
            if (btnExportDrawn) {
                btnExportDrawn.addEventListener('click', () => {
                    const layer = e.popup._source;
                    if (layer && layer.geojson) {
                        exportDrawnPolygonKML(layer.geojson, layer.polyId);
                    } else {
                        alert("Geometria do polígono não encontrada para exportação.");
                    }
                });
            }

            // 6. Botão de Editar Polígono Desenhado Manualmente
            const btnEditDrawn = container.querySelector('.btn-edit-drawn-poly');
            if (btnEditDrawn) {
                btnEditDrawn.addEventListener('click', () => {
                    const layer = e.popup._source;
                    if (layer) {
                        state.map.closePopup();
                        startEditingPolygon(layer);
                    }
                });
            }

            // 7. Botão de Altimetria de Voo Ativo (Bases Douradas)
            const btnAltimetryFlight = container.querySelector('.btn-altimetry-flight');
            if (btnAltimetryFlight) {
                const planId = btnAltimetryFlight.getAttribute('data-id');
                btnAltimetryFlight.addEventListener('click', () => {
                    const plan = state.flightPlansData.find(p => p.id === planId);
                    if (plan && plan.polygon) {
                        analyzeAltimetry(plan.polygon, plan.pointID);
                    } else {
                        alert("Polígono de voo não encontrado para análise de altimetria.");
                    }
                });
            }

            // 8. Botão de Altimetria de Polígono Desenhado Manualmente
            const btnAltimetryPoly = container.querySelector('.btn-altimetry-poly');
            if (btnAltimetryPoly) {
                btnAltimetryPoly.addEventListener('click', () => {
                    const layer = e.popup._source;
                    if (layer && layer.geojson) {
                        analyzeAltimetry(layer.geojson, `Manual (${layer.polyId.replace('poly-', '')})`);
                    } else {
                        alert("Polígono não encontrado para análise de altimetria.");
                    }
                });
            }
        });
    }

    // === EXPORTAÇÃO KML ===
    
    function generateKMLString(flights) {
        let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Planos de Voo Projeto Apui</name>
    <description>Planos de voo recortados pelas glebas e sem sobreposicao</description>
    
    <Style id="flightPlanStyle">
      <LineStyle>
        <color>ff00ff00</color> <!-- Verde -->
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>3200ff00</color> <!-- Verde Translúcido -->
      </PolyStyle>
    </Style>
`;

        let activeIdx = 1;
        flights.forEach((flight) => {
            if (!flight.polygon) return;
            const coords = flight.polygon.geometry.coordinates[0];
            const coordStr = coords.map(c => `${c[0]},${c[1]},0`).join("\n          ");

            kml += `
    <Folder>
      <name>Ponto ${activeIdx} - ${flight.pointID}</name>
      <Placemark>
        <name>Poligono de Voo (Ponto ${activeIdx})</name>
        <styleUrl>#flightPlanStyle</styleUrl>
        <Polygon>
          <tessellate>1</tessellate>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>
                ${coordStr}
              </coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
      <Placemark>
        <name>Base de Decolagem Ponto ${activeIdx} (${flight.pointID})</name>
        <Point>
          <coordinates>${flight.center[0]},${flight.center[1]},0</coordinates>
        </Point>
      </Placemark>
    </Folder>`;
            activeIdx++;
        });

        kml += `
  </Document>
</kml>`;
        return kml;
    }

    function saveKML(kmlContent, filename) {
        const targetDirInput = document.getElementById("export-directory");
        const targetDir = targetDirInput ? targetDirInput.value.trim() : "";

        // Se estiver rodando no servidor local, tentar salvar direto no diretorio do PC
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            showInfoWidget("Salvando KML localmente no computador...");
            
            fetch("/api/export-kml", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    filename: filename,
                    kml: kmlContent,
                    directory: targetDir
                })
            })
            .then(res => {
                if (!res.ok) throw new Error("Erro na API de gravação local");
                return res.json();
            })
            .then(data => {
                if (data.success) {
                    showInfoWidget(`Sucesso! Arquivo gravado em:<br><small style="word-break:break-all; font-size:10px; color:#10b981; font-family:monospace;">${data.path}</small>`);
                } else {
                    alert("Erro ao salvar localmente: " + data.message + "\nFazendo download padrão pelo navegador...");
                    triggerDownload(kmlContent, filename);
                }
            })
            .catch(err => {
                console.error("Erro na API de exportação local:", err);
                alert("Não foi possível conectar com a API local. Fazendo download padrão pelo navegador...");
                triggerDownload(kmlContent, filename);
            });
        } else {
            // Modo portátil ou fora de localhost, faz download tradicional
            triggerDownload(kmlContent, filename);
            showInfoWidget(`KML exportado: <b>${filename}</b> baixado pelo navegador.`);
        }
    }

    function generateDrawnPolyKML(geojson) {
        const coords = geojson.geometry.coordinates[0];
        const coordStr = coords.map(c => `${c[0]},${c[1]},0`).join("\n          ");

        return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Poligono Desenhado FGIS</name>
    <description>Poligono desenhado manualmente pelo usuario no FGIS</description>
    
    <Style id="drawnPolyStyle">
      <LineStyle>
        <color>ff0000ff</color> <!-- Vermelho -->
        <width>2.5</width>
      </LineStyle>
      <PolyStyle>
        <color>320000ff</color> <!-- Vermelho Translúcido -->
      </PolyStyle>
    </Style>
    
    <Placemark>
      <name>Poligono Manual</name>
      <styleUrl>#drawnPolyStyle</styleUrl>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              ${coordStr}
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    }

    function exportDrawnPolygonKML(geojson, polyId) {
        const kml = generateDrawnPolyKML(geojson);
        saveKML(kml, `poligono_desenhado_${polyId}.kml`);
    }

    function exportToKML() {
        const activeFlights = state.flightPlansData.filter(f => f.selected && f.polygon);
        if (activeFlights.length === 0) {
            alert("Nenhum voo ativo para exportar.");
            return;
        }

        const kml = generateKMLString(activeFlights);
        saveKML(kml, `planos_de_voo_apui_${activeFlights.length}_bases.kml`);
    }

    function exportSingleToKML(plan) {
        if (!plan.polygon) return;
        const kml = generateKMLString([plan]);
        saveKML(kml, `plano_de_voo_apui_${plan.pointID}.kml`);
    }

    function triggerDownload(content, filename) {
        const blob = new Blob([content], { type: "application/vnd.google-earth.kml+xml" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }


    // === ANÁLISE DE ALTIMETRIA (MDE) COROPLÉTICA INTERATIVA ===

    // Expor as funções de destaque no escopo global para interação com o SVG do widget
    window.highlightAltiPoint = (index) => {
        state.layers.altimetryMarkers.eachLayer((marker) => {
            if (marker.altIndex === index) {
                marker.setRadius(12);
                marker.setStyle({ weight: 3, color: "#ffeb3b" }); // Borda amarela brilhante
                marker.openTooltip();
            }
        });
    };

    window.unhighlightAltiPoint = (index) => {
        state.layers.altimetryMarkers.eachLayer((marker) => {
            if (marker.altIndex === index) {
                marker.setRadius(6);
                marker.setStyle({ weight: 1.5, color: "#ffffff" });
                marker.closeTooltip();
            }
        });
    };

    function getInternalSamplePoints(geojson, numGrid = 6) {
        const bbox = turf.bbox(geojson);
        const minLng = bbox[0], minLat = bbox[1], maxLng = bbox[2], maxLat = bbox[3];
        const lngStep = (maxLng - minLng) / (numGrid - 1);
        const latStep = (maxLat - minLat) / (numGrid - 1);
        const gridPoints = [];

        // Adicionar pontos da grade interna contidos no polígono
        for (let i = 0; i < numGrid; i++) {
            for (let j = 0; j < numGrid; j++) {
                const ptLng = minLng + i * lngStep;
                const ptLat = minLat + j * latStep;
                const pt = turf.point([ptLng, ptLat]);
                
                if (turf.booleanPointInPolygon(pt, geojson)) {
                    gridPoints.push([ptLng, ptLat]);
                }
            }
        }

        // Fallback se a grade inicial gerar poucos pontos (ex: polígono muito estreito ou pequeno)
        if (gridPoints.length < 10) {
            const denserPoints = [];
            const denseGrid = 9;
            const dLngStep = (maxLng - minLng) / (denseGrid - 1);
            const dLatStep = (maxLat - minLat) / (denseGrid - 1);
            
            for (let i = 0; i < denseGrid; i++) {
                for (let j = 0; j < denseGrid; j++) {
                    const ptLng = minLng + i * dLngStep;
                    const ptLat = minLat + j * dLatStep;
                    const pt = turf.point([ptLng, ptLat]);
                    
                    if (turf.booleanPointInPolygon(pt, geojson)) {
                        denserPoints.push([ptLng, ptLat]);
                    }
                }
            }
            
            if (denserPoints.length >= 10) {
                return denserPoints;
            }
            
            // Fallback absoluto: Amostrar os vértices externos do polígono
            const polyCoords = geojson.geometry.type === "Polygon" 
                ? geojson.geometry.coordinates[0] 
                : (geojson.geometry.type === "MultiPolygon" ? geojson.geometry.coordinates[0][0] : geojson.geometry.coordinates);
                
            const vertexSamples = [];
            const step = Math.max(1, Math.floor(polyCoords.length / 15));
            for (let i = 0; i < polyCoords.length; i += step) {
                vertexSamples.push(polyCoords[i]);
            }
            return vertexSamples;
        }

        // Limitar o número de pontos internos para no máximo 25 (para não estourar a API e manter o gráfico nítido)
        if (gridPoints.length > 25) {
            const reduced = [];
            const step = (gridPoints.length - 1) / 24;
            for (let i = 0; i < 25; i++) {
                const idx = Math.round(i * step);
                reduced.push(gridPoints[idx]);
            }
            return reduced;
        }

        return gridPoints;
    }

    function renderAltimetryChartSVG(elevations) {
        const width = 360;
        const height = 120;
        const padding = 20;
        
        const minVal = Math.min(...elevations);
        const maxVal = Math.max(...elevations);
        const valRange = (maxVal - minVal) || 1;
        
        const numPoints = elevations.length;
        const barWidth = (width - 2 * padding) / numPoints - 2;
        
        let barSvg = "";
        const points = [];
        
        for (let i = 0; i < numPoints; i++) {
            const x = padding + i * (barWidth + 2);
            const barHeight = ((elevations[i] - minVal) / valRange) * (height - 2 * padding);
            const y = height - padding - barHeight;
            
            // Proporção coroplética de verde (120) a vermelho (0)
            const ratio = (elevations[i] - minVal) / valRange;
            const hue = 120 - (ratio * 120);
            const color = `hsl(${hue}, 80%, 45%)`;
            
            barSvg += `
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" opacity="0.8" 
                      style="cursor: pointer; transition: all 0.15s;"
                      onmouseover="window.highlightAltiPoint(${i})" 
                      onmouseout="window.unhighlightAltiPoint(${i})" />
            `;
            
            points.push(`${x + barWidth / 2},${y}`);
        }
        
        const polylinePoints = points.join(" ");

        return `
        <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" style="background: rgba(0,0,0,0.3); border-radius: 6px; margin-top: 10px;">
            <line x1="${padding}" y1="${height/2}" x2="${width-padding}" y2="${height/2}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3" />
            
            <!-- Barras coropléticas -->
            ${barSvg}
            
            <!-- Linha conectiva de perfil no topo das barras -->
            <polyline points="${polylinePoints}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" style="pointer-events: none;" />
            
            <text x="${padding}" y="14" fill="rgba(255,255,255,0.5)" font-size="8" font-family="monospace">Max: ${maxVal.toFixed(1)}m</text>
            <text x="${padding}" y="${height - 5}" fill="rgba(255,255,255,0.5)" font-size="8" font-family="monospace">Min: ${minVal.toFixed(1)}m</text>
        </svg>
        `;
    }


    function analyzeAltimetry(geojson, title) {
        showInfoWidget("Calculando altimetria coroplética interna... Por favor, aguarde.");
        
        // Limpar marcadores coropléticos anteriores
        state.layers.altimetryMarkers.clearLayers();
        
        const samples = getInternalSamplePoints(geojson, 6);
        if (samples.length === 0) {
            showInfoWidget("Erro: Nenhuma coordenada interna encontrada para avaliar altimetria.");
            return;
        }

        const lats_array = samples.map(c => c[1]);
        const lngs_array = samples.map(c => c[0]);

        const processElevationData = (elevations) => {
            const min = Math.min(...elevations);
            const max = Math.max(...elevations);
            const avg = elevations.reduce((a, b) => a + b, 0) / elevations.length;
            const amplitude = max - min;

            // Plotar marcadores coropléticos de altimetria interna no mapa base Leaflet
            elevations.forEach((elev, i) => {
                const ratio = (elev - min) / ((max - min) || 1);
                const hue = 120 - (ratio * 120);
                const color = `hsl(${hue}, 85%, 45%)`;
                
                const marker = L.circleMarker([samples[i][1], samples[i][0]], {
                    radius: 6,
                    fillColor: color,
                    color: "#ffffff",
                    weight: 1.5,
                    fillOpacity: 0.95
                });
                
                marker.bindTooltip(`Ponto ${i+1}: <b>${elev.toFixed(1)}m</b> (Altimetria Interna)`, {
                    direction: 'top',
                    permanent: false
                });
                
                marker.altIndex = i;
                state.layers.altimetryMarkers.addLayer(marker);
            });

            // Enquadrar o mapa base nos marcadores de altimetria gerados
            if (state.layers.altimetryMarkers.getLayers().length > 0) {
                const bounds = L.featureGroup(state.layers.altimetryMarkers.getLayers()).getBounds();
                state.map.fitBounds(bounds, { padding: [50, 50] });
            }

            const chartSvg = renderAltimetryChartSVG(elevations);

            showInfoWidget(`
                <div style="font-size: 11px; line-height: 1.4;">
                    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:4px; margin-bottom:6px;">
                        <b style="color:#06b6d4;">📊 MDE Interno: ${title}</b>
                    </div>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:8px;">
                        <div>⛰️ <b>Mínima:</b> ${min.toFixed(1)}m</div>
                        <div>⛰️ <b>Máxima:</b> ${max.toFixed(1)}m</div>
                        <div>📈 <b>Média:</b> ${avg.toFixed(1)}m</div>
                        <div>📉 <b>Desnível:</b> ${amplitude.toFixed(1)}m</div>
                    </div>
                    ${chartSvg}
                    <span style="font-size: 8.5px; color:var(--text-secondary); display:block; text-align:center; margin-top:6px; font-weight:600; background:rgba(255,255,255,0.05); padding:3px; border-radius:4px;">
                        💡 Passe o mouse nas barras para ver a posição no mapa!
                    </span>
                </div>
            `);
        };



        // Tenta chamar o servidor local primeiro para cálculo offline
        fetch("/api/elevation-local", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                latitudes: lats_array,
                longitudes: lngs_array
            })
        })
        .then(res => {
            if (!res.ok) throw new Error("Servidor offline ou sem curvas locais");
            return res.json();
        })
        .then(data => {
            if (data && data.success && data.elevation && data.elevation.length > 0) {
                console.log("[Altimetria] Usando altimetria offline local.");
                processElevationData(data.elevation);
            } else {
                throw new Error("Dados locais vazios ou inválidos");
            }
        })
        .catch(err => {
            console.log("[Altimetria] Servidor local offline ou erro. Fazendo fallback para Open-Meteo online...", err);
            // Fallback para Open-Meteo online
            const lats = lats_array.join(",");
            const lngs = lngs_array.join(",");
            const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`;
            
            fetch(url)
                .then(res => {
                    if (!res.ok) throw new Error("Erro na API de Elevação Online");
                    return res.json();
                })
                .then(data => {
                    if (data && data.elevation && data.elevation.length > 0) {
                        processElevationData(data.elevation);
                    } else {
                        showInfoWidget("Erro: Resposta de altimetria online vazia.");
                    }
                })
                .catch(err2 => {
                    console.error("Erro ao obter altimetria do relevo:", err2);
                    showInfoWidget(`
                        <b>Erro de Conexão Altimétrica</b><br>
                        Não foi possível consultar os dados de relevo locais ou online.<br>
                        <span style="font-size:9px; color:var(--text-secondary);">Verifique se você possui conexão com a internet ou se o curvasdenivel.gpkg foi processado.</span>
                    `);
                });
        });
    }


    // === IMPORTAÇÃO DE KML NATIVA OFFLINE ===

    function parseKML(kmlText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, "text/xml");
        const placemarks = xmlDoc.getElementsByTagName("Placemark");
        const features = [];

        for (let i = 0; i < placemarks.length; i++) {
            const pm = placemarks[i];
            const nameEl = pm.getElementsByTagName("name")[0];
            const name = nameEl ? nameEl.textContent : "Elemento Importado";

            // 1. Ponto (Point)
            const pointEl = pm.getElementsByTagName("Point")[0];
            if (pointEl) {
                const coordEl = pointEl.getElementsByTagName("coordinates")[0];
                if (coordEl) {
                    const coords = parseKMLCoordinates(coordEl.textContent)[0];
                    if (coords) {
                        features.push({
                            type: "Feature",
                            properties: { name: name, type: "Point" },
                            geometry: { type: "Point", coordinates: coords }
                        });
                    }
                }
            }

            // 2. Linha (LineString)
            const lineEl = pm.getElementsByTagName("LineString")[0];
            if (lineEl) {
                const coordEl = lineEl.getElementsByTagName("coordinates")[0];
                if (coordEl) {
                    const coords = parseKMLCoordinates(coordEl.textContent);
                    if (coords.length > 0) {
                        features.push({
                            type: "Feature",
                            properties: { name: name, type: "Line" },
                            geometry: { type: "LineString", coordinates: coords }
                        });
                    }
                }
            }

            // 3. Polígono (Polygon)
            const polyEl = pm.getElementsByTagName("Polygon")[0];
            if (polyEl) {
                const coordEl = polyEl.getElementsByTagName("coordinates")[0];
                if (coordEl) {
                    const coords = parseKMLCoordinates(coordEl.textContent);
                    if (coords.length > 0) {
                        features.push({
                            type: "Feature",
                            properties: { name: name, type: "Polygon" },
                            geometry: { type: "Polygon", coordinates: [coords] }
                        });
                    }
                }
            }
        }

        return {
            type: "FeatureCollection",
            features: features
        };
    }

    function parseKMLCoordinates(coordText) {
        return coordText.trim().split(/[\s\r\n]+/).map(str => {
            const parts = str.split(",");
            return [parseFloat(parts[0]), parseFloat(parts[1])]; // [lng, lat]
        }).filter(coords => !isNaN(coords[0]) && !isNaN(coords[1]));
    }

    function importKMLData(kmlText, fileName) {
        try {
            const geojson = parseKML(kmlText);
            
            if (geojson.features.length === 0) {
                alert("Nenhuma geometria válida (ponto, linha ou polígono) encontrada no KML.");
                return;
            }

            // Limpar camada anterior
            state.layers.importedKML.clearLayers();

            const importedLayer = L.geoJSON(geojson, {
                style: (feature) => {
                    const type = feature.properties.type;
                    if (type === "Polygon") {
                        return {
                            color: "#8b5cf6", // Roxo elegante para polígonos KML importados
                            weight: 2.5,
                            fillColor: "#8b5cf6",
                            fillOpacity: 0.15,
                            dashArray: "3, 4"
                        };
                    } else if (type === "Line") {
                        return {
                            color: "#ec4899", // Rosa vibrante para linhas KML importadas
                            weight: 3,
                            opacity: 0.85
                        };
                    }
                },
                pointToLayer: (feature, latlng) => {
                    // Marcadores circulares ciano com borda roxa para os pontos KML importados
                    return L.circleMarker(latlng, {
                        radius: 6,
                        fillColor: "#06b6d4",
                        color: "#8b5cf6",
                        weight: 2,
                        fillOpacity: 0.9
                    });
                },
                onEachFeature: (feature, layer) => {
                    const name = feature.properties.name || "Sem Nome";
                    const type = feature.properties.type;
                    let desc = `<h3>KML Importado</h3><p><b>Elemento:</b> ${name}</p><p><b>Tipo:</b> ${type}</p>`;
                    
                    if (type === "Point") {
                        const latlng = layer.getLatLng();
                        desc += `<p>Lat: ${latlng.lat.toFixed(6)}</p><p>Lng: ${latlng.lng.toFixed(6)}</p>`;
                    }
                    
                    layer.bindPopup(desc);
                }
            }).addTo(state.layers.importedKML);

            // Ajustar o zoom do mapa para enquadrar os elementos importados
            state.map.fitBounds(importedLayer.getBounds(), { padding: [40, 40] });

            // Mostrar o botão de limpar na barra lateral
            document.getElementById("btn-clear-imported").style.display = "block";

            showInfoWidget(`Sucesso! Importado KML <b>"${fileName}"</b> contendo <b>${geojson.features.length} elementos</b>.`);
        } catch (error) {
            console.error("Erro ao importar dados do KML:", error);
            alert("Erro ao processar o arquivo KML. Verifique o formato.");
        }
    }

    // === FERRAMENTAS DE DESENHO MANUAL E RÉGUA ===
    
    function setTool(toolName) {
        if (state.activeTool === toolName) {
            deactivateTool();
            return;
        }

        deactivateTool();
        state.activeTool = toolName;

        const btnId = toolName === "measure" ? "tool-measure" : `tool-draw-${toolName.replace("draw-", "")}`;
        const activeBtn = document.getElementById(btnId);
        if (activeBtn) activeBtn.classList.add("active");

        state.map.getContainer().classList.add("tool-active");
        state.map.getContainer().style.cursor = "crosshair";
        
        switch (toolName) {
            case "measure":
                showInfoWidget("<b>Régua:</b> Clique no mapa para medir distância. A distância do segmento aparece junto ao cursor. Botão direito finaliza.");
                break;
            case "draw-point":
                showInfoWidget("<b>Ponto:</b> Clique no mapa para desenhar um ponto.");
                break;
            case "draw-line":
                showInfoWidget("<b>Linha:</b> Clique para desenhar; a distância do segmento aparece junto ao cursor. Ao finalizar (botão direito), cada trecho recebe um rótulo clicável para digitar a distância exata.");
                break;
            case "draw-poly":
                showInfoWidget("<b>Polígono:</b> Clique para desenhar; a distância do lado aparece junto ao cursor. Ao fechar (botão direito), cada lado recebe um rótulo clicável para digitar a distância exata.");
                break;
        }
    }

    function deactivateTool() {
        state.activeTool = null;
        document.querySelectorAll(".btn-tool").forEach(btn => btn.classList.remove("active"));
        
        if (state.map) {
            state.map.getContainer().classList.remove("tool-active");
            state.map.getContainer().style.cursor = "";
        }
        
        resetDrawingState();
        hideInfoWidget();
    }

    function resetDrawingState() {
        if (state.drawState.tempLine) {
            state.map.removeLayer(state.drawState.tempLine);
            state.drawState.tempLine = null;
        }
        if (state.drawState.activeGeometry && !state.layers.drawings.hasLayer(state.drawState.activeGeometry)) {
            state.map.removeLayer(state.drawState.activeGeometry);
        }
        state.drawState.points = [];
        state.drawState.markers.forEach(m => state.map.removeLayer(m));
        state.drawState.markers = [];
        state.drawState.activeGeometry = null;
        clearLiveDistanceTooltip();
    }

    function handleMapClick(e) {
        if (!state.activeTool) return;
        const latlng = e.latlng;

        if (state.activeTool === "draw-point") {
            const virtualCount = state.flightPlansData.filter(p => p.pointID.startsWith("Virtual-PT")).length + 1;
            const pointID = `Virtual-PT-${virtualCount}`;
            const planId = `flight-virtual-${virtualCount}`;
            const coords = [latlng.lng, latlng.lat];

            state.flightPlansData.push({
                id: planId,
                pointID: pointID,
                center: coords,
                elevation: null,
                polygon: null,
                range: state.params.range,
                width: state.params.width,
                height: state.params.height,
                selected: true,
                isVirtual: true
            });

            recalculateActiveFlightGeometries();
            deactivateTool();

            setTimeout(() => {
                openPlanPopup(planId, latlng);
            }, 120);
            return;
        }

        state.drawState.points.push(latlng);

        const marker = L.circleMarker(latlng, {
            radius: 4,
            fillColor: "#ffffff",
            color: state.activeTool === "measure" ? "#3b82f6" : "#10b981",
            weight: 2,
            fillOpacity: 1
        }).addTo(state.map);
        state.drawState.markers.push(marker);

        if (state.activeTool === "measure" || state.activeTool === "draw-line") {
            if (state.drawState.points.length === 1) {
                state.drawState.activeGeometry = L.polyline(state.drawState.points, {
                    color: state.activeTool === "measure" ? "#3b82f6" : "#10b981",
                    weight: 3
                }).addTo(state.map);
            } else {
                state.drawState.activeGeometry.setLatLngs(state.drawState.points);
                if (state.activeTool === "measure") {
                    const totalDist = calculateTotalDistance(state.drawState.points);
                    showInfoWidget(`<b>Régua:</b> Distância total: <b>${formatDistance(totalDist)}</b>. Botão direito finaliza.`);
                }
            }
        } 
        else if (state.activeTool === "draw-poly") {
            if (state.drawState.points.length === 1) {
                state.drawState.activeGeometry = L.polygon(state.drawState.points, {
                    color: "#10b981",
                    fillColor: "#10b981",
                    fillOpacity: 0.2,
                    weight: 3
                }).addTo(state.map);
            } else {
                state.drawState.activeGeometry.setLatLngs(state.drawState.points);
            }
        }
    }

    function handleMapMouseMove(e) {
        if (!state.activeTool || state.drawState.points.length === 0) return;
        const currentLatLng = e.latlng;
        const lastPoint = state.drawState.points[state.drawState.points.length - 1];

        if (state.drawState.tempLine) {
            state.drawState.tempLine.setLatLngs([lastPoint, currentLatLng]);
        } else {
            state.drawState.tempLine = L.polyline([lastPoint, currentLatLng], {
                color: state.activeTool === "measure" ? "#3b82f6" : "#10b981",
                weight: 2,
                dashArray: "5, 5"
            }).addTo(state.map);
        }

        // Distância geodésica do segmento em construção (do último ponto até o cursor).
        // Válido para "measure", "draw-line" e "draw-poly" — visualização em tempo real
        // de quantos metros está sendo criado a cada movimento do mouse.
        const segmentDist = lastPoint.distanceTo(currentLatLng);

        if (state.activeTool === "measure" || state.activeTool === "draw-line" || state.activeTool === "draw-poly") {
            updateLiveDistanceTooltip(currentLatLng, segmentDist);
        }

        if (state.activeTool === "measure") {
            const tempPoints = [...state.drawState.points, currentLatLng];
            const dist = calculateTotalDistance(tempPoints);
            showInfoWidget(`<b>Régua:</b> Distância: <b>${formatDistance(dist)}</b> (Segmento: ${formatDistance(segmentDist)})`);
        } else if (state.activeTool === "draw-line") {
            const tempPoints = [...state.drawState.points, currentLatLng];
            const totalLen = calculateTotalDistance(tempPoints);
            showInfoWidget(`<b>Linha:</b> Segmento atual: <b>${formatDistance(segmentDist)}</b> • Comprimento total: ${formatDistance(totalLen)}. Botão direito finaliza.`);
        } else if (state.activeTool === "draw-poly") {
            const tempPoints = [...state.drawState.points, currentLatLng];
            let perimeter = calculateTotalDistance(tempPoints);
            let areaText = "";
            if (tempPoints.length >= 3) {
                perimeter += tempPoints[tempPoints.length - 1].distanceTo(tempPoints[0]);
                try {
                    const ring = tempPoints.map(p => [p.lng, p.lat]);
                    ring.push(ring[0]);
                    const areaM2 = turf.area(turf.polygon([ring]));
                    areaText = ` • Área parcial: ${formatArea(areaM2)}`;
                } catch (err) {
                    // Geometria ainda inválida (ex.: pontos colineares) — ignora silenciosamente
                }
            }
            showInfoWidget(`<b>Polígono:</b> Lado atual: <b>${formatDistance(segmentDist)}</b> • Perímetro: ${formatDistance(perimeter)}${areaText}. Botão direito fecha.`);
        }
    }

    // Tooltip flutuante que acompanha o cursor durante o desenho, mostrando a
    // distância do segmento em construção — a resposta visual direta para
    // "quantos metros está sendo criado" pedida pelo operador.
    function updateLiveDistanceTooltip(latlng, distMeters) {
        const content = formatDistance(distMeters);
        if (!state.drawState.liveTooltip) {
            state.drawState.liveTooltip = L.tooltip({
                permanent: true,
                direction: "right",
                offset: [14, 0],
                className: "live-distance-tooltip",
                interactive: false
            })
                .setLatLng(latlng)
                .setContent(content)
                .addTo(state.map);
        } else {
            state.drawState.liveTooltip.setLatLng(latlng).setContent(content);
        }
    }

    function clearLiveDistanceTooltip() {
        if (state.drawState.liveTooltip) {
            state.map.removeLayer(state.drawState.liveTooltip);
            state.drawState.liveTooltip = null;
        }
    }

    function handleMapRightClick() {
        if (!state.activeTool) return;
        if (state.drawState.points.length > 0) {
            finalizeDrawing();
        }
    }

    // Monta o HTML do popup de um polígono desenhado manualmente (reutilizado na criação,
    // após edição por arraste de vértice e após edição de lado por distância exata).
    function buildDrawnPolygonPopupHTML(polyId, areaM2) {
        return `
            <div class="leaflet-custom-popup">
                <h3>Polígono Desenhado</h3>
                <p><b>Área Útil:</b> ${formatArea(areaM2)}</p>
                <p style="font-size:9px; margin-top:-2px;">💡 Clique em um rótulo de lado no mapa para digitar a distância exata.</p>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
                    <button class="btn btn-secondary btn-sm btn-edit-drawn-poly" data-poly-id="${polyId}" style="font-weight:700; font-size:10px;">
                        ✏️ Editar Polígono
                    </button>
                    <button class="btn btn-primary btn-sm btn-export-drawn-poly" data-poly-id="${polyId}" style="font-weight:700; font-size:10px;">
                        💾 Exportar Polígono
                    </button>
                    <button class="btn btn-secondary btn-sm btn-altimetry-poly" data-poly-id="${polyId}" style="font-weight:700; grid-column: span 2; font-size:10px;">
                        📊 Analisar Altimetria (MDE)
                    </button>
                </div>
            </div>
        `;
    }

    // Idem para linhas desenhadas manualmente.
    function buildDrawnLinePopupHTML(lenM) {
        return `
            <h3>Linha Criada</h3>
            <p>Extensão: <b>${formatDistance(lenM)}</b></p>
            <p style="font-size:9px;">💡 Clique em um rótulo de segmento no mapa para digitar a distância exata.</p>
        `;
    }

    function finalizeDrawing() {
        if (!state.drawState.activeGeometry) {
            deactivateTool();
            return;
        }

        if (state.drawState.tempLine) state.map.removeLayer(state.drawState.tempLine);
        state.drawState.markers.forEach(m => state.map.removeLayer(m));

        const finalGeom = state.drawState.activeGeometry;

        if (state.activeTool === "measure") {
            const totalDist = calculateTotalDistance(state.drawState.points);
            const lastPoint = state.drawState.points[state.drawState.points.length - 1];

            const measureLabel = L.marker(lastPoint, {
                icon: L.divIcon({
                    className: 'measure-label-container',
                    html: `<div class="measure-label-bubble">Total: ${formatDistance(totalDist)}</div>`,
                    iconSize: [120, 24],
                    iconAnchor: [60, 30]
                })
            });

            const measureGroup = L.featureGroup([finalGeom, measureLabel]);
            state.layers.drawings.addLayer(measureGroup);
            showInfoWidget(`Medição concluída: <b>${formatDistance(totalDist)}</b>.`);
        }
        else {
            finalGeom.addTo(state.layers.drawings);
            if (state.activeTool === "draw-poly") {
                const geojson = finalGeom.toGeoJSON();
                const areaM2 = turf.area(geojson);
                const polyId = `poly-${Date.now()}`;

                finalGeom.polyId = polyId;
                finalGeom.geojson = geojson;
                finalGeom.bindPopup(buildDrawnPolygonPopupHTML(polyId, areaM2));

                // Rótulo permanente e editável em cada lado do polígono
                renderSegmentLabels(finalGeom, true);
            } else if (state.activeTool === "draw-line") {
                const lenM = calculateTotalDistance(state.drawState.points);
                finalGeom.bindPopup(buildDrawnLinePopupHTML(lenM));

                // Rótulo permanente e editável em cada segmento da linha
                renderSegmentLabels(finalGeom, false);
            }
        }
        deactivateTool();
    }

    function clearDrawings() {
        stopEditingPolygon();
        state.layers.drawings.clearLayers();
        state.layers.altimetryMarkers.clearLayers();
        showInfoWidget("Desenhos manuais removidos.");
    }

    // === RÓTULOS DE DISTÂNCIA LATERAL EDITÁVEIS (polígonos e linhas desenhados manualmente) ===
    //
    // Requisito: a cada polígono/linha criado, cada lado recebe um rótulo permanente com a
    // distância; clicar no rótulo permite digitar a distância exata desejada, e o vértice
    // final daquele lado é reposicionado geodesicamente (mesmo azimute, nova distância) para
    // atendê-la — útil para redesenhar um limite a partir de medidas conhecidas de campo/memorial.

    function renderSegmentLabels(layer, isPolygon) {
        clearSegmentLabels(layer);
        layer.segmentLabelMarkers = [];

        const latlngs = isPolygon ? layer.getLatLngs()[0] : layer.getLatLngs();
        const n = latlngs.length;
        if (n < 2) return;

        const edgeCount = isPolygon ? n : n - 1; // polígono fecha (último lado volta ao primeiro vértice)

        for (let i = 0; i < edgeCount; i++) {
            const a = latlngs[i];
            const b = latlngs[(i + 1) % n];
            const dist = a.distanceTo(b);
            const midLatLng = L.latLng((a.lat + b.lat) / 2, (a.lng + b.lng) / 2);

            const labelMarker = L.marker(midLatLng, {
                icon: L.divIcon({
                    className: "segment-label-marker",
                    html: `<div class="segment-label-bubble" title="Clique para definir a distância exata deste lado">${formatDistance(dist)}</div>`,
                    iconSize: [1, 1],
                    iconAnchor: [0, 0]
                }),
                interactive: true,
                keyboard: false,
                zIndexOffset: 600
            });

            labelMarker.on("click", (e) => {
                L.DomEvent.stopPropagation(e);
                editSegmentLength(layer, isPolygon, i);
            });

            state.layers.drawings.addLayer(labelMarker);
            layer.segmentLabelMarkers.push(labelMarker);
        }
    }

    function clearSegmentLabels(layer) {
        if (layer && layer.segmentLabelMarkers) {
            layer.segmentLabelMarkers.forEach(m => state.layers.drawings.removeLayer(m));
        }
        if (layer) layer.segmentLabelMarkers = [];
    }

    function editSegmentLength(layer, isPolygon, edgeIndex) {
        const latlngsRef = isPolygon ? layer.getLatLngs()[0] : layer.getLatLngs();
        const n = latlngsRef.length;
        const a = latlngsRef[edgeIndex];
        const bIdx = (edgeIndex + 1) % n;
        const b = latlngsRef[bIdx];

        const currentDist = a.distanceTo(b);
        const input = prompt("Definir distância exata deste lado (em metros):", currentDist.toFixed(2));
        if (input === null) return; // cancelado pelo operador

        const newDist = parseFloat(input.replace(",", "."));
        if (isNaN(newDist) || newDist <= 0) {
            alert("Valor inválido. Informe um número maior que zero.");
            return;
        }

        // Reposiciona o vértice B ao longo do mesmo azimute geodésico (A → B), na nova distância.
        // Isso preserva a direção original do lado e altera apenas o comprimento.
        const bearing = turf.bearing(turf.point([a.lng, a.lat]), turf.point([b.lng, b.lat]));
        const destination = turf.destination(turf.point([a.lng, a.lat]), newDist, bearing, { units: "meters" });
        const newCoords = destination.geometry.coordinates; // [lng, lat]
        const newLatLng = L.latLng(newCoords[1], newCoords[0]);

        latlngsRef[bIdx] = newLatLng;

        if (isPolygon) {
            layer.setLatLngs([latlngsRef]);
            layer.geojson = layer.toGeoJSON();
            const areaM2 = turf.area(layer.geojson);
            if (layer.getPopup()) layer.setPopupContent(buildDrawnPolygonPopupHTML(layer.polyId, areaM2));
        } else {
            layer.setLatLngs(latlngsRef);
            layer.geojson = layer.toGeoJSON();
            const lenM = calculateTotalDistance(latlngsRef);
            if (layer.getPopup()) layer.setPopupContent(buildDrawnLinePopupHTML(lenM));
        }

        renderSegmentLabels(layer, isPolygon);
        showInfoWidget(`Lado ajustado para <b>${formatDistance(newDist)}</b>.`);
    }

    let activeEditLayers = [];

    function startEditingPolygon(polygonLayer) {
        stopEditingPolygon();

        showInfoWidget(`
            <b>Edição de Polígono Ativa</b><br>
            Arraste os vértices verdes para remodelar o polígono no mapa.<br>
            <button class="btn btn-primary btn-sm" id="btn-finish-poly-edit" style="margin-top: 8px; width: 100%; font-weight:700; background:linear-gradient(135deg, #10b981, #059669);">
                ✔️ Concluir Edição
            </button>
        `);

        document.getElementById("btn-finish-poly-edit").addEventListener("click", () => {
            stopEditingPolygon();

            const bounds = polygonLayer.getBounds();
            const center = bounds.getCenter();
            const areaM2 = turf.area(polygonLayer.geojson);

            polygonLayer.bindPopup(buildDrawnPolygonPopupHTML(polygonLayer.polyId, areaM2)).openPopup(center);
            renderSegmentLabels(polygonLayer, true);
        });

        const latlngs = polygonLayer.getLatLngs()[0];

        const vertexIcon = L.divIcon({
            className: 'vertex-edit-marker',
            html: '<div style="width:12px; height:12px; background:#10b981; border:2px solid #ffffff; border-radius:50%; box-shadow:0 0 6px rgba(0,0,0,0.6); cursor:pointer;"></div>',
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });

        // Durante a edição por arraste, os rótulos de lado ficam ocultos (seriam recriados a
        // cada pixel de arraste, o que é caro); eles voltam ao concluir a edição, já refletindo
        // as novas distâncias.
        clearSegmentLabels(polygonLayer);

        latlngs.forEach((latlng, idx) => {
            const marker = L.marker([latlng.lat, latlng.lng], {
                icon: vertexIcon,
                draggable: true
            }).addTo(state.map);

            activeEditLayers.push(marker);

            marker.on('drag', () => {
                const currentLatLngs = polygonLayer.getLatLngs()[0];
                currentLatLngs[idx] = marker.getLatLng();
                polygonLayer.setLatLngs([currentLatLngs]);
            });

            marker.on('dragend', () => {
                const finalLatLngs = polygonLayer.getLatLngs()[0];
                finalLatLngs[idx] = marker.getLatLng();
                polygonLayer.setLatLngs([finalLatLngs]);
                polygonLayer.geojson = polygonLayer.toGeoJSON();
            });
        });
    }

    function stopEditingPolygon() {
        activeEditLayers.forEach(m => state.map.removeLayer(m));
        activeEditLayers = [];
        hideInfoWidget();
    }

    function calculateTotalDistance(points) {
        let distance = 0;
        for (let i = 0; i < points.length - 1; i++) {
            distance += points[i].distanceTo(points[i + 1]);
        }
        return distance;
    }

    function formatDistance(meters) {
        if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
        return `${meters.toFixed(0)} m`;
    }

    function formatArea(sqMeters) {
        if (sqMeters >= 1000000) return `${(sqMeters / 1000000).toFixed(2)} km²`;
        return `${(sqMeters / 10000).toFixed(2)} ha (hectares)`;
    }

    // Info widgets
    function showInfoWidget(htmlContent) {
        const widget = document.getElementById("info-widget");
        const content = document.getElementById("info-widget-content");
        content.innerHTML = htmlContent;
        widget.classList.remove("hidden");
    }

    function hideInfoWidget() {
        document.getElementById("info-widget").classList.add("hidden");
    }

    function updateStats() {
        const totalPoints = state.rawGeoJSON.pontos ? state.rawGeoJSON.pontos.features.length : 0;
        document.getElementById("stat-total-points").textContent = totalPoints;

        const activeFlightsCount = state.flightPlansData.filter(f => f.selected && f.polygon).length;
        document.getElementById("stat-selected-flights").textContent = activeFlightsCount;
    }

    function setupControls() {
        document.getElementById("layer-areas").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.areas);
            else state.map.removeLayer(state.layers.areas);
        });

        document.getElementById("layer-points").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.points);
            else state.map.removeLayer(state.layers.points);
        });

        document.getElementById("layer-active-bases").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.activeBases);
            else state.map.removeLayer(state.layers.activeBases);
        });

        document.getElementById("layer-flightplans").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.flightplans);
            else state.map.removeLayer(state.layers.flightplans);
        });

        document.getElementById("layer-drawings").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.drawings);
            else state.map.removeLayer(state.layers.drawings);
        });

        document.getElementById("layer-imported").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.importedKML);
            else state.map.removeLayer(state.layers.importedKML);
        });

        document.getElementById("layer-curvas").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.curvas);
            else state.map.removeLayer(state.layers.curvas);
        });

        document.getElementById("layer-curvas-opacity").addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById("layer-curvas-opacity-val").textContent = Math.round(val * 100) + "%";
            state.layers.curvas.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ opacity: val });
                }
            });
        });

        document.getElementById("layer-vicinais").addEventListener("change", (e) => {
            if (e.target.checked) state.map.addLayer(state.layers.vicinais);
            else state.map.removeLayer(state.layers.vicinais);
        });

        document.getElementById("layer-vicinais-opacity").addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById("layer-vicinais-opacity-val").textContent = Math.round(val * 100) + "%";
            state.layers.vicinais.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ opacity: val });
                }
            });
        });

        document.getElementById("layer-sat-opacity").addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById("layer-sat-opacity-val").textContent = Math.round(val * 100) + "%";
            if (state.layers.satellite) state.layers.satellite.setOpacity(val);
            if (state.layers.googleSatellite) state.layers.googleSatellite.setOpacity(val);
            if (state.layers.googleHybrid) state.layers.googleHybrid.setOpacity(val);
        });

        document.getElementById("layer-areas-opacity").addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById("layer-areas-opacity-val").textContent = Math.round(val * 100) + "%";
            state.layers.areas.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ fillOpacity: val });
                }
            });
        });

        document.getElementById("layer-flightplans-opacity").addEventListener("input", (e) => {
            const val = parseFloat(e.target.value);
            document.getElementById("layer-flightplans-opacity-val").textContent = Math.round(val * 100) + "%";
            state.layers.flightplans.eachLayer(layerGroup => {
                if (layerGroup.eachLayer) {
                    layerGroup.eachLayer(sublayer => {
                        if (sublayer.setStyle && sublayer.options.className === "flight-poly-layer") {
                            sublayer.setStyle({ 
                                fillOpacity: sublayer.options.isSelectedActive ? val : val * (0.12 / 0.28) 
                            });
                        }
                    });
                }
            });
        });

        // Importação de KML
        const inputKml = document.getElementById("input-kml");
        const btnClearImported = document.getElementById("btn-clear-imported");

        inputKml.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const kmlText = event.target.result;
                importKMLData(kmlText, file.name);
                inputKml.value = "";
            };
            reader.readAsText(file);
        });

        btnClearImported.addEventListener("click", () => {
            state.layers.importedKML.clearLayers();
            btnClearImported.style.display = "none";
            showInfoWidget("KML Importado limpo.");
        });

        // Formato da Área de Voo (Circular vs Retangular)
        const shapeSelect = document.getElementById("param-flight-shape");
        const containerRange = document.getElementById("container-param-range");
        const containerWidth = document.getElementById("container-param-width");
        const containerHeight = document.getElementById("container-param-height");

        shapeSelect.addEventListener("change", (e) => {
            const shape = e.target.value;
            state.params.shape = shape;
            
            if (shape === "rectangle") {
                containerRange.style.display = "none";
                containerWidth.style.display = "block";
                containerHeight.style.display = "block";
            } else {
                containerRange.style.display = "block";
                containerWidth.style.display = "none";
                containerHeight.style.display = "none";
            }
            recalculateActiveFlightGeometries();
        });

        const rangeSlider = document.getElementById("param-range");
        const rangeDisplay = document.getElementById("range-val-display");
        rangeSlider.addEventListener("input", (e) => {
            state.params.range = parseInt(e.target.value);
            rangeDisplay.textContent = `${state.params.range.toLocaleString('pt-BR')} m`;
        });
        rangeSlider.addEventListener("change", () => {
            recalculateActiveFlightGeometries();
        });

        const widthSlider = document.getElementById("param-width");
        const widthDisplay = document.getElementById("width-val-display");
        widthSlider.addEventListener("input", (e) => {
            state.params.width = parseInt(e.target.value);
            widthDisplay.textContent = `${state.params.width.toLocaleString('pt-BR')} m`;
        });
        widthSlider.addEventListener("change", () => {
            recalculateActiveFlightGeometries();
        });

        const heightSlider = document.getElementById("param-height");
        const heightDisplay = document.getElementById("height-val-display");
        heightSlider.addEventListener("input", (e) => {
            state.params.height = parseInt(e.target.value);
            heightDisplay.textContent = `${state.params.height.toLocaleString('pt-BR')} m`;
        });
        heightSlider.addEventListener("change", () => {
            recalculateActiveFlightGeometries();
        });

        const overlapSlider = document.getElementById("param-overlap");
        const overlapDisplay = document.getElementById("overlap-val-display");
        overlapSlider.addEventListener("input", (e) => {
            state.params.overlap = parseInt(e.target.value);
            overlapDisplay.textContent = `${state.params.overlap} m`;
        });
        overlapSlider.addEventListener("change", () => {
            recalculateActiveFlightGeometries();
        });

        document.getElementById("btn-generate-plan").addEventListener("click", generateSmartPlan);
        document.getElementById("btn-clear-plan").addEventListener("click", clearFlightPlan);

        document.getElementById("tool-measure").addEventListener("click", () => setTool("measure"));
        document.getElementById("tool-draw-point").addEventListener("click", () => setTool("draw-point"));
        document.getElementById("tool-draw-line").addEventListener("click", () => setTool("draw-line"));
        document.getElementById("tool-draw-poly").addEventListener("click", () => setTool("draw-poly"));

        document.getElementById("btn-clear-drawings").addEventListener("click", clearDrawings);
        document.getElementById("btn-export-kml").addEventListener("click", exportToKML);
        document.getElementById("btn-close-widget").addEventListener("click", hideInfoWidget);

        const btnSelectDir = document.getElementById("btn-select-dir");
        if (btnSelectDir) {
            if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
                btnSelectDir.style.display = "none";
            } else {
                btnSelectDir.addEventListener("click", () => {
                    fetch("/api/select-dir", { method: "POST" })
                    .then(res => {
                        if (!res.ok) throw new Error("Erro na API local");
                        return res.json();
                    })
                    .then(data => {
                        if (data.success && data.directory) {
                            document.getElementById("export-directory").value = data.directory;
                            showInfoWidget(`Pasta de destino selecionada:<br><small style="word-break:break-all; font-size:10px; color:#10b981; font-family:monospace;">${data.directory}</small>`);
                        }
                    })
                    .catch(err => {
                        console.error("Erro ao selecionar diretório local:", err);
                        alert("Não foi possível abrir o seletor de pastas do Windows. Verifique se o servidor está ativo.");
                    });
                });
            }
        }

        // Toggle da Sidebar (Aba Lateral)
        const sidebar = document.getElementById("sidebar");
        const sidebarToggle = document.getElementById("sidebar-toggle");
        const appContainer = document.getElementById("app-container");

        sidebarToggle.addEventListener("click", () => {
            const isCollapsed = sidebar.classList.toggle("collapsed");
            appContainer.classList.toggle("sidebar-collapsed", isCollapsed);
            
            // Alterar o ícone e título do botão
            if (isCollapsed) {
                sidebarToggle.textContent = "▶";
                sidebarToggle.title = "Expandir Painel";
            } else {
                sidebarToggle.textContent = "◀";
                sidebarToggle.title = "Recolher Painel";
            }

            // Notificar o Leaflet que o tamanho mudou
            setTimeout(() => {
                state.map.invalidateSize({ animate: true });
            }, 300);
        });

        // Busca de Pontos Geodésicos
        const btnSearch = document.getElementById("btn-search-point");
        const inputSearch = document.getElementById("search-point-input");

        if (btnSearch && inputSearch) {
            btnSearch.addEventListener("click", searchAndFocusPoint);
            inputSearch.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    searchAndFocusPoint();
                }
            });
        }
    }

    function searchAndFocusPoint() {
        const query = document.getElementById("search-point-input").value.trim().toUpperCase();
        if (!query) {
            alert("Digite o nome ou ID do ponto para pesquisar.");
            return;
        }

        let found = false;

        // 1. Procurar nas bases ativas
        state.layers.activeBases.eachLayer((marker) => {
            if (found) return;
            const tooltipText = marker.getTooltip() ? marker.getTooltip().getContent() : "";
            if (tooltipText.toUpperCase().includes(query)) {
                state.map.setView(marker.getLatLng(), 16);
                
                const plan = state.flightPlansData.find(p => tooltipText.includes(p.pointID));
                if (plan) {
                    openPlanPopup(plan.id, marker.getLatLng());
                } else {
                    marker.openTooltip();
                }
                found = true;
            }
        });

        if (found) return;

        // 2. Procurar nos marcadores de pontos inativos
        state.layers.points.eachLayer((marker) => {
            if (found) return;
            const popupContent = marker.getPopup() ? marker.getPopup().getContent() : "";
            if (popupContent.toUpperCase().includes(query)) {
                state.map.setView(marker.getLatLng(), 16);
                marker.openPopup();
                found = true;
            }
        });

        if (found) return;

        // 3. Se o ponto existe no GeoJSON bruto, mas a camada está oculta
        if (state.rawGeoJSON.pontos) {
            const rawFeature = state.rawGeoJSON.pontos.features.find(f => 
                f.properties.PointID && f.properties.PointID.toUpperCase().includes(query)
            );
            if (rawFeature) {
                const coords = rawFeature.geometry.coordinates;
                
                const pointsCheckbox = document.getElementById("layer-points");
                if (pointsCheckbox) {
                    pointsCheckbox.checked = true;
                }
                state.map.addLayer(state.layers.points);
                
                renderPoints();
                state.map.setView([coords[1], coords[0]], 16);
                
                setTimeout(() => {
                    state.layers.points.eachLayer((marker) => {
                        const popupContent = marker.getPopup() ? marker.getPopup().getContent() : "";
                        if (popupContent.toUpperCase().includes(query)) {
                            marker.openPopup();
                        }
                    });
                }, 120);
                
                found = true;
            }
        }

        if (!found) {
            alert(`Ponto "${query}" não encontrado na base de dados geodésica.`);
        }
    }

    initMap();
    setupControls();
    loadData();
});
