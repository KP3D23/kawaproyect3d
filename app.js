import { supabase } from './supa.js';
import {
    optimizarPromptConGemini,
    generarImagen2D,
    prepararImagenPara3D,
    generarModelo3D
} from './ai-3d.js';

// ==========================================
// 1. ESTADO GLOBAL, TARIFAS Y CONTEXTOS IA
// ==========================================
let blobImagenSubida = null;     // Imagen cruda que sube el cliente (opcional)
let blobImagenPreparada = null;  // Imagen ya lista/preparada que irá a Hunyuan3D
let urlModeloGenerado = null;
let usuarioActual = JSON.parse(localStorage.getItem('kawa_user')) || null;

const TARIFAS = {
    'letrero_neon': 0.06,
    'letrero_pvc': 0.04,
    'letrero_3d': 0.05,
    'llavero': 0.10,
    'figura': 0.15,
    'reconocimiento_3d': 0.20,
    'reconocimiento_2d': 0.12
};

// Calibrado con tus fotos reales de KawaProyects3D
const CONTEXTOS_TALLER = {
    'letrero_neon': "Realistic 3D product render of a custom Neon Flex LED sign mounted on a 3D-printed white PLA plastic channel base (NOT a solid clear acrylic sheet). Visible thin 3D-printed plastic borders, routed channels holding the glowing silicone neon LED tubes, and small structural connector bars joining the letters at the bottom. High contrast, studio lighting.",
    'letrero_pvc': "Realistic 3D product render of a circular or custom-cut flat PVC/Acrylic wall sign with crisp printed adhesive vinyl graphics on a matte surface, featuring soft indirect backlit LED halo glow around the outer rim.",
    'letrero_3d': "Realistic 3D product render of thick extruded cursive 3D letters made of solid matte PLA plastic (3D printed texture), joined together as a solid piece with sharp edges and visible 2-3cm depth.",
    'llavero': "Realistic 3D product render of a custom 3D printed flat plastic keychain (4-5cm style) with a clean white base plate, raised colorful extruded 3D lettering/icon details, and a small metallic key ring attached at the top hole.",
    'figura': "Realistic 3D product render of a custom 3D printed multi-color sign or figure with a solid flat base plate, raised glossy and matte PLA plastic volumetric elements, clean geometric edges.",
    'reconocimiento_3d': "Realistic 3D product render of a custom 3D printed professional recognition trophy with a solid black rectangular base featuring crisp white engraved text, supporting a detailed multi-color fully 3D printed sculpture on top.",
    'reconocimiento_2d': "Realistic 3D product render of a custom 3D printed flat-style recognition award with a solid white rectangular base featuring black text, supporting a vertical 2D extruded black PLA silhouette or logo on top."
};

// ==========================================
// 2. SISTEMA DE AUTENTICACIÓN (CÉDULA + CLAVE)
// ==========================================
if (window.location.pathname.includes('taller.html')) {
    if (!usuarioActual || usuarioActual.rol !== 'admin') {
        window.location.href = 'index.html';
    } else {
        document.getElementById('admin-name').textContent = `Admin: ${usuarioActual.nombre}`;
        cargarDashboardTaller();
    }
}

if (document.getElementById('nav-user-area')) {
    if (usuarioActual) {
        document.getElementById('nav-user-area').innerHTML = `
            <span style="color: var(--text-muted); font-size: 0.9rem;">Hola, ${usuarioActual.nombre.split(' ')[0]}</span>
            <button class="btn-outline" onclick="cerrarSesion()">Salir</button>
        `;
        cargarMisPedidos();
    }
}

window.cerrarSesion = function () {
    localStorage.removeItem('kawa_user');
    window.location.reload();
};

let modoAuth = 'login';
window.abrirModalAuth = function () {
    document.getElementById('modal-auth').classList.add('active');
};

document.getElementById('modal-auth')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-auth') document.getElementById('modal-auth').classList.remove('active');
});

