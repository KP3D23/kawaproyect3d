import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

/**
 * Función auxiliar para obtener llaves desde Supabase
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
 * 1. Consultar a Gemini 2.5 Flash (Asesor comercial / Bot)
 */
export async function consultarGemini(mensajeUsuario, instruccionesPersonalizadas = null) {
    try {
        const apiKey = await obtenerToken('gemini_api');
        const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

        const instruccionesTaller = instruccionesPersonalizadas || `
            Eres el asistente comercial de KawaProyects3D en Barinas, Venezuela.
            Productos que fabricamos:
            - Letreros Neón Flex LED (base impresa en 3D con canaletas, no acrílico sólido).
            - Letreros PVC con vinil adhesivo e iluminación indirecta (efecto halo).
            - Letras 3D en relieve (PLA/PETG).
            - Reconocimientos y trofeos (100% 3D o extruidos 2D).
            - Llaveros personalizados en relieve ($3 al detal, $2.20 por docena, 4-5 cm estándar).
            Reglas: Se requiere 50% de anticipo para iniciar producción. Sé amable, claro y conciso.
        `;

        const respuesta = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: instruccionesTaller }]
                },
                contents: [{
                    parts: [{ text: mensajeUsuario }]
                }]
            })
        });

        if (!respuesta.ok) {
            const errData = await respuesta.json().catch(() => ({}));
            throw new Error(errData.error?.message || `Error HTTP ${respuesta.status}`);
        }

        const data = await respuesta.json();
        return data.candidates[0].content.parts[0].text;

    } catch (error) {
        console.error("Error en Gemini API:", error);
        throw new Error("No se pudo conectar con Gemini: " + error.message);
    }
}

/**
 * 2. Usar Gemini para mejorar y traducir el prompt del cliente antes de enviarlo a FLUX.1
 */
export async function optimizarPromptConGemini(promptCliente, tipoProducto, contextoTaller) {
    const instrucciones = `
        You are an expert prompt engineer for FLUX.1 image generation.
        Combine the workshop manufacturing style with the customer's request into a single, clear, detailed English prompt.
        Keep any exact text the customer wants written on the sign in quotes and in its original language.
        Always enforce: isolated object, centered, clean solid white background, studio product photography.
        Return ONLY the final English prompt, with no explanations or extra text.
    `;

    const mensaje = `Product type: ${tipoProducto}. Workshop style: ${contextoTaller}. Customer request: "${promptCliente}"`;
    return await consultarGemini(mensaje, instrucciones);
}

/**
 * 3. Genera una imagen 2D a partir del texto usando FLUX.1
 */
export async function generarImagen2D(promptTexto, onProgreso = () => {}) {
    try {
        onProgreso("Consultando credenciales seguras...");
        const hfToken = await obtenerToken('huggingface_trellis');

        onProgreso("Generando boceto 2D con Inteligencia Artificial...");
        
        const respuesta = await fetch(
            "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
            {
                headers: {
                    Authorization: `Bearer ${hfToken}`,
                    "Content-Type": "application/json",
                },
                method: "POST",
                body: JSON.stringify({ inputs: promptTexto }),
            }
        );

        if (!respuesta.ok) {
            throw new Error("El servidor de imágenes está saturado. Intenta de nuevo.");
        }

        return await respuesta.blob();

    } catch (error) {
        console.error("Error en Text-to-Image:", error);
        throw new Error("No se pudo generar la imagen: " + error.message);
    }
}

/**
 * 4. Genera el modelo 3D usando Hunyuan3D-2.1 a partir del Blob 2D
 */
export async function generarModelo3D(archivoBlob, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Conectando con el motor Hunyuan3D-2.1...");
        const hfToken = await obtenerToken('huggingface_trellis');

        const client = await Client.connect("tencent/Hunyuan3D-2.1", { hf_token: hfToken });

        onProgreso("Limpiando fondo y construyendo geometría 3D (~45 seg)...");
        
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
        throw new Error("Fallo en la generación 3D. Intenta de nuevo.");
    }
}
