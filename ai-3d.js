import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

export async function generarModelo3D(archivoImagen, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Consultando credenciales seguras...");
        
        // 1. Obtener el token de Hugging Face desde Supabase (sin exponerlo en GitHub)
        const { data: config, error: errBd } = await supabase
            .from('configuracion_api')
            .select('token')
            .eq('servicio', 'huggingface_trellis')
            .single();

        if (errBd || !config) {
            throw new Error("No se pudo obtener la llave de acceso a la IA.");
        }

        onProgreso("Conectando con el motor de IA (TRELLIS.2)...");
        
        // 2. Conectar a Trellis usando el token seguro
        const client = await Client.connect("microsoft/TRELLIS.2", { hf_token: config.token });

        onProgreso("Procesando imagen y eliminando fondo...");
        const imgProcesada = await client.predict("/preprocess_image", {
            input: archivoImagen
        });

        onProgreso("Generando geometría tridimensional con IA (~30 seg)...");
        await client.predict("/image_to_3d", {
            image: imgProcesada.data[0],
            seed: 0,
            resolution: "512", // Resolución óptima para velocidad
            ss_guidance_strength: 7.5,
            ss_guidance_rescale: 0.7,
            ss_sampling_steps: 12,
            ss_rescale_t: 5,
            shape_slat_guidance_strength: 7.5,
            shape_slat_guidance_rescale: 0.5,
            shape_slat_sampling_steps: 12,
            shape_slat_rescale_t: 3,
            tex_slat_guidance_strength: 1,
            tex_slat_guidance_rescale: 0,
            tex_slat_sampling_steps: 12,
            tex_slat_rescale_t: 3
        });

        onProgreso("Extrayendo archivo .GLB renderizado...");
        const resultadoGLB = await client.predict("/extract_glb", {
            decimation_target: 100000,
            texture_size: 1024
        });

        return { url: resultadoGLB.data[0].url, modo: "IA Nube (TRELLIS.2)" };

    } catch (error) {
        console.error("Error procesando IA externa:", error);
        throw new Error("Fallo en la conexión con el servidor de IA. Verifica los parámetros o intenta de nuevo.");
    }
}
