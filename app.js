import { supabase } from './supa.js';
import { generarImagen2D, generarModelo3D } from './ai-3d.js';

// ==========================================
// 1. ESTADO GLOBAL Y TARIFARIO (BARINAS)
// ==========================================
let blobImagenActual = null;
let urlModeloGenerado = null;

// Tarifas base por centímetro cuadrado (Ajustadas a costos reales + margen de ganancia)
const TARIFAS_CM2 = {
    'letrero_neon': 0.06, // Ej: 40x20cm (800cm2) = $48.00 USD
    'letrero_pvc':  0.04, // Ej: 40x20cm (800cm2) = $32.00 USD
    'letrero_3d':   0.05, // Ej: 40x20cm (800cm2) = $40.00 USD
    'llavero':      0.10, // Ej: 5x5cm (25cm2) = $2.50 USD
    'figura':       0.15  // Ej: 10x10cm (100cm2) = $15.00 USD
};

// ==========================================
// 2. COTIZADOR PARAMÉTRICO INTELIGENTE
// ==========================================
function calcularPresupuesto() {
    const ancho = parseFloat(document.getElementById('dim-ancho').value) || 0;
    const alto = parseFloat(document.getElementById('dim-alto').value) || 0;
    const tipo = document.getElementById('tipo-producto').value;
    
    // Cálculo de área y precio total
    const areaCm2 = ancho * alto;
    const tarifa = TARIFAS_CM2[tipo] || 0;
    const totalUsd = (areaCm2 * tarifa).toFixed(2);
    const anticipoUsd = (totalUsd / 2).toFixed(2);

    // Actualizar UI
    document.getElementById('precio-total').textContent = `$${totalUsd} USD`;
    document.getElementById('precio-anticipo').textContent = `$${anticipoUsd} USD`;
    
    return totalUsd;
}

// ==========================================
// 3. ESTUDIO CREATIVO (IA: TEXTO -> 2D -> 3D)
// ==========================================

// A. Subir logo propio (Manual)
document.getElementById('input-imagen-cliente')?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        blobImagenActual = e.target.files[0];
        mostrarPreview2D(URL.createObjectURL(blobImagenActual));
    }
});

// B. Generar Boceto 2D con IA (FLUX.1)
document.getElementById('btn-generar-2d')?.addEventListener('click', async () => {
    const prompt = document.getElementById('prompt-ia').value.trim();
    if (!prompt) return alert('Describe el diseño que imaginas para tu pieza.');

    const btn = document.getElementById('btn-generar-2d');
    const status = document.getElementById('status-ia');
    
    btn.disabled = true;
    try {
        blobImagenActual = await generarImagen2D(prompt, (msg) => { status.textContent = '⏳ ' + msg; });
        mostrarPreview2D(URL.createObjectURL(blobImagenActual));
        status.textContent = '✅ Boceto listo. Puedes ajustarlo o convertirlo a 3D.';
    } catch (err) {
        status.textContent = '❌ ' + err.message;
    } finally {
        btn.disabled = false;
    }
});

// C. Extruir a 3D (Hunyuan3D-2.1)
document.getElementById('btn-generar-3d')?.addEventListener('click', async () => {
    if (!blobImagenActual) return alert('Primero sube un logo o genera un boceto 2D.');
    
    const tipo = document.getElementById('tipo-producto').value;
    const btn = document.getElementById('btn-generar-3d');
    const status = document.getElementById('status-ia');
    
    btn.disabled = true;
    alternarVisores('3d');

    try {
        const resultado = await generarModelo3D(blobImagenActual, tipo, (msg) => { status.textContent = '⏳ ' + msg; });
        urlModeloGenerado = resultado.url;
        document.getElementById('visor-3d').src = resultado.url;
        status.textContent = `✅ Modelo 3D generado con éxito.`;
    } catch (err) {
        status.textContent = '❌ ' + err.message;
        alternarVisores('2d');
    } finally {
        btn.disabled = false;
    }
});

// ==========================================
// 4. BASE DE DATOS (SUPABASE)
// ==========================================

// Enviar Orden al Taller
document.getElementById('btn-enviar-orden')?.addEventListener('click', async () => {
    const nombre = document.getElementById('cliente-nombre').value.trim();
    if (!nombre) return alert('Por favor, indícanos tu nombre.');
    
    const btn = document.getElementById('btn-enviar-orden');
    btn.disabled = true;
    btn.textContent = 'Enviando...'; // Aquí luego conectaremos tu animación del camión CSS

    const total = calcularPresupuesto();
    
    try {
        // 1. Guardar o buscar cliente
        const { data: cliente, error: errCliente } = await supabase
            .from('clientes')
            .insert([{ 
                nombre, 
                telefono: document.getElementById('cliente-telefono').value, 
                es_invitado: true 
            }])
            .select().single();

        if (errCliente) throw errCliente;

        // 2. Crear Orden de Trabajo
        const { data: orden, error: errOrden } = await supabase
            .from('ordenes_trabajo')
            .insert([{
                id_cliente: cliente.id_cliente,
                tipo_producto: document.getElementById('tipo-producto').value,
                parametros_ia: document.getElementById('parametros-extra').value,
                url_modelo_glb: urlModeloGenerado,
                precio_total_usd: total,
                estado: 'Presupuestada'
            }])
            .select().single();

        if (errOrden) throw errOrden;

        alert(`✅ ¡Solicitud #${orden.id_orden} enviada a taller!\nAnticipo requerido: $${(total/2).toFixed(2)} USD`);
    } catch (error) {
        alert('❌ Error al enviar la orden: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Enviar Solicitud a Taller';
    }
});

// ==========================================
// 5. UTILIDADES DE INTERFAZ
// ==========================================
function mostrarPreview2D(url) {
    document.getElementById('placeholder-2d').style.display = 'none';
    const img = document.getElementById('preview-2d');
    img.src = url;
    img.style.display = 'block';
    document.getElementById('btn-generar-3d').style.display = 'block';
    alternarVisores('2d');
}

function alternarVisores(modo) {
    document.getElementById('caja-2d').style.display = modo === '2d' ? 'flex' : 'none';
    document.getElementById('caja-3d').style.display = modo === '3d' ? 'flex' : 'none';
}

// Inicializar listeners dinámicos
['dim-ancho', 'dim-alto', 'tipo-producto'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcularPresupuesto);
});

// Llamada inicial
calcularPresupuesto();
