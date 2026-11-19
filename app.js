import { supabase } from './supa.js';
import {
    optimizarPromptConGemini,
    generarImagen2D,
    prepararImagenPara3D,
    generarModelo3D
} from './ai-3d.js';

// ==========================================
// 1. CONFIGURACIÓN, TARIFAS Y CONTEXTOS IA
// ==========================================
const WHATSAPP_TALLER = "584245040671"; // Número del taller (formato internacional sin +)

let blobImagenSubida = null;
let blobImagenPreparada = null;
let urlModeloGenerado = null;
let usuarioActual = JSON.parse(localStorage.getItem('kawa_user')) || null;

// Tarifas base calibradas con tus precios reales de Barinas
const TARIFAS = {
    'letrero_neon': 0.045,     // Ej: 50x20cm -> ~$45
    'letrero_pvc': 0.015,      // Ej: 60x60cm -> ~$50
    'letrero_3d': 0.04,        // Ej: 50x15cm -> ~$30
    'figura': 0.08,
    'reconocimiento_3d': 25.0, // Precio base por unidad (20cm 100% 3D)
    'reconocimiento_2d': 12.0  // Precio base por unidad (plano 2D)
};

// Reverse-Prompting calibrado con tus fotos reales
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
// 2. CONTROLADOR DE BARRA DE PROGRESO Y LOADER
// ==========================================
let intervaloProgreso = null;
let porcentajeActual = 0;
let segundosTranscurridos = 0;

function iniciarProgreso(estimadoSeg = 15, mensajeInicial = "Iniciando...") {
    detenerIntervalo();
    porcentajeActual = 8;
    segundosTranscurridos = 0;

    const wrap = document.getElementById('barra-progreso-wrap');
    const loader = document.getElementById('visor-loader');
    const status = document.getElementById('status-ia');

    if (wrap) wrap.classList.add('active');
    if (loader) loader.classList.add('active');
    if (status) status.textContent = '⏳ ' + mensajeInicial;

    actualizarUIProgreso(porcentajeActual, estimadoSeg, mensajeInicial);

    intervaloProgreso = setInterval(() => {
        segundosTranscurridos++;
        // Avance asintótico: se acerca a 94% sin llegar a 100% hasta que termine la API
        if (porcentajeActual < 94) {
            const incremento = Math.max(0.6, (94 - porcentajeActual) / (estimadoSeg * 0.7));
            porcentajeActual = Math.min(94, porcentajeActual + incremento);
        }
        actualizarUIProgreso(porcentajeActual, estimadoSeg);
    }, 1000);
}

function setHitoProgreso(porcentajeMinimo, mensaje, estimadoSeg = 15) {
    if (porcentajeMinimo > porcentajeActual) {
        porcentajeActual = porcentajeMinimo;
    }
    const status = document.getElementById('status-ia');
    const loaderTexto = document.getElementById('loader-texto');
    if (status) status.textContent = '⏳ ' + mensaje;
    if (loaderTexto) loaderTexto.textContent = mensaje;
    actualizarUIProgreso(porcentajeActual, estimadoSeg);
}

function finalizarProgreso(exito, mensajeFinal) {
    detenerIntervalo();
    const wrap = document.getElementById('barra-progreso-wrap');
    const fill = document.getElementById('barra-progreso-fill');
    const pct = document.getElementById('progreso-porcentaje');
    const tiempo = document.getElementById('progreso-tiempo');
    const loader = document.getElementById('visor-loader');
    const status = document.getElementById('status-ia');

    if (loader) loader.classList.remove('active');
    if (status) status.textContent = (exito ? '✅ ' : '❌ ') + mensajeFinal;

    if (exito && fill && pct && tiempo) {
        fill.style.width = '100%';
        pct.textContent = '100%';
        tiempo.textContent = `Completado en ${segundosTranscurridos}s`;
        setTimeout(() => { if (wrap) wrap.classList.remove('active'); }, 2500);
    } else if (wrap) {
        wrap.classList.remove('active');
    }
}