document.getElementById('auth-toggle-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    modoAuth = modoAuth === 'login' ? 'register' : 'login';
    document.getElementById('modal-title').textContent = modoAuth === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta';
    document.getElementById('btn-auth-action').textContent = modoAuth === 'login' ? 'Entrar' : 'Registrarse';
    document.getElementById('auth-toggle-text').textContent = modoAuth === 'login' ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?';
    document.getElementById('auth-toggle-link').textContent = modoAuth === 'login' ? 'Regístrate' : 'Inicia Sesión';
    document.getElementById('form-register-fields').style.display = modoAuth === 'login' ? 'none' : 'block';
});

document.getElementById('btn-auth-action')?.addEventListener('click', async () => {
    const cedula = document.getElementById('auth-cedula').value.trim();
    const clave = document.getElementById('auth-clave').value.trim();
    if (!cedula || !clave) return alert('Ingresa cédula y clave.');

    const btn = document.getElementById('btn-auth-action');
    btn.textContent = 'Procesando...';
    btn.disabled = true;

    try {
        if (modoAuth === 'login') {
            const { data, error } = await supabase.from('clientes')
                .select('*').eq('cedula', cedula).eq('clave', clave).single();
            if (error || !data) throw new Error('Cédula o clave incorrecta.');
            iniciarSesionLocal(data);
        } else {
            const nombre = document.getElementById('auth-nombre').value.trim();
            const telefono = document.getElementById('auth-telefono').value.trim();
            if (!nombre) throw new Error('El nombre es obligatorio.');

            const { data, error } = await supabase.from('clientes')
                .insert([{ nombre, telefono, cedula, clave, rol: 'cliente' }])
                .select().single();
            if (error) throw new Error('La cédula ya está registrada o hubo un error.');
            iniciarSesionLocal(data);
        }
    } catch (err) {
        alert('❌ ' + err.message);
        btn.textContent = modoAuth === 'login' ? 'Entrar' : 'Registrarse';
        btn.disabled = false;
    }
});

function iniciarSesionLocal(data) {
    localStorage.setItem('kawa_user', JSON.stringify(data));
    if (data.rol === 'admin') {
        window.location.href = 'taller.html';
    } else {
        window.location.reload();
    }
}

// ==========================================
// 3. COTIZADOR Y PESTAÑAS (Index)
// ==========================================
window.switchTab = function (tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tabName === 'pedidos') {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tab-pedidos').classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tab-ai').classList.add('active');
    }
};

function calcularCotizacion() {
    const anchoInput = document.getElementById('dim-ancho');
    if (!anchoInput) return;

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
    const placeholder = document.getElementById('placeholder-2d');
    const img = document.getElementById('preview-2d');
    const visor3D = document.getElementById('visor-3d');
    const btn3D = document.getElementById('btn-generar-3d');

    if (placeholder) placeholder.style.display = 'none';
    if (visor3D) visor3D.style.display = 'none';
    if (img) {
        img.src = url;
        img.style.display = 'block';
    }
    if (btn3D) btn3D.style.display = 'block';
}

// ==========================================
// 4. ESTUDIO CREATIVO (GEMINI -> HUNYUAN3D)
// ==========================================

// A. El cliente sube un logo o imagen propia
document.getElementById('input-imagen-cliente')?.addEventListener('change', (e) => {
    const status = document.getElementById('status-ia');
    if (e.target.files && e.target.files[0]) {
        blobImagenSubida = e.target.files[0];
        blobImagenPreparada = blobImagenSubida; // Respaldo si decide pasar directo a 3D
        mostrarPreview2D(URL.createObjectURL(blobImagenSubida));
        if (status) {
            status.textContent = '📎 Logo cargado. Pulsa "✨ Preparar Diseño 2D" para que Gemini lo adapte al producto elegido antes de pasarlo a 3D.';
        }
    }
});

