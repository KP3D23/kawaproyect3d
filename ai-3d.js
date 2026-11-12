import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";
import { supabase } from './supa.js';

export async function generarModelo3D(archivoImagen, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Consultando credenciales seguras...");
        
        // 1. Obtener el token de Hugging Face desde Supabase (seguridad intacta)
        const { data: config, error: errBd } = await supabase
            .from('configuracion_api')
            .select('token')
            .eq('servicio', 'huggingface_trellis') // Usamos la misma fila que ya creaste
            .single();

        if (errBd || !config) {
            throw new Error("No se pudo obtener la llave de acceso a la IA.");
        }

        onProgreso("Conectando con el motor Hunyuan3D-2.1...");
        
        // 2. Conectar al Space de Hunyuan en Hugging Face usando tu token
        const client = await Client.connect("tencent/Hunyuan3D-2.1", { hf_token: config.token });

        onProgreso("Limpiando fondo y generando geometría 3D (~45 seg)...");
        
        // 3. Llamada al endpoint principal que procesa y genera el modelo
        const result = await client.predict("/shape_generation", { 
            image: archivoImagen, 
            mv_image_front: null, 
            mv_image_back: null, 
            mv_image_left: null, 
            mv_image_right: null, 		
            steps: 30, // Calidad estándar recomendada por Tencent		
            guidance_scale: 5, 		
            seed: Math.floor(Math.random() * 100000), // Semilla aleatoria para resultados únicos		
            octree_resolution: 256, 		
            check_box_rembg: true, // ¡Clave! Elimina el fondo de fotos complejas automáticamente		
            num_chunks: 8000, 		
            randomize_seed: true, 
        });

        onProgreso("Extrayendo archivo 3D renderizado...");

        // El endpoint devuelve un arreglo de 4 elementos. 
        // La posición [0] contiene el objeto del archivo generado.
        const archivo3D = result.data[0];
        
        // Dependiendo de la versión de @gradio/client, la URL directa está en .url o .path
        const urlGLB = archivo3D.url || archivo3D.path;

        return { url: urlGLB, modo: "IA Nube (Hunyuan3D)" };

    } catch (error) {
        console.error("Error procesando IA externa (Hunyuan3D):", error);
        throw new Error("Fallo en la conexión con el servidor de IA. Verifica tu cuota o intenta de nuevo.");
    }
}