function actualizarUIProgreso(pctVal, estimadoSeg, textoLoader = null) {
    const fill = document.getElementById('barra-progreso-fill');
    const pct = document.getElementById('progreso-porcentaje');
    const tiempo = document.getElementById('progreso-tiempo');
    const loaderTexto = document.getElementById('loader-texto');

    const redondeado = Math.round(pctVal);
    if (fill) fill.style.width = `${redondeado}%`;
    if (pct) pct.textContent = `${redondeado}%`;
    if (tiempo) tiempo.textContent = `Tiempo: ${segundosTranscurridos}s / ~${estimadoSeg}s`;
    if (textoLoader && loaderTexto) loaderTexto.textContent = textoLoader;
}

function detenerIntervalo() {
    if (intervaloProgreso) {
        clearInterval(intervaloProgreso);
        intervaloProgreso = null;
    }
}

// ==========================================
// 3. SISTEMA DE AUTENTICACIÓN (CÉDULA + CLAVE)
// ==========================================
if (window.location.pathname.includes('taller.html')) {
    if (!usuarioActual || usuarioActual.rol !== 'admin') {
        window.location.href = 'index.html';
    } else {
        const adminName = document.getElementById('admin-name');
        if (adminName) adminName.textContent = `Admin: ${usuarioActual.nombre}`;
        cargarDashboardTaller();
    }
}

