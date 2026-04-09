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
        algorithm: 'CAS'
    };

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

    function applyFiltersToVideo(videoTarget) {
        // CORRECCIÓN: Permitimos ejecución aunque el video esté en pausa.
        // Los usuarios pausados necesitan ver feedback visual en tiempo real al mover los sliders interactivos!
        if (videoTarget.dataset.veVisible === 'false') {
            videoTarget.style.filter = '';
            return;
        }

        let filters = [];
        if (state.contrast !== 100) filters.push(`contrast(${state.contrast}%)`);
        if (state.saturation !== 100) filters.push(`saturate(${state.saturation}%)`);
        if (state.brightness !== 100) filters.push(`brightness(${state.brightness}%)`);
        
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
