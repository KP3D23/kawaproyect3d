import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";

export async function generarModelo3D(archivoImagen, onProgreso = () => {}, hfToken = "") {
    try {
        onProgreso("Conectando con servidor IA (TRELLIS.2)...");
        const opciones = hfToken ? { hf_token: hfToken } : {};
        const client = await Client.connect("microsoft/TRELLIS.2", opciones);

        onProgreso("Procesando imagen y eliminando fondo...");
        const imgProcesada = await client.predict("/preprocess_image", {
            input: archivoImagen
        });

        onProgreso("Generando geometría 3D (~30 seg)...");
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

        onProgreso("Extrayendo malla .GLB para el visor...");
        const resultadoGLB = await client.predict("/extract_glb", {
            decimation_target: 100000,
            texture_size: 1024
        });

        return resultadoGLB.data[0].url;
    } catch (error) {
        console.error("Error en TRELLIS.2:", error);
        throw new Error("El servidor gratuito de IA está saturado o requiere token. Intenta nuevamente.");
    }
}
