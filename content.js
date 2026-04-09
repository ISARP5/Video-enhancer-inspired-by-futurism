/**
 * =========================================================================
 * RESTORE_POINT_STABLE_V1
 * =========================================================================
 * ARCHIVO DE RESPALDO - MOTOR GENERACIÓN 1
 */

(() => {
    if (window.__videoEnhancerInjected) return;
    window.__videoEnhancerInjected = true;

    let state = {
        sharpness: 15,    
        contrast: 108,    
        saturation: 112,  
        brightness: 100,
        algorithm: 'CAS',
        mode: 'auto'
    };

    // --- VARIABLES MOTOR AUTO-ADAPTATIVO ---
    const analyzerCanvas = document.createElement('canvas');
    analyzerCanvas.width = 32;
    analyzerCanvas.height = 32;
    const analyzerCtx = analyzerCanvas.getContext('2d', { willReadFrequently: true });
    const dynamicVideoStates = new WeakMap();
    let autoEngineInterval = null;
    // ---------------------------------------

    const svgFilterId = 'video-enhancer-svg-filter';
    const feCasCompositeId = 've-cas-composite';
    const feConvolveId = 've-convolve-matrix';
    
    // Referencia dura para evadir la caché destructiva de Chromium sobre Mutaciones en SVGs
    let sharpFilterNode = null; 

    function setupSVGFilter() {
        if (document.getElementById(svgFilterId)) return;

        const svgNS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNS, 'svg');
        svg.id = svgFilterId;
        svg.style.cssText = 'width: 0; height: 0; position: absolute; z-index: -99999; visibility: hidden;';
        svg.setAttribute('aria-hidden', 'true');

        const filter = document.createElementNS(svgNS, 'filter');
        filter.id = 've-sharpen-filter-base';
        filter.setAttribute('color-interpolation-filters', 'sRGB');
        sharpFilterNode = filter;

        // Nodo Universal Convolve - El único que procesa números negativos matemáticamente antes de pintar
        const feConvolve = document.createElementNS(svgNS, 'feConvolveMatrix');
        feConvolve.id = feConvolveId;
        feConvolve.setAttribute('order', '3 3');
        feConvolve.setAttribute('preserveAlpha', 'true');
        feConvolve.setAttribute('kernelMatrix', '0 0 0  0 1 0  0 0 0'); 
        
        filter.appendChild(feConvolve);
        svg.appendChild(filter);
        
        if (document.body) {
            document.body.appendChild(svg);
        } else {
            document.addEventListener('DOMContentLoaded', () => document.body.appendChild(svg));
        }
    }

    function updateFilterMath() {
        const feConvolve = document.getElementById(feConvolveId);
        if (!feConvolve || !sharpFilterNode) return;

        // BUST CACHE CHROMIUM
        sharpFilterNode.id = `ve-cas-${Date.now()}-${Math.floor(Math.random() * 100)}`;

        if (state.sharpness === 0) {
            feConvolve.setAttribute('kernelMatrix', '0 0 0  0 1 0  0 0 0');
        } else {
            /* 
             * [FÍSICA DEL MOTOR CAS - SINGLE-PASS SPATIAL UPSCALING CON THRESHOLD]
             * La escala se limita matemáticamente a un multiplicador de x2.5 máximo.
             * Al definir el centro adaptativo `1 + (4*a)`, el filtro actúa como un umbral (threshold) 
             * natural que ignora grandes áreas planas de color (donde la variante espacial es cero) 
             * y aplica la fuerza 'a' estrictamente sobre los bordes detectables, previniendo
             * el ruido de compresión en las áreas de gradiente.
             */
            const a = (state.sharpness / 100) * 2.5; 
            const center = 1 + (4 * a);
            // Matriz Unsharp adaptativa -> bordes oscuros se hunden y bordes brillantes suben sin clip intermedio
            feConvolve.setAttribute('kernelMatrix', `0 ${-a} 0  ${-a} ${center} ${-a}  0 ${-a} 0`);
        }
    }

    function runAutoEngine() {
        if (state.mode !== 'auto') return;
        
        const videos = document.querySelectorAll('video');
        videos.forEach(video => {
            if (video.dataset.veVisible === 'true' && !video.paused && video.readyState >= 2) {
                try {
                    analyzerCtx.drawImage(video, 0, 0, 32, 32);
                    const pixels = analyzerCtx.getImageData(0, 0, 32, 32).data;
                    let totalLuma = 0;
                    
                    for (let i = 0; i < pixels.length; i += 4) {
                        const r = pixels[i];
                        const g = pixels[i+1];
                        const b = pixels[i+2];
                        totalLuma += 0.299 * r + 0.587 * g + 0.114 * b;
                    }
                    
                    const avgLuma = totalLuma / 1024;
                    
                    let targetBrightness = state.brightness || 100;
                    let targetContrast = state.contrast || 108;
                    let targetSaturation = state.saturation || 112;

                    if (avgLuma < 50) {
                        targetBrightness = 125;
                        targetContrast = 100; 
                        targetSaturation = 108;
                    } else if (avgLuma < 100) {
                        targetBrightness = 115;
                        targetContrast = 105;
                        targetSaturation = 110;
                    } else if (avgLuma > 200) {
                        targetBrightness = 92;
                        targetContrast = 115;
                        targetSaturation = 115;
                    }

                    dynamicVideoStates.set(video, {
                        brightness: targetBrightness,
                        contrast: targetContrast,
                        saturation: targetSaturation
                    });

                    applyFiltersToVideo(video);

                    // COMUNICACIÓN UI: Enviar valores en vivo al popup si está abierto
                    if (chrome.runtime && chrome.runtime.sendMessage) {
                        chrome.runtime.sendMessage({
                            type: 'VE_AUTO_UPDATE',
                            payload: {
                                brightness: targetBrightness,
                                contrast: targetContrast,
                                saturation: targetSaturation
                            }
                        }).catch(() => { /* El popup está cerrado, ignorar error */ });
                    }

                } catch(e) {
                    // CORS issues for cross-origin <video> without anonymous attribute
                }
            }
        });
    }

    function applyFiltersToVideo(videoTarget) {
        // CORRECCIÓN: Permitimos ejecución aunque el video esté en pausa.
        // Los usuarios pausados necesitan ver feedback visual en tiempo real al mover los sliders interactivos!
        if (videoTarget.dataset.veVisible === 'false') {
            videoTarget.style.filter = '';
            return;
        }

        let currentActiveState = state;

        if (state.mode === 'auto') {
            videoTarget.style.transition = 'filter 1.5s ease-in-out';
            if (dynamicVideoStates.has(videoTarget)) {
                currentActiveState = dynamicVideoStates.get(videoTarget);
            }
        } else {
            videoTarget.style.transition = '';
        }

        let filters = [];
        if (currentActiveState.contrast !== 100) filters.push(`contrast(${currentActiveState.contrast}%)`);
        if (currentActiveState.saturation !== 100) filters.push(`saturate(${currentActiveState.saturation}%)`);
        if (currentActiveState.brightness !== 100) filters.push(`brightness(${currentActiveState.brightness}%)`);
        
        // El afilado es universal con el math global de SVG CAS
        if (state.sharpness > 0 && sharpFilterNode) {
            filters.push(`url('#${sharpFilterNode.id}')`);
        }

        videoTarget.style.filter = filters.join(' ');
        
        if (videoTarget.style.willChange !== 'filter') {
            videoTarget.style.willChange = 'filter';
        }
    }

    const visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target;
            video.dataset.veVisible = entry.isIntersecting ? 'true' : 'false';
            
            // Re-evaluar
            applyFiltersToVideo(video);
        });
    }, { threshold: 0.1 });

    function attachVideoEvents(videoTarget) {
        if (videoTarget.dataset.veEnhanced) return;
        videoTarget.dataset.veEnhanced = "true";
        videoTarget.dataset.veVisible = "true";
        
        videoTarget.style.willChange = 'filter';
        visibilityObserver.observe(videoTarget);
    }

    function processGlobalFilters() {
        updateFilterMath();
        document.querySelectorAll('video').forEach(applyFiltersToVideo);
    }

    function initVideoObserver() {
        document.querySelectorAll('video').forEach(attachVideoEvents);
        const observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            mutations.forEach(mutation => {
                if (mutation.addedNodes) {
                    mutation.addedNodes.forEach(node => {
                        if (node.tagName === 'VIDEO') {
                            attachVideoEvents(node);
                            shouldProcess = true;
                        } else if (node.querySelectorAll) {
                            const vids = node.querySelectorAll('video');
                            if (vids.length > 0) {
                                vids.forEach(attachVideoEvents);
                                shouldProcess = true;
                            }
                        }
                    });
                }
            });
            if (shouldProcess) processGlobalFilters();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function initializeEngine() {
        setupSVGFilter();
        
        if (!autoEngineInterval) {
            autoEngineInterval = setInterval(runAutoEngine, 1500);
        }

        chrome.storage.local.get(['videoEnhancerSettings'], (result) => {
            if (result.videoEnhancerSettings) {
                state = { ...state, ...result.videoEnhancerSettings };
            } else {
                chrome.storage.local.set({ videoEnhancerSettings: state });
            }
            initVideoObserver();
            processGlobalFilters();
        });
        
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'local' && changes.videoEnhancerSettings) {
                state = { ...state, ...changes.videoEnhancerSettings.newValue };
                processGlobalFilters();
            }
        });
    }

    initializeEngine();

})();