if (document.getElementById('nav-user-area')) {
    if (usuarioActual) {
        document.getElementById('nav-user-area').innerHTML = `
            <span style="color: var(--text-muted); font-size: 0.88rem;">Hola, ${usuarioActual.nombre.split(' ')[0]}</span>
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
    document.getElementById('modal-auth')?.classList.add('active');
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
// 4. COTIZADOR INTELIGENTE Y PESTAÑAS
// ==========================================
window.switchTab = function (tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    if (tabName === 'pedidos') {
        document.querySelectorAll('.tab-btn')[1]?.classList.add('active');
        document.getElementById('tab-pedidos')?.classList.add('active');
    } else {
        document.querySelectorAll('.tab-btn')[0]?.classList.add('active');
        document.getElementById('tab-ai')?.classList.add('active');
    }
};

function calcularCotizacion() {
    const tipoSelect = document.getElementById('tipo-producto');
    if (!tipoSelect) return 0;

    const tipo = tipoSelect.value;
    const ancho = parseFloat(document.getElementById('dim-ancho')?.value) || 0;
    const alto = parseFloat(document.getElementById('dim-alto')?.value) || 0;
    const cantidad = Math.max(1, parseInt(document.getElementById('input-cantidad')?.value) || 1);
    const nota = document.getElementById('nota-precio');
    const camposDim = document.querySelectorAll('.campo-dim');

    let totalUsd = 0;

    if (tipo === 'llavero') {
        camposDim.forEach(el => el.style.display = 'none');
        const precioUnit = cantidad >= 12 ? 2.20 : 3.00;
        totalUsd = precioUnit * cantidad;
        if (nota) {
            nota.textContent = cantidad >= 12
                ? `🎉 Precio por docena aplicado: $2.20 USD c/u (Tamaño estándar 4-5 cm).`
                : `Tamaño estándar 4-5 cm ($3.00 c/u). A partir de 12 unidades baja a $2.20 c/u.`;
        }
    } else if (tipo === 'reconocimiento_3d' || tipo === 'reconocimiento_2d') {
        camposDim.forEach(el => el.style.display = 'none');
        const precioUnit = TARIFAS[tipo];
        totalUsd = precioUnit * cantidad;
        if (nota) {
            nota.textContent = tipo === 'reconocimiento_3d'
                ? `Estándar 20 cm 100% 3D ($25.00 USD c/u).`
                : `Estándar plano 2D con base ($12.00 USD c/u).`;
        }
    } else {
        camposDim.forEach(el => el.style.display = 'block');
        const area = ancho * alto;
        const tarifa = TARIFAS[tipo] || 0.04;
        const unitario = Math.max(15, area * tarifa); // Mínimo operativo $15 para letreros
        totalUsd = unitario * cantidad;
        if (nota) nota.textContent = `Precio aproximado según área (${ancho}x${alto} cm). Se confirma exacto al aprobar diseño.`;
    }

    const totalFmt = totalUsd.toFixed(2);
    document.getElementById('precio-total').textContent = `$${totalFmt} USD`;
    document.getElementById('precio-anticipo').textContent = `$${(totalUsd / 2).toFixed(2)} USD`;
    return totalFmt;
}

['dim-ancho', 'dim-alto', 'input-cantidad', 'tipo-producto'].forEach(id => {
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
// 5. ESTUDIO CREATIVO (GEMINI BLINDADO -> HUNYUAN3D)
// ==========================================
document.getElementById('input-imagen-cliente')?.addEventListener('change', (e) => {
    const status = document.getElementById('status-ia');
    const btnLimpiar = document.getElementById('btn-limpiar-img');
    if (e.target.files && e.target.files[0]) {
        blobImagenSubida = e.target.files[0];
        blobImagenPreparada = blobImagenSubida;
        mostrarPreview2D(URL.createObjectURL(blobImagenSubida));
        if (btnLimpiar) btnLimpiar.style.display = 'inline-block';
        if (status) {
            status.textContent = '📎 Logo cargado. Pulsa "✨ Preparar Diseño 2D" para que Gemini lo adapte al producto.';
        }
    }
});

document.getElementById('btn-limpiar-img')?.addEventListener('click', () => {
    blobImagenSubida = null;
    blobImagenPreparada = null;
    const input = document.getElementById('input-imagen-cliente');
    const img = document.getElementById('preview-2d');
    const placeholder = document.getElementById('placeholder-2d');
    const btnLimpiar = document.getElementById('btn-limpiar-img');
    const btn3D = document.getElementById('btn-generar-3d');
    const status = document.getElementById('status-ia');

    if (input) input.value = '';
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    if (btn3D) btn3D.style.display = 'none';
    if (status) status.textContent = '';
});

document.getElementById('btn-generar-2d')?.addEventListener('click', async () => {
    const promptCliente = document.getElementById('prompt-ia').value.trim();
    const tipo = document.getElementById('tipo-producto').value;
    const contextoBase = CONTEXTOS_TALLER[tipo] || "";
    const btn = document.getElementById('btn-generar-2d');

    if (!blobImagenSubida && !promptCliente) {
        return alert('Describe tu idea en el cuadro de texto o sube tu logo primero.');
    }

    btn.disabled = true;
    iniciarProgreso(18, "Preparando tu solicitud con Kawa IA...");

    try {
        if (blobImagenSubida) {
            setHitoProgreso(35, "Adaptando tu logo al producto físico...", 18);
            blobImagenPreparada = await prepararImagenPara3D(
                blobImagenSubida,
                tipo,
                contextoBase,
                promptCliente,
                (msg) => setHitoProgreso(55, msg, 18)
            );
            mostrarPreview2D(URL.createObjectURL(blobImagenPreparada));
            finalizarProgreso(true, 'Logo adaptado y listo. Ahora puedes pulsar "🧊 Convertir a 3D".');
        } else {
            const promptPulido = await optimizarPromptConGemini(
                promptCliente,
                tipo,
                contextoBase,
                (msg) => setHitoProgreso(28, msg, 18)
            );

            setHitoProgreso(50, "Renderizando boceto 2D en estudio...", 18);
            blobImagenPreparada = await generarImagen2D(
                promptPulido,
                (msg) => setHitoProgreso(68, msg, 18)
            );
            mostrarPreview2D(URL.createObjectURL(blobImagenPreparada));
            finalizarProgreso(true, 'Boceto 2D listo. Si te gusta, pulsa "🧊 Convertir a 3D".');
        }
    } catch (err) {
        finalizarProgreso(false, err.message);
    } finally {
        btn.disabled = false;
    }
});

document.getElementById('btn-generar-3d')?.addEventListener('click', async () => {
    if (!blobImagenPreparada) return alert('Primero prepara un diseño 2D o sube un logo.');

    const tipo = document.getElementById('tipo-producto').value;
    const btn = document.getElementById('btn-generar-3d');
    const img2D = document.getElementById('preview-2d');
    const visor3D = document.getElementById('visor-3d');

    btn.disabled = true;
    iniciarProgreso(45, "Conectando con motor 3D (Hunyuan3D)...");

    try {
        const resultado = await generarModelo3D(
            blobImagenPreparada,
            tipo,
            (msg) => setHitoProgreso(45, msg, 45)
        );
        urlModeloGenerado = resultado.url;
        img2D.style.display = 'none';
        visor3D.style.display = 'block';
        visor3D.src = resultado.url;
        finalizarProgreso(true, 'Modelo 3D listo. Puedes rotarlo y hacer zoom arriba.');
    } catch (err) {
        finalizarProgreso(false, err.message);
    } finally {
        btn.disabled = false;
    }
});

// ==========================================
// 6. GUARDAR BORRADOR / CONFIRMAR PEDIDO
// ==========================================
async function registrarOrden(estadoInicial) {
    if (!usuarioActual) {
        abrirModalAuth();
        return;
    }

    const btnConfirmar = document.getElementById('btn-enviar-orden');
    const btnBorrador = document.getElementById('btn-guardar-borrador');
    if (btnConfirmar) btnConfirmar.disabled = true;
    if (btnBorrador) btnBorrador.disabled = true;

    try {
        const total = calcularCotizacion();
        const tipo = document.getElementById('tipo-producto').value;
        const cantidad = document.getElementById('input-cantidad')?.value || 1;
        const ancho = document.getElementById('dim-ancho')?.value || '-';
        const alto = document.getElementById('dim-alto')?.value || '-';
        const notasCliente = document.getElementById('parametros-extra')?.value.trim() || '';
        const resumenTecnico = `Cant: ${cantidad} | Medidas: ${ancho}x${alto}cm | ${notasCliente}`;

        const { data: orden, error } = await supabase.from('ordenes_trabajo')
            .insert([{
                id_cliente: usuarioActual.id_cliente,
                tipo_producto: tipo,
                parametros_ia: resumenTecnico,
                url_modelo_glb: urlModeloGenerado,
                precio_total_usd: total,
                estado: estadoInicial
            }]).select().single();

        if (error) throw error;

        const msg = estadoInicial === 'Borrador'
            ? `💾 Cotización #${orden.id_orden} guardada en "Mis Pedidos" para cuando decidas concretarla.`
            : `✅ ¡Pedido #${orden.id_orden} confirmado!\nAnticipo (50%): $${(total / 2).toFixed(2)} USD.`;

        alert(msg);
        await cargarMisPedidos();
        switchTab('pedidos');
    } catch (error) {
        alert('❌ Error al guardar: ' + error.message);
    } finally {
        if (btnConfirmar) btnConfirmar.disabled = false;
        if (btnBorrador) btnBorrador.disabled = false;
    }
}

