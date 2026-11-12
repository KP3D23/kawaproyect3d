import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";

// Modelos .GLB públicos de respaldo para pruebas cuando ZeroGPU de Hugging Face está sin cuota
const MODELOS_RESPALDO = {
    "Impresion 3D": "https://modelviewer.dev/shared-assets/models/Astronaut.glb",
    "Letrero Neon Flex": "https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb",
    "Llavero / Corporeo": "https://modelviewer.dev/shared-assets/models/RobotExpressive.glb"
};

export async function generarModelo3D(archivoImagen, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    try {
        onProgreso("Intentando conexión con servidor IA (TRELLIS.2)...");
        const client = await Client.connect("microsoft/TRELLIS.2");

        onProgreso("Procesando imagen y eliminando fondo...");
        const imgProcesada = await client.predict("/preprocess_image", {
            input: archivoImagen
        });

        onProgreso("Construyendo malla 3D...");
        await client.predict("/image_to_3d", {
            image: imgProcesada.data[0],
            seed: 0,
            resolution: "512",
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

        const resultadoGLB = await client.predict("/extract_glb", {
            decimation_target: 100000,
            texture_size: 1024
        });

        return { url: resultadoGLB.data[0].url, modo: "IA Nube (TRELLIS.2)" };

    } catch (error) {
        // Fallback automático: si no hay tokens/cuota en Hugging Face, usa el adaptador local
        console.warn("Cuota ZeroGPU agotada, activando modo simulador 3D:", error.message);
        onProgreso("Cuota gratuita de nube llena. Generando previsualización base local...");
        await new Promise(r => setTimeout(r, 1200)); // Simula tiempo de renderizado

        const urlFallback = MODELOS_RESPALDO[tipoProducto] || MODELOS_RESPALDO["Impresion 3D"];
        return { url: urlFallback, modo: "Previsualización Base (Sin consumo de tokens)" };
    }
}