// B. Botón principal de Gemini (Funciona tanto para Texto->2D como para Imagen->Imagen preparada)
document.getElementById('btn-generar-2d')?.addEventListener('click', async () => {
    const promptCliente = document.getElementById('prompt-ia').value.trim();
    const tipo = document.getElementById('tipo-producto').value;
    const contextoBase = CONTEXTOS_TALLER[tipo] || "";
    const btn = document.getElementById('btn-generar-2d');
    const status = document.getElementById('status-ia');

    if (!blobImagenSubida && !promptCliente) {
        return alert('Describe tu idea en el cuadro de texto o sube tu logo primero.');
    }

    btn.disabled = true;

    try {
        if (blobImagenSubida) {
            // MODO IMAGEN -> IMAGEN PREPARADA (Gemini adapta el logo al producto)
            blobImagenPreparada = await prepararImagenPara3D(
                blobImagenSubida,
                tipo,
                contextoBase,
                promptCliente,
                (msg) => { status.textContent = '⏳ ' + msg; }
            );
            mostrarPreview2D(URL.createObjectURL(blobImagenPreparada));
            status.textContent = '✅ Logo adaptado y listo para 3D. Ahora pulsa "Convertir a Modelo 3D".';
        } else {
            // MODO TEXTO -> PROMPT PULIDO -> IMAGEN PREPARADA (Gemini)
            status.textContent = '⏳ Gemini está puliendo tu diseño según las técnicas del taller...';
            const promptPulido = await optimizarPromptConGemini(promptCliente, tipo, contextoBase);

            blobImagenPreparada = await generarImagen2D(
                promptPulido,
                (msg) => { status.textContent = '⏳ ' + msg; }
            );
            mostrarPreview2D(URL.createObjectURL(blobImagenPreparada));
            status.textContent = '✅ Boceto 2D preparado. Si te gusta, conviértelo a Modelo 3D.';
        }
    } catch (err) {
        status.textContent = '❌ ' + err.message;
    } finally {
        btn.disabled = false;
    }
});

// C. Botón de conversión a 3D (Hunyuan3D-2.1)
document.getElementById('btn-generar-3d')?.addEventListener('click', async () => {
    if (!blobImagenPreparada) return alert('Primero prepara un diseño 2D o sube un logo.');

    const tipo = document.getElementById('tipo-producto').value;
    const btn = document.getElementById('btn-generar-3d');
    const status = document.getElementById('status-ia');
    const img2D = document.getElementById('preview-2d');
    const visor3D = document.getElementById('visor-3d');

    btn.disabled = true;
    img2D.style.display = 'none';
    visor3D.style.display = 'block';

    try {
        const resultado = await generarModelo3D(
            blobImagenPreparada,
            tipo,
            (msg) => { status.textContent = '⏳ ' + msg; }
        );
        urlModeloGenerado = resultado.url;
        visor3D.src = resultado.url;
        status.textContent = '✅ Modelo 3D generado con éxito. Puedes rotarlo y acercarlo arriba.';
    } catch (err) {
        status.textContent = '❌ ' + err.message;
        visor3D.style.display = 'none';
        img2D.style.display = 'block';
    } finally {
        btn.disabled = false;
    }
});

