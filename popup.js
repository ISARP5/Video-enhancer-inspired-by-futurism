const PERFILES = {
    default: { sharpness: 0, contrast: 100, saturation: 100, brightness: 100, algorithm: 'CAS' },
    auto:    { sharpness: 15, contrast: 108, saturation: 112, brightness: 100, algorithm: 'CAS' },
    v1_stable: { sharpness: 15, contrast: 108, saturation: 112, brightness: 100, algorithm: 'V1' }
};

let debounceTimer;

document.addEventListener('DOMContentLoaded', () => {
    const inputs = {
        sharpness: document.getElementById('sharpness'),
        contrast: document.getElementById('contrast'),
        saturation: document.getElementById('saturation'),
        brightness: document.getElementById('brightness')
    };
    
    const displays = {
        sharpness: document.getElementById('val-sharpness'),
        contrast: document.getElementById('val-contrast'),
        saturation: document.getElementById('val-saturation'),
        brightness: document.getElementById('val-brightness')
    };

    const modeBtns = document.querySelectorAll('.mode-btn');
    const slidersPanel = document.getElementById('sliders-panel');
    const resetBtn = document.getElementById('btn-reset'); // Restored name to fit requested CSS

    chrome.storage.local.get(['videoEnhancerSettings'], (result) => {
        const settings = result.videoEnhancerSettings || { ...PERFILES.auto, mode: 'auto' };
        setUIState(settings.mode || 'custom', settings);
    });

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === 'default' || mode === 'auto') {
                setUIState(mode, PERFILES[mode]);
                saveToGlobalState(mode, PERFILES[mode]);
            } else {
                setUIState('custom');
                saveToGlobalState('custom'); 
            }
        });
    });

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            setUIState('custom', PERFILES.v1_stable);
            saveToGlobalState('custom', PERFILES.v1_stable);
        });
    }

    for (const [key, input] of Object.entries(inputs)) {
        // Micro-interacciones UI requeridas por UX
        const addInteracting = () => displays[key].classList.add('interacting');
        const removeInteracting = () => displays[key].classList.remove('interacting');
        
        input.addEventListener('mousedown', addInteracting);
        input.addEventListener('touchstart', addInteracting);
        
        input.addEventListener('mouseup', removeInteracting);
        input.addEventListener('mouseleave', removeInteracting);
        input.addEventListener('touchend', removeInteracting);

        input.addEventListener('input', (e) => {
            displays[key].textContent = e.target.value + '%';
            
            const activeMode = document.querySelector('.mode-btn.active')?.dataset.mode || 'custom';
            if(activeMode !== 'custom') {
                setUIState('custom');
            }

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => saveToGlobalState('custom'), 60);
        });
    }

    function setUIState(mode, valuesObj = null) {
        modeBtns.forEach(b => b.classList.remove('active'));
        const btn = document.getElementById(`btn-${mode}`);
        if(btn) btn.classList.add('active');

        if (mode === 'custom') {
            slidersPanel.classList.remove('disabled');
        } else {
            slidersPanel.classList.add('disabled');
        }

        if (valuesObj) {
            for (const [key, input] of Object.entries(inputs)) {
                if (valuesObj[key] !== undefined) {
                    input.value = valuesObj[key];
                    displays[key].textContent = valuesObj[key] + '%';
                }
            }
        }
    }

    async function saveToGlobalState(mode, specificSettings = null) {
        let settings = specificSettings ? { ...specificSettings } : {
            sharpness: parseInt(inputs.sharpness.value, 10),
            contrast: parseInt(inputs.contrast.value, 10),
            saturation: parseInt(inputs.saturation.value, 10),
            brightness: parseInt(inputs.brightness.value, 10),
            algorithm: 'CAS'
        };
        
        if (specificSettings && specificSettings.algorithm) {
            settings.algorithm = specificSettings.algorithm;
        }
        
        settings.mode = mode; 
        await chrome.storage.local.set({ videoEnhancerSettings: settings });
    }
});
