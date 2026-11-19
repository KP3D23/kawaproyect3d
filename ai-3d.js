import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

/**
 * Obtiene tokens de API almacenados de forma segura en Supabase
 */
async function obtenerToken(nombreServicio) {
    const { data: config, error } = await supabase
        .from('configuracion_api')
        .select('token')
        .eq('servicio', nombreServicio)
        .single();

    if (error || !config) {
        throw new Error(`No se pudo obtener la llave de acceso para: ${nombreServicio}`);
    }
    return config.token;
}

/**
 * Petición HTTP blindada: controla timeout (evita cuelgues en pending) y reintenta en 503/429
 */
async function fetchBlindado(url, options, { timeoutMs = 25000, maxReintentos = 2, onReintento = () => {} } = {}) {
    let ultimoError = null;

    for (let intento = 0; intento <= maxReintentos; intento++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const respuesta = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);

            if (respuesta.status === 503 || respuesta.status === 429) {
                if (intento < maxReintentos) {
                    const esperaSeg = (intento + 1) * 3;
                    onReintento(`Servidor ocupado (${respuesta.status}). Reintentando en ${esperaSeg}s (${intento + 1}/${maxReintentos})...`);
                    await new Promise(r => setTimeout(r, esperaSeg * 1000));
                    continue;
                }
                throw new Error(`Servidor de Google temporalmente saturado (${respuesta.status}). Intenta de nuevo en unos segundos.`);
            }

            if (!respuesta.ok) {
                const errData = await respuesta.json().catch(() => ({}));
                throw new Error(errData.error?.message || `Error HTTP ${respuesta.status}`);
            }

            return await respuesta.json();
        } catch (err) {
            clearTimeout(timer);
            ultimoError = err.name === 'AbortError'
                ? new Error('Tiempo de espera agotado conectando con la IA.')
                : err;

            if (intento < maxReintentos && (err.name === 'AbortError' || err.message.includes('Failed to fetch'))) {
                const esperaSeg = (intento + 1) * 2;
                onReintento(`Conexión lenta. Reintentando en ${esperaSeg}s (${intento + 1}/${maxReintentos})...`);
                await new Promise(r => setTimeout(r, esperaSeg * 1000));
                continue;
            }
            break;
        }
    }

    throw ultimoError;
}

/**
 * Convierte un File o Blob a Base64 puro para enviarlo a Gemini
 */
function blobABase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Data = reader.result.split(',')[1];
            resolve({
                mimeType: blob.type || 'image/png',
                data: base64Data
            });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Convierte la respuesta Base64 de Gemini de vuelta a un Blob utilizable por <img> y Hunyuan3D
 */
function base64ABlob(base64, mimeType = 'image/png') {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

/**
 * 1. Pule el prompt con Gemini 3.8 Flash. Si Google devuelve 503/timeout, usa respaldo local inmediato.
 */
export async function optimizarPromptConGemini(promptCliente, tipoProducto, contextoTaller, onProgreso = () => {}) {
    const promptRespaldoLocal = `${contextoTaller} Custom design requested: "${promptCliente}". Isolated single object, centered, slight 3/4 front angle, clean solid pure white background (#FFFFFF), studio product photography, sharp clean edges, no hands, no walls, no clutter.`;

    try {
        onProgreso("Puliendo tu diseño según las técnicas del taller...");
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

        const instrucciones = `
            You are an expert prompt engineer for 3D product mockup generation.
            Combine the workshop manufacturing style with the customer's request into a single, clear, detailed English prompt.
            Keep any exact text the customer wants written on the sign/product in quotes and in its original language (Spanish).
            Always enforce: isolated object, centered, front-facing 3/4 slight angle, clean solid pure white background (#FFFFFF), studio product photography, sharp edges, no hands, no walls, no clutter (ideal for Image-to-3D conversion).
            Return ONLY the final English prompt, with no explanations or markdown.
        `;

        const mensaje = `Product type: ${tipoProducto}. Workshop manufacturing style: ${contextoTaller}. Customer request: "${promptCliente}"`;

        const data = await fetchBlindado(
            url,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: instrucciones }] },
                    contents: [{ parts: [{ text: mensaje }] }]
                })
            },
            {
                timeoutMs: 15000,
                maxReintentos: 1,
                onReintento: onProgreso
            }
        );

        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return texto || promptRespaldoLocal;

    } catch (error) {
        console.warn("Respaldo local activado para prompt:", error.message);
        onProgreso("Usando plantilla directa del taller para acelerar el proceso...");
        return promptRespaldoLocal;
    }
}