document.getElementById('btn-enviar-orden')?.addEventListener('click', () => registrarOrden('Presupuestada'));
document.getElementById('btn-guardar-borrador')?.addEventListener('click', () => registrarOrden('Borrador'));

async function cargarMisPedidos() {
    const contenedor = document.getElementById('lista-mis-pedidos');
    if (!contenedor || !usuarioActual) return;

    const { data, error } = await supabase.from('ordenes_trabajo')
        .select('*').eq('id_cliente', usuarioActual.id_cliente).order('id_orden', { ascending: false });

    if (error || !data || data.length === 0) {
        contenedor.innerHTML = '<p style="color:var(--text-muted); text-align:center; margin-top: 30px;">No tienes pedidos ni cotizaciones guardadas aún.</p>';
        return;
    }

    contenedor.innerHTML = data.map(o => {
        const esBorrador = o.estado === 'Borrador';
        const textoWa = encodeURIComponent(
            `Hola KawaProyects3D, soy ${usuarioActual.nombre}. Quiero coordinar mi Orden #${o.id_orden} (${o.tipo_producto}) por $${o.precio_total_usd} USD. Detalles: ${o.parametros_ia || 'N/A'}`
        );
        return `
            <div class="pedido-item">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <strong>Orden #${o.id_orden}</strong>
                    <span class="badge ${esBorrador ? 'badge-borrador' : ''}">${o.estado}</span>
                </div>
                <div style="font-size: 0.84rem; color: var(--text-muted); line-height: 1.5;">
                    Producto: <strong style="color:#fff;">${o.tipo_producto.replace('_', ' ').toUpperCase()}</strong><br>
                    ${o.parametros_ia ? `Detalle: ${o.parametros_ia}<br>` : ''}
                    Total: <strong style="color:var(--accent-glow);">$${o.precio_total_usd} USD</strong> (Anticipo: $${(o.precio_total_usd / 2).toFixed(2)})
                </div>
                <a class="btn-wa" href="https://wa.me/${WHATSAPP_TALLER}?text=${textoWa}" target="_blank">💬 Enviar por WhatsApp</a>
            </div>
        `;
    }).join('');
}

// ==========================================
// 7. DASHBOARD DE TALLER (Admin)
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
