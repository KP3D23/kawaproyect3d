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
 * Petición JSON blindada para Gemini (controla timeout y reintenta en 503/429)
 */
async function fetchJsonBlindado(url, options, { timeoutMs = 18000, maxReintentos = 1, onReintento = () => {} } = {}) {
    let ultimoError = null;

    for (let intento = 0; intento <= maxReintentos; intento++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const respuesta = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timer);

            if (respuesta.status === 503 || respuesta.status === 429) {
                if (intento < maxReintentos) {
                    onReintento(`Servidor ocupado (${respuesta.status}). Reintentando...`);
                    await new Promise(r => setTimeout(r, 2500));
                    continue;
                }
                throw new Error(`Servidor ocupado (${respuesta.status}).`);
            }

            if (!respuesta.ok) {
                const errData = await respuesta.json().catch(() => ({}));
                throw new Error(errData.error?.message || `Error HTTP ${respuesta.status}`);
            }

            return await respuesta.json();
        } catch (err) {
            clearTimeout(timer);
            ultimoError = err.name === 'AbortError'
                ? new Error('Tiempo de espera agotado.')
                : err;
            if (intento < maxReintentos) {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            break;
        }
    }

    throw ultimoError;
}

/**
 * Convierte un File o Blob a Base64 puro para que Gemini Vision pueda analizar el logo del cliente
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
 * 1. Pule y traduce el prompt del cliente usando Gemini 3.8 Flash (Texto gratuito).
 * Si Google está saturado (503), activa respaldo local inmediato sin bloquear al usuario.
 */
export async function optimizarPromptConGemini(promptCliente, tipoProducto, contextoTaller, onProgreso = () => {}) {
    const promptRespaldoLocal = `${contextoTaller} Custom design: "${promptCliente}". Isolated single object, centered, pure white background, studio product photography, sharp edges.`;

    try {
        onProgreso("Gemini está puliendo tu idea según las técnicas del taller...");
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

        const instrucciones = `
            You are an expert prompt engineer for FLUX 3D product mockups.
            Combine the workshop manufacturing style with the customer's request into ONE concise English prompt (maximum 55 words).
            Keep any exact text the customer wants written on the sign in quotes and in Spanish.
            Always include: isolated single object, centered, pure solid white background, studio product photo, sharp clean edges, no hands, no walls.
            Return ONLY the final prompt, no explanations or markdown.
        `;

        const mensaje = `Product type: ${tipoProducto}. Workshop style: ${contextoTaller}. Customer request: "${promptCliente}"`;

        const data = await fetchJsonBlindado(
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
                timeoutMs: 14000,
                maxReintentos: 1,
                onReintento: onProgreso
            }
        );

        const texto = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return texto || promptRespaldoLocal;

    } catch (error) {
        console.warn("Respaldo local activado para prompt:", error.message);
        onProgreso("Usando plantilla directa del taller...");
        return promptRespaldoLocal;
    }
}

/**
 * 2. TEXTO A IMAGEN: Genera el boceto 2D usando Pollinations.ai (Motor FLUX gratuito y sin API Key)
 */
export async function generarImagen2D(promptOptimizado, onProgreso = () => {}) {
    // Limita la longitud del prompt para evitar errores de URL demasiado larga
    const promptSeguro = promptOptimizado.replace(/\s+/g, ' ').trim().slice(0, 600);
    const seed = Math.floor(Math.random() * 1000000);
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(promptSeguro)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;

    let ultimoError = null;

    for (let intento = 0; intento <= 1; intento++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);

        try {
            onProgreso(intento === 0
                ? "Renderizando boceto 2D en estudio (FLUX)..."
                : "Reintentando renderizado 2D..."
            );

            const respuesta = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);

            if (!respuesta.ok) {
                throw new Error(`Error del generador de imágenes (${respuesta.status}).`);
            }

            const blob = await respuesta.blob();
            if (!blob || blob.size < 1000) {
                throw new Error("La imagen recibida está vacía o incompleta.");
            }

            return blob;
        } catch (err) {
            clearTimeout(timer);
            ultimoError = err.name === 'AbortError'
                ? new Error("El generador tardó demasiado en responder. Intenta de nuevo.")
                : err;
            if (intento < 1) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }

    console.error("Error en Text-to-Image (Pollinations):", ultimoError);
    throw new Error("No se pudo generar la imagen 2D: " + ultimoError.message);
}

/**
 * 3. IMAGEN A IMAGEN PREPARADA:
 * Gemini Vision (gratuito) analiza el logo subido por el cliente y genera un prompt exacto
 * para que Pollinations (FLUX) lo renderice como producto físico sobre fondo blanco.
 */
export async function prepararImagenPara3D(archivoBlob, tipoProducto, contextoTaller, promptExtra = "", onProgreso = () => {}) {
    try {
        onProgreso("Analizando tu logo con Gemini Vision...");
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent";

        const imagenBase64 = await blobABase64(archivoBlob);

        const instruccionVision = `
            Look closely at the provided logo/image. Describe its exact text, main icon/shapes, and colors, and combine it with this physical manufacturing style into ONE concise English image prompt (max 60 words) for FLUX:
            Product type: ${tipoProducto}.
            Manufacturing style: ${contextoTaller}.
            ${promptExtra ? `Extra customer request: "${promptExtra}".` : ""}
            Always enforce: isolated single physical product, centered, pure solid white background, studio product photography, sharp edges, clear 3D depth.
            Return ONLY the final English prompt.
        `;

        const data = await fetchJsonBlindado(
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
                            { text: instruccionVision },
                            { inlineData: { mimeType: imagenBase64.mimeType, data: imagenBase64.data } }
                        ]
                    }]
                })
            },
            {
                timeoutMs: 18000,
                maxReintentos: 1,
                onReintento: onProgreso
            }
        );

        const promptAdaptado = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (!promptAdaptado) {
            throw new Error("No se pudo describir el logo.");
        }

        return await generarImagen2D(promptAdaptado, onProgreso);

    } catch (error) {
        console.warn("Usando logo original directamente para 3D:", error.message);
        onProgreso("Logo listo. Puedes pasar directo a Convertir a 3D.");
        return archivoBlob;
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