/**
 * 2. TEXTO A IMAGEN: Genera un render 2D preparado para 3D usando Gemini Image
 */
export async function generarImagen2D(promptOptimizado, onProgreso = () => {}) {
    try {
        onProgreso("Renderizando boceto 2D con Gemini...");
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

        const data = await fetchBlindado(
            url,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: promptOptimizado }] }],
                    generationConfig: { responseModalities: ["IMAGE"] }
                })
            },
            {
                timeoutMs: 45000,
                maxReintentos: 2,
                onReintento: onProgreso
            }
        );

        const parteImagen = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!parteImagen) {
            throw new Error("Gemini no devolvió una imagen. Intenta describir el diseño de otra forma.");
        }

        return base64ABlob(parteImagen.inlineData.data, parteImagen.inlineData.mimeType);

    } catch (error) {
        console.error("Error en Text-to-Image (Gemini):", error);
        throw new Error("No se pudo generar la imagen 2D: " + error.message);
    }
}

/**
 * 3. IMAGEN A IMAGEN PREPARADA: Adapta el logo/foto del cliente al producto físico sobre fondo blanco
 */
export async function prepararImagenPara3D(archivoBlob, tipoProducto, contextoTaller, promptExtra = "", onProgreso = () => {}) {
    try {
        onProgreso("Adaptando tu logo al formato de taller con Gemini...");
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

        const imagenBase64 = await blobABase64(archivoBlob);

        const instruccionEdicion = `
            Transform the provided logo/image into a realistic physical manufactured product ready for 3D reconstruction.
            Preserve the exact text, shapes, and brand identity from the original image.
            Product type: ${tipoProducto}.
            Manufacturing style: ${contextoTaller}
            ${promptExtra ? `Additional customer instructions: "${promptExtra}".` : ""}
            CRITICAL RULES FOR 3D CONVERSION:
            - Place the finished product completely isolated and centered on a clean, solid pure white background (#FFFFFF).
            - Remove any original background, tables, hands, or clutter.
            - Give it clear physical thickness, clean edges, and studio lighting so a 3D AI model can accurately extrude its geometry.
        `;

        const data = await fetchBlindado(
            url,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-goog-api-key": apiKey
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: instruccionEdicion },
                            { inlineData: { mimeType: imagenBase64.mimeType, data: imagenBase64.data } }
                        ]
                    }],
                    generationConfig: { responseModalities: ["IMAGE"] }
                })
            },
            {
                timeoutMs: 45000,
                maxReintentos: 2,
                onReintento: onProgreso
            }
        );

        const parteImagen = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (!parteImagen) {
            throw new Error("No se pudo preparar la imagen. Intenta con un logo más nítido.");
        }

        return base64ABlob(parteImagen.inlineData.data, parteImagen.inlineData.mimeType);

    } catch (error) {
        console.error("Error en Image-to-Image (Gemini):", error);
        throw new Error("No se pudo adaptar tu imagen: " + error.message);
    }
}

/**
 * 4. IMAGEN PREPARADA A 3D: Genera el modelo .GLB usando Hunyuan3D-2.1
 */
export async function generarModelo3D(archivoBlob, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Conectando con el motor Hunyuan3D-2.1...");
        const hfToken = await obtenerToken('huggingface_trellis');

        const client = await Client.connect("tencent/Hunyuan3D-2.1", { hf_token: hfToken });

        onProgreso("Construyendo malla y relieve 3D...");

        const result = await client.predict("/shape_generation", {
            image: archivoBlob,
            mv_image_front: null,
            mv_image_back: null,
            mv_image_left: null,
            mv_image_right: null,
            steps: 30,
            guidance_scale: 5,
            seed: Math.floor(Math.random() * 100000),
            octree_resolution: 256,
            check_box_rembg: true,
            num_chunks: 8000,
            randomize_seed: true,
        });

        onProgreso("Extrayendo archivo 3D renderizado...");
        const archivo3D = result.data[0];
        return { url: archivo3D.url || archivo3D.path, modo: "IA Nube (Hunyuan3D)" };

    } catch (error) {
        console.error("Error en Hunyuan3D:", error);
        throw new Error("Fallo en la generación 3D. Verifica tu cuota de Hugging Face o intenta de nuevo.");
    }
}
