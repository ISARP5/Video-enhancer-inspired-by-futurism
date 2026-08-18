let selectedMode = null;
const cards = document.querySelectorAll('.card');
const confirmBtn = document.getElementById('btn-confirm');
const container = document.getElementById('main-container');

cards.forEach(card => {
    card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedMode = card.dataset.mode;
        confirmBtn.classList.add('active');
    });
});

confirmBtn.addEventListener('click', () => {
    if (!selectedMode) return;

    // Guardar configuración
    chrome.storage.local.set({
        ve_device_mode: selectedMode,
        ve_setup_complete: true
    }, () => {
        // Animación de salida
        container.classList.add('exiting');
        setTimeout(() => {
            window.close();
        }, 500);
    });
});
