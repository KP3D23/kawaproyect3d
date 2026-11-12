import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

/**
 * 1. Genera una imagen 2D a partir del texto del cliente usando FLUX.1
 */
export async function generarImagen2D(promptTexto, onProgreso = () => {}) {
    try {
        onProgreso("Consultando credenciales seguras...");
        const { data: config, error: errBd } = await supabase
            .from('configuracion_api')
            .select('token')
            .eq('servicio', 'huggingface_trellis')
            .single();

        if (errBd || !config) throw new Error("Fallo al obtener llave.");

        onProgreso("Generando boceto 2D con Inteligencia Artificial...");
        
        // Usamos la API de Inferencia directa (más rápida que Gradio para imágenes)
        // Añadimos palabras clave al prompt para asegurar un fondo limpio ideal para 3D
        const promptOptimizado = `${promptTexto}, 3d render style, solid white background, high contrast, clean edges, isolated object`;
        
        const respuesta = await fetch(
            "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
            {
                headers: {
                    Authorization: `Bearer ${config.token}`,
                    "Content-Type": "application/json",
                },
                method: "POST",
                body: JSON.stringify({ inputs: promptOptimizado }),
            }
        );

        if (!respuesta.ok) throw new Error("El servidor de imágenes está saturado. Intenta de nuevo.");

        const blob = await respuesta.blob();
        return blob; // Retornamos el Blob crudo para poder mostrarlo y luego enviarlo a 3D

    } catch (error) {
        console.error("Error en Text-to-Image:", error);
        throw new Error("No se pudo generar la imagen: " + error.message);
    }
}

/**
 * 2. Genera el modelo 3D usando Hunyuan3D-2.1 a partir del Blob generado arriba
 */
export async function generarModelo3D(archivoBlob, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Conectando con el motor Hunyuan3D-2.1...");
        const { data: config } = await supabase.from('configuracion_api').select('token').eq('servicio', 'huggingface_trellis').single();

        const client = await Client.connect("tencent/Hunyuan3D-2.1", { hf_token: config.token });

        onProgreso("Limpiando fondo y construyendo geometría 3D (~45 seg)...");
        
        const result = await client.predict("/shape_generation", { 
            image: archivoBlob, 
            mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null, 		
            steps: 30, 		
            guidance_scale: 5, 		
            seed: Math.floor(Math.random() * 100000), 		
            octree_resolution: 256, 		
            check_box_rembg: true, // Recorte automático del fondo blanco		
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
