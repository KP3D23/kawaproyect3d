// ==========================================
// CONTROLADOR DE INTERFAZ (UI/UX) - KAWAPROYECTS3D
// ==========================================

// Tarifas base (USD por cm2) calibradas a la realidad de Barinas
const TARIFAS = {
    'letrero_neon': 0.06, 
    'letrero_pvc':  0.04, 
    'letrero_3d':   0.05, 
    'llavero':      0.10, 
    'figura':       0.15  
};

// 1. Pestañas del Estudio Creativo
window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    if(tabName === 'upload') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tab-upload').classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tab-ai').classList.add('active');
    }
};

// 2. Calculadora Paramétrica Inteligente
function calcularCotizacion() {
    const anchoInput = document.getElementById('dim-ancho');
    if (!anchoInput) return; // Evitar errores si estamos en taller.html

    const ancho = parseFloat(anchoInput.value) || 0;
    const alto = parseFloat(document.getElementById('dim-alto').value) || 0;
    const tipo = document.getElementById('tipo-producto').value;
    
    // Matemática: Área (cm2) * Tarifa del producto
    const area = ancho * alto;
    const totalUsd = (area * TARIFAS[tipo]).toFixed(2);
    
    document.getElementById('precio-total').textContent = `$${totalUsd} USD`;
    document.getElementById('precio-anticipo').textContent = `$${(totalUsd / 2).toFixed(2)} USD`;
}

// Escuchar cambios en los inputs para recalcular en vivo
['dim-ancho', 'dim-alto', 'tipo-producto'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', calcularCotizacion);
});
calcularCotizacion(); // Cálculo inicial

// 3. Previsualizador de Imagen Local (Simulando carga de logo)
const inputImagen = document.getElementById('input-imagen-cliente');
if (inputImagen) {
    inputImagen.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const url = URL.createObjectURL(e.target.files[0]);
            document.getElementById('placeholder-2d').style.display = 'none';
            const img = document.getElementById('preview-2d');
            img.src = url;
            img.style.display = 'block';
        }
    });
}

// 4. Simulación del Botón de Envío (Animación visual)
const btnEnviar = document.getElementById('btn-enviar-orden');
if (btnEnviar) {
    btnEnviar.addEventListener('click', () => {
        const nombre = document.getElementById('cliente-nombre').value.trim();
        if (!nombre) return alert('Por favor, indica un nombre para el pedido.');
        
        btnEnviar.classList.add('loading');
        btnEnviar.innerHTML = 'Procesando... 🚚'; // Aquí aplicamos la idea del "Animated Order Button"
        
        // Simulamos un delay de red de 1.5 segundos
        setTimeout(() => {
            btnEnviar.classList.remove('loading');
            btnEnviar.innerHTML = '¡Pedido Confirmado! ✅';
            btnEnviar.style.background = '#10b981';
            
            setTimeout(() => {
                btnEnviar.innerHTML = 'Confirmar Pedido';
                btnEnviar.style.background = '';
            }, 3000);
        }, 1500);
    });
}
