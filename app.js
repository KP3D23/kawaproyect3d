import { supabase } from './supa.js';

// Tarifas base (USD por cm2) calibradas a la realidad
const TARIFAS = {
    'letrero_neon': 0.06, 
    'letrero_pvc':  0.04, 
    'letrero_3d':   0.05, 
    'llavero':      0.10, 
    'figura':       0.15  
};

// ==========================================
// LÓGICA DEL PORTAL COMERCIAL (index.html)
// ==========================================
if (document.getElementById('dim-ancho')) {
    
    // 1. Calculadora Paramétrica
    function calcularCotizacion() {
        const ancho = parseFloat(document.getElementById('dim-ancho').value) || 0;
        const alto = parseFloat(document.getElementById('dim-alto').value) || 0;
        const tipo = document.getElementById('tipo-producto').value;
        
        const totalUsd = (ancho * alto * TARIFAS[tipo]).toFixed(2);
        
        document.getElementById('precio-total').textContent = `$${totalUsd} USD`;
        document.getElementById('precio-anticipo').textContent = `$${(totalUsd / 2).toFixed(2)} USD`;
        return totalUsd;
    }

    ['dim-ancho', 'dim-alto', 'tipo-producto'].forEach(id => {
        document.getElementById(id).addEventListener('input', calcularCotizacion);
    });
    calcularCotizacion(); // Inicializar

    // 2. Previsualizador de Imagen (Simulando sin IA por ahora)
    document.getElementById('input-imagen-cliente').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            const url = URL.createObjectURL(e.target.files[0]);
            document.getElementById('placeholder-2d').style.display = 'none';
            const img = document.getElementById('preview-2d');
            img.src = url;
            img.style.display = 'block';
        }
    });

    // 3. Guardar la orden en Supabase
    document.getElementById('btn-enviar-orden').addEventListener('click', async () => {
        const nombre = document.getElementById('cliente-nombre').value.trim();
        if (!nombre) return alert('Por favor, indica un nombre para el pedido.');
        
        const btn = document.getElementById('btn-enviar-orden');
        btn.disabled = true;
        btn.textContent = 'Enviando al servidor...';
        
        try {
            const total = calcularCotizacion();
            
            // A. Guardar Cliente
            const { data: cliente, error: errC } = await supabase.from('clientes')
                .insert([{ nombre, telefono: document.getElementById('cliente-telefono').value, es_invitado: true }])
                .select().single();
            if (errC) throw errC;

            // B. Crear Orden
            const { data: orden, error: errO } = await supabase.from('ordenes_trabajo')
                .insert([{
                    id_cliente: cliente.id_cliente,
                    tipo_producto: document.getElementById('tipo-producto').value,
                    parametros_ia: document.getElementById('parametros-extra').value,
                    precio_total_usd: total,
                    estado: 'Presupuestada'
                }]).select().single();
            if (errO) throw errO;

            alert(`✅ ¡Orden #${orden.id_orden} registrada exitosamente!`);
            document.getElementById('cliente-nombre').value = '';
            
        } catch (error) {
            console.error(error);
            alert('❌ Fallo al conectar. Verifica que Supabase esté activo y tus llaves sean correctas.');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Confirmar Pedido';
        }
    });
}

// ==========================================
// LÓGICA DEL TALLER (taller.html)
// ==========================================
if (document.getElementById('tabla-ordenes-taller')) {
    
    async function cargarOrdenesTaller() {
        const tbody = document.getElementById('tabla-ordenes-taller');
        tbody.innerHTML = '<tr><td colspan="6">Cargando datos desde Supabase...</td></tr>';
        
        const { data, error } = await supabase.from('ordenes_trabajo')
            .select('*, clientes(nombre, telefono)')
            .order('id_orden', { ascending: false });
            
        if (error) {
            tbody.innerHTML = `<tr><td colspan="6" style="color:#f87171;">❌ Error: ${error.message} (Revisa si tu proyecto Supabase está pausado)</td></tr>`;
            return;
        }

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No hay órdenes registradas.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(o => {
            const esPendiente = o.estado === 'Presupuestada';
            const badgeClass = esPendiente ? 'pendiente' : (o.estado === 'Terminada' ? 'terminada' : '');
            
            return `
            <tr>
                <td><strong>#${o.id_orden}</strong></td>
                <td>${o.clientes?.nombre} <br><small style="color:#94a3b8">${o.clientes?.telefono || ''}</small></td>
                <td>${o.tipo_producto.toUpperCase()} <br><small>${o.parametros_ia || 'Sin detalles'}</small></td>
                <td><span class="badge ${badgeClass}">${o.estado}</span></td>
                <td>$${o.precio_total_usd}</td>
                <td>
                    ${esPendiente ? `<button onclick="window.aprobarYCobrar(${o.id_orden})">Aprobar (Pago 50%)</button>` : ''}
                    ${o.estado === 'Aprobada' ? `<button class="btn-cerrar" onclick="window.cerrarProduccion(${o.id_orden})">Registrar Gastos</button>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    // Funciones globales expuestas para los botones de la tabla
    window.aprobarYCobrar = async (idOrden) => {
        const metodo = prompt("Método de abono (Ej: Zelle, Pago Móvil, Efectivo):", "Pago Móvil");
        if (!metodo) return;
        
        await supabase.from('ordenes_trabajo').update({ estado: 'Aprobada' }).eq('id_orden', idOrden);
        cargarOrdenesTaller();
    };

    window.cerrarProduccion = async (idOrden) => {
        const costo = prompt("Ingresa el costo total de los insumos gastados en USD (Ej: 5.50):");
        if (!costo) return;
        
        await supabase.from('gastos_produccion').insert([{
            id_orden: idOrden, gramos_filamento: 0, metros_neon: 0, costo_total_usd: parseFloat(costo)
        }]);
        await supabase.from('ordenes_trabajo').update({ estado: 'Terminada' }).eq('id_orden', idOrden);
        cargarOrdenesTaller();
    };

    cargarOrdenesTaller();
}

// Verificador rápido de conexión (Para saber si la base de datos despertó)
if (document.getElementById('estado-conexion')) {
    supabase.from('clientes').select('id_cliente').limit(1).then(({ error }) => {
        const indicador = document.getElementById('estado-conexion');
        if (error) {
            indicador.textContent = '🔴 Supabase pausado o error de conexión';
            indicador.style.color = '#f87171';
        } else {
            indicador.textContent = '🟢 Conectado a BD';
            indicador.style.color = '#4ade80';
        }
    });
}
