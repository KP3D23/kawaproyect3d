import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const SITE_URL = "https://kp3d23.github.io/kawaproyect3d/";
const SITE_NAME = "KawaProyects3D";

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
 * Petición blindada a OpenRouter (timeout + reintentos en 503/429)
 */
async function fetchOpenRouter(payload, { timeoutMs = 45000, maxReintentos = 1, onReintento = () => {} } = {}) {
    const apiKey = await obtenerToken('openrouter_api');
    let ultimoError = null;

    for (let intento = 0; intento <= maxReintentos; intento++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const respuesta = await fetch(OPENROUTER_URL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": SITE_URL,
                    "X-Title": SITE_NAME,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timer);

            if (respuesta.status === 503 || respuesta.status === 429) {
                if (intento < maxReintentos) {
                    onReintento(`Servidor ocupado (${respuesta.status}). Reintentando...`);
                    await new Promise(r => setTimeout(r, 2500));
                    continue;
                }
                throw new Error(`OpenRouter temporalmente ocupado (${respuesta.status}).`);
            }

            if (!respuesta.ok) {
                const errData = await respuesta.json().catch(() => ({}));
                throw new Error(errData.error?.message || `Error HTTP ${respuesta.status}`);
            }

            return await respuesta.json();
        } catch (err) {
            clearTimeout(timer);
            ultimoError = err.name === 'AbortError'
                ? new Error("Tiempo de espera agotado conectando con OpenRouter.")
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
 * Convierte File/Blob a Data URL (data:image/png;base64,...)
 */
function blobADataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Convierte un Data URL (data:image/...;base64,...) o URL remota en Blob
 */
async function extraerBlobDeRespuestaOpenRouter(data) {
    const mensaje = data.choices?.[0]?.message;
    if (!mensaje) throw new Error("Respuesta vacía del modelo.");

    // Formato estándar de OpenRouter para modelos con salida de imagen (Gemini Image)
    const imgUrl =
        mensaje.images?.[0]?.image_url?.url ||
        mensaje.images?.[0]?.url ||
        (Array.isArray(mensaje.content)
            ? mensaje.content.find(c => c.type === 'image_url')?.image_url?.url
            : null);

    if (!imgUrl) {
        console.error("Respuesta de OpenRouter sin imagen:", data);
        throw new Error("El modelo no devolvió una imagen. Intenta describir el diseño con más detalle.");
    }

    const res = await fetch(imgUrl);
    return await res.blob();
}

/**
 * 1. Pule y traduce el prompt del cliente usando Gemini 2.5 Flash vía OpenRouter
 */
export async function optimizarPromptConGemini(promptCliente, tipoProducto, contextoTaller, onProgreso = () => {}) {
    const promptRespaldoLocal = `Custom ${tipoProducto} featuring: "${promptCliente}". Manufacturing style: ${contextoTaller} Isolated single object, centered, pure solid white background (#FFFFFF), studio product photography, sharp clean edges.`;

    try {
        onProgreso("Gemini está puliendo tu idea según las técnicas del taller...");

        const data = await fetchOpenRouter(
            {
                model: "google/gemini-2.5-flash",
                messages: [
                    {
                        role: "system",
                        content: `You are an expert prompt engineer for 3D product mockup generation.
Combine the customer's request with the workshop manufacturing style into a single, clear, detailed English prompt.
Keep any exact text the customer wants written on the sign in quotes and in its original language (Spanish).
Always enforce: isolated single object, centered, slight 3/4 front angle, clean solid pure white background (#FFFFFF), studio product photography, sharp edges, no hands, no walls, no clutter.
Return ONLY the final English prompt, with no explanations or markdown.`
                    },
                    {
                        role: "user",
                        content: `Product type: ${tipoProducto}. Customer request: "${promptCliente}". Workshop manufacturing style: ${contextoTaller}`
                    }
                ]
            },
            { timeoutMs: 20000, maxReintentos: 1, onReintento: onProgreso }
        );

        const texto = data.choices?.[0]?.message?.content?.trim();
        return texto || promptRespaldoLocal;

    } catch (error) {
        console.warn("Respaldo local activado para prompt:", error.message);
        onProgreso("Usando plantilla directa del taller...");
        return promptRespaldoLocal;
    }
}

/**
 * 2. TEXTO A IMAGEN: Genera el boceto 2D usando Gemini 2.5 Flash Image vía OpenRouter
 */
export async function generarImagen2D(promptOptimizado, onProgreso = () => {}) {
    try {
        onProgreso("Renderizando boceto 2D con Gemini (OpenRouter)...");

        const data = await fetchOpenRouter(
            {
                model: "google/gemini-2.5-flash-image",
                modalities: ["image", "text"],
                messages: [
                    {
                        role: "user",
                        content: promptOptimizado
                    }
                ]
            },
            { timeoutMs: 50000, maxReintentos: 1, onReintento: onProgreso }
        );

        return await extraerBlobDeRespuestaOpenRouter(data);

    } catch (error) {
        console.error("Error en Text-to-Image (OpenRouter):", error);
        throw new Error("No se pudo generar la imagen 2D: " + error.message);
    }
}

/**
 * 3. IMAGEN A IMAGEN PREPARADA: Adapta el logo del cliente al producto físico sobre fondo blanco
 */
export async function prepararImagenPara3D(archivoBlob, tipoProducto, contextoTaller, promptExtra = "", onProgreso = () => {}) {
    try {
        onProgreso("Adaptando tu logo al formato de taller con Gemini...");
        const dataUrl = await blobADataURL(archivoBlob);

        const instruccionEdicion = `Transform the provided logo/image into a realistic physical manufactured product ready for 3D reconstruction.
Preserve the exact text, shapes, and brand identity from the original image.
Product type: ${tipoProducto}.
Manufacturing style: ${contextoTaller}
${promptExtra ? `Additional customer instructions: "${promptExtra}".` : ""}
CRITICAL RULES FOR 3D CONVERSION:
- Place the finished product completely isolated and centered on a clean, solid pure white background (#FFFFFF).
- Remove any original background, tables, hands, or clutter.
- Give it clear physical thickness, clean edges, and studio lighting so a 3D AI model can accurately extrude its geometry.`;

        const data = await fetchOpenRouter(
            {
                model: "google/gemini-2.5-flash-image",
                modalities: ["image", "text"],
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: instruccionEdicion },
                            { type: "image_url", image_url: { url: dataUrl } }
                        ]
                    }
                ]
            },
            { timeoutMs: 55000, maxReintentos: 1, onReintento: onProgreso }
        );

        return await extraerBlobDeRespuestaOpenRouter(data);

    } catch (error) {
        console.error("Error en Image-to-Image (OpenRouter):", error);
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

        console.log("Respuesta cruda de Hunyuan3D:", result.data);
        onProgreso("Extrayendo archivo 3D renderizado...");

        // Busca automáticamente el primer objeto que contenga un archivo .glb o url válida
        const item = Array.isArray(result.data)
            ? result.data.find(d => d && (d.url || d.path || d.value?.url))
            : result.data;

        const urlFinal = item?.url || item?.value?.url || item?.path;
        if (!urlFinal) {
            throw new Error("Hunyuan3D no devolvió una URL de modelo 3D válida.");
        }

        if (urlFinal.toLowerCase().endsWith('.obj')) {
            throw new Error("El motor 3D devolvió un archivo .OBJ y el visor web solo muestra .GLB.");
        }

        return { url: urlFinal, modo: "IA Nube (Hunyuan3D)" };

    } catch (error) {
        console.error("Error en Hunyuan3D:", error);
        throw new Error("Fallo en la generación 3D: " + error.message);
    }
}