// ==========================================
// 5. CREAR PEDIDO Y MIS PEDIDOS (Supabase)
// ==========================================
document.getElementById('btn-enviar-orden')?.addEventListener('click', async () => {
    if (!usuarioActual) {
        abrirModalAuth();
        return;
    }

    const btn = document.getElementById('btn-enviar-orden');
    btn.disabled = true;
    btn.textContent = 'Guardando Pedido...';

    try {
        const total = calcularCotizacion();
        const { data: orden, error } = await supabase.from('ordenes_trabajo')
            .insert([{
                id_cliente: usuarioActual.id_cliente,
                tipo_producto: document.getElementById('tipo-producto').value,
                parametros_ia: document.getElementById('parametros-extra').value,
                url_modelo_glb: urlModeloGenerado,
                precio_total_usd: total,
                estado: 'Presupuestada'
            }]).select().single();

        if (error) throw error;

        alert(`✅ Pedido #${orden.id_orden} guardado.\nPuedes verlo en la pestaña "Mis Pedidos".`);
        cargarMisPedidos();
        switchTab('pedidos');
    } catch (error) {
        alert('❌ Error al guardar: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Confirmar Pedido';
    }
});

async function cargarMisPedidos() {
    const contenedor = document.getElementById('lista-mis-pedidos');
    if (!contenedor || !usuarioActual) return;

    const { data, error } = await supabase.from('ordenes_trabajo')
        .select('*').eq('id_cliente', usuarioActual.id_cliente).order('id_orden', { ascending: false });

    if (error || !data || data.length === 0) {
        contenedor.innerHTML = '<p style="color:var(--text-muted); text-align:center;">No tienes pedidos registrados aún.</p>';
        return;
    }

    contenedor.innerHTML = data.map(o => `
        <div class="pedido-item">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <strong>Orden #${o.id_orden}</strong>
                <span class="badge">${o.estado}</span>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">
                Producto: ${o.tipo_producto.toUpperCase()}<br>
                Total: $${o.precio_total_usd} USD
            </div>
        </div>
    `).join('');
}

// ==========================================
// 6. DASHBOARD DE TALLER (Admin)
// ==========================================
async function cargarDashboardTaller() {
    const { data: ordenes } = await supabase.from('ordenes_trabajo')
        .select('*, clientes(nombre, telefono)')
        .order('id_orden', { ascending: false });

    const tabla = document.getElementById('tabla-ordenes-taller');
    if (ordenes && tabla) {
        tabla.innerHTML = ordenes.map(o => `
            <tr>
                <td><strong>#${o.id_orden}</strong></td>
                <td>${o.clientes?.nombre || 'N/A'}<br><span style="font-size:0.8rem;color:var(--text-muted)">${o.clientes?.telefono || ''}</span></td>
                <td>${o.tipo_producto}<br><span style="font-size:0.8rem;color:var(--text-muted)">${o.parametros_ia || ''}</span></td>
                <td><span class="badge">${o.estado}</span></td>
                <td>$${o.precio_total_usd}</td>
            </tr>
        `).join('');
    }

    const maquinas = document.getElementById('lista-maquinas');
    if (maquinas) maquinas.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid var(--glass-border); padding-bottom:5px;">
            <span>Sidewinder X2</span> <span style="color:#10b981;">Libre</span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; border-bottom:1px solid var(--glass-border); padding-bottom:5px;">
            <span>Anycubic i3 Mega</span> <span style="color:#10b981;">Libre</span>
        </div>
        <div style="display:flex; justify-content:space-between;">
            <span>Ender 3 V2</span> <span style="color:var(--accent-glow);">Ocupada</span>
        </div>
    `;

    const filamento = document.getElementById('lista-filamento');
    if (filamento) filamento.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>PLA Blanco</span> <span>1.8 kg</span></div>
        <div style="display:flex; justify-content:space-between; margin-bottom:8px;"><span>PLA Negro</span> <span>1.2 kg</span></div>
        <div style="display:flex; justify-content:space-between;"><span>PETG Transparente</span> <span style="color:#ef4444;">0.3 kg (Bajo)</span></div>
    `;

    const neones = document.getElementById('lista-neones');
    if (neones) neones.innerHTML = `
        <div class="neon-item"><span>🔵 Azul Hielo</span> <span>15.5 Mts</span></div>
        <div class="neon-item"><span>🔴 Rojo Carmesí</span> <span>8.0 Mts</span></div>
        <div class="neon-item"><span>⚪ Blanco Frío</span> <span>25.0 Mts</span></div>
        <div class="neon-item"><span>🟣 Fucsia Brillante</span> <span style="color:#ef4444;">2.0 Mts (Poco)</span></div>
        <div class="neon-item"><span>🟢 Verde Salvia Kawa</span> <span>12.4 Mts</span></div>
    `;
}
