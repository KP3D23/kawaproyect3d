import { supabase } from './supa.js';
import { generarImagen2D, generarModelo3D } from './ai-3d.js';

// ==========================================
// 1. DICCIONARIO DE INYECCIÓN DE PROMPTS (CALIBRADO CON TUS FOTOS)
// ==========================================
const CONTEXTOS_TALLER = {
    'letrero_pvc': "Professional 3D render of a flat PVC/Acrylic wall sign. Clean vector-style cutouts, layered acrylic plastic materials, matte finish base with glossy printed vinyl details. Backlit illumination creating a soft glowing halo effect against the wall, metal standoff wall mounts visible. Studio lighting, flat lay photography. ",
    
    'figura': "Professional 3D render of a custom 3D printed sign. Features a solid flat base plate with raised, colorful, bubble-like 3D letters and a glossy metallic gold layer. Made of glossy and matte engineering plastics. Playful, high contrast, clean vector-style geometry. Studio lighting, flat lay photography. ",
    
    'letrero_3d': "Professional 3D render of thick extruded cursive letters forming a sign. The letters are made of solid, matte PLA plastic (3D printed texture), connected together as a single solid piece. Sharp edges, thick volume projecting a hard shadow on a flat surface. Realistic product photography, studio lighting. ",
    
    'letrero_neon': "Professional 3D render of a Neon Flex LED sign. Solid 3D printed plastic base with routed channels containing glowing neon LED strips inside the letters. High contrast, studio lighting, highly detailed. ",
    
    'llavero': "Professional 3D render of a thick plastic keychain with a metallic key ring at the top. 3D printed style, flat base with raised extruded details and borders, dual-color plastic layers. Clean white background. ",

    'reconocimiento_3d': "Professional 3D render of a custom 3D printed medical or professional recognition trophy. Features a solid rectangular base with engraved text, and a fully three-dimensional, highly detailed, multi-colored anatomical or mechanical object mounted on top. High quality matte and glossy PLA plastic texture, studio lighting. ",
    
    'reconocimiento_2d': "Professional 3D render of a custom 3D printed flat-style recognition award. Features a solid rectangular base with text, supporting a vertical 2D extruded silhouette or logo. Clean vector-style geometry, solid black and white matte plastic material, high contrast, studio lighting. "
};

// ==========================================
// 2. ESTADO GLOBAL Y TARIFARIO
// ==========================================
let blobImagenActual = null;
let urlModeloGenerado = null;

// Tarifas en USD por cm2 (puedes ajustar estos valores según tus costos)
const TARIFAS = {
    'letrero_neon': 0.06, 
    'letrero_pvc':  0.04, 
    'letrero_3d':   0.05, 
    'llavero':      0.10, 
    'figura':       0.15,
    'reconocimiento_3d': 0.20,
    'reconocimiento_2d': 0.12
};

// ==========================================
// 3. CONTROLADOR DE UI Y COTIZADOR
// ==========================================
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

function calcularCotizacion() {
    const anchoInput = document.getElementById('dim-ancho');
    if (!anchoInput) return; // Evitar errores si estamos en la vista del taller

    const ancho = parseFloat(anchoInput.value) || 0;
    const alto = parseFloat(document.getElementById('dim-alto').value) || 0;
    const tipo = document.getElementById('tipo-producto').value;
    
    const area = ancho * alto;
    const tarifa = TARIFAS[tipo] || 0.05;
    const totalUsd = (area * tarifa).toFixed(2);
    
    document.getElementById('precio-total').textContent = `$${totalUsd} USD`;
    document.getElementById('precio-anticipo').textContent = `$${(totalUsd / 2).toFixed(2)} USD`;
    return totalUsd;
}

['dim-ancho', 'dim-alto', 'tipo-producto'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', calcularCotizacion);
});
calcularCotizacion();

function mostrarPreview2D(url) {
    document.getElementById('placeholder-2d').style.display = 'none';
    const img = document.getElementById('preview-2d');
    img.src = url;
    img.style.display = 'block';
    
    // Activar visor 2D y botón para pasar a 3D
    const visor3D = document.getElementById('visor-3d');
    if(visor3D) visor3D.style.display = 'none';
    
    const btn3D = document.getElementById('btn-generar-3d');
    if(btn3D) btn3D.style.display = 'block';
}

// Carga de logo manual
document.getElementById('input-imagen-cliente')?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        blobImagenActual = e.target.files[0];
        mostrarPreview2D(URL.createObjectURL(blobImagenActual));
    }
});

// ==========================================
// 4. FLUJO DE INTELIGENCIA ARTIFICIAL
// ==========================================

// A. Generar 2D con Inyección de Prompt
document.getElementById('btn-generar-2d')?.addEventListener('click', async () => {
    const promptCliente = document.getElementById('prompt-ia').value.trim();
    const tipo = document.getElementById('tipo-producto').value;
    
    if (!promptCliente) return alert('Describe el diseño que imaginas para tu pieza.');

    const btn = document.getElementById('btn-generar-2d');
    const status = document.getElementById('status-ia');
    btn.disabled = true;
    
    try {
        const contextoBase = CONTEXTOS_TALLER[tipo] || "";
        const promptOptimizado = `${contextoBase} The design features the following request: "${promptCliente}". Must be on a clean solid white background, isolated object, centered.`;

        blobImagenActual = await generarImagen2D(promptOptimizado, (msg) => { status.textContent = '⏳ ' + msg; });
        mostrarPreview2D(URL.createObjectURL(blobImagenActual));
        status.textContent = '✅ Boceto listo. Puedes ajustarlo o convertirlo a 3D.';
    } catch (err) {
        status.textContent = '❌ ' + err.message;
    } finally {
        btn.disabled = false;
    }
});

// B. Generar 3D
document.getElementById('btn-generar-3d')?.addEventListener('click', async () => {
    if (!blobImagenActual) return alert('Primero sube un diseño o genera un boceto.');
    
    const tipo = document.getElementById('tipo-producto').value;
    const btn = document.getElementById('btn-generar-3d');
    const status = document.getElementById('status-ia');
    btn.disabled = true;

    document.getElementById('preview-2d').style.display = 'none';
    document.getElementById('visor-3d').style.display = 'block';

    try {
        const resultado = await generarModelo3D(blobImagenActual, tipo, (msg) => { status.textContent = '⏳ ' + msg; });
        urlModeloGenerado = resultado.url;
        document.getElementById('visor-3d').src = resultado.url;
        status.textContent = `✅ Modelo 3D generado con éxito.`;
    } catch (err) {
        status.textContent = '❌ ' + err.message;
        document.getElementById('visor-3d').style.display = 'none';
        document.getElementById('preview-2d').style.display = 'block';
    } finally {
        btn.disabled = false;
    }
});

// ==========================================
// 5. BASE DE DATOS Y TRANSACCIONES (SUPABASE)
// ==========================================
document.getElementById('btn-enviar-orden')?.addEventListener('click', async () => {
    const nombre = document.getElementById('cliente-nombre').value.trim();
    if (!nombre) return alert('Por favor, indica un nombre para el pedido.');
    
    const btn = document.getElementById('btn-enviar-orden');
    btn.classList.add('loading');
    btn.innerHTML = 'Enviando al servidor...';
    
    try {
        const total = calcularCotizacion();
        
        const { data: cliente, error: errC } = await supabase.from('clientes')
            .insert([{ nombre, telefono: document.getElementById('cliente-telefono') ? document.getElementById('cliente-telefono').value : '', es_invitado: true }])
            .select().single();
        if (errC) throw errC;

        const { data: orden, error: errO } = await supabase.from('ordenes_trabajo')
            .insert([{
                id_cliente: cliente.id_cliente,
                tipo_producto: document.getElementById('tipo-producto').value,
                parametros_ia: document.getElementById('parametros-extra') ? document.getElementById('parametros-extra').value : '',
                url_modelo_glb: urlModeloGenerado,
                precio_total_usd: total,
                estado: 'Presupuestada'
            }]).select().single();
        if (errO) throw errO;

        alert(`✅ ¡Orden #${orden.id_orden} registrada exitosamente!\nAnticipo de $${(total/2).toFixed(2)} USD requerido.`);
        document.getElementById('cliente-nombre').value = '';
    } catch (error) {
        console.error(error);
        alert('❌ Fallo al conectar. Verifica que Supabase esté activo y tus llaves sean correctas.');
    } finally {
        btn.classList.remove('loading');
        btn.innerHTML = 'Confirmar Pedido';
    }
});
