import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFExporter } from 'https://esm.sh/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';

/**
 * Convierte la imagen subida por el cliente en una pieza 3D real (extrusión por relieve/silueta)
 * adaptada al tipo de servicio elegido (Letrero Neón, Llavero/Corpóreo o Pieza 3D).
 */
export async function generarModelo3D(archivoImagen, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    onProgreso("Analizando silueta y relieve de tu imagen...");

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (evento) => {
            const img = new Image();
            img.onload = () => {
                try {
                    onProgreso("Extruyendo geometría 3D a partir de tu diseño...");

                    // 1. Procesar la imagen en un Canvas para obtener mapa de altura (relieve)
                    const maxDim = 128; // Resolución de malla equilibrada para navegador
                    const scale = Math.min(maxDim / img.width, maxDim / img.height);
                    const w = Math.max(16, Math.round(img.width * scale));
                    const h = Math.max(16, Math.round(img.height * scale));

                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    const imgData = ctx.getImageData(0, 0, w, h).data;

                    // 2. Crear escena 3D y textura original
                    const scene = new THREE.Scene();
                    const texture = new THREE.Texture(img);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.needsUpdate = true;

                    // Construir malla con desplazamiento real según el contraste del logo/imagen
                    const ancho3D = 2.4;
                    const alto3D = (h / w) * ancho3D;
                    const geo = new THREE.PlaneGeometry(ancho3D, alto3D, w - 1, h - 1);
                    const pos = geo.attributes.position;

                    const profundidadRelieve = tipoProducto === "Letrero Neon Flex" ? 0.18 : 0.28;

                    for (let i = 0; i < pos.count; i++) {
                        const px = i * 4;
                        const r = imgData[px];
                        const g = imgData[px + 1];
                        const b = imgData[px + 2];
                        const a = imgData[px + 3] / 255;

                        // Luminosidad del píxel para levantar el relieve del logo sobre el fondo
                        const brillo = ((r + g + b) / (3 * 255)) * a;
                        pos.setZ(i, brillo * profundidadRelieve);
                    }
                    geo.computeVertexNormals();

                    // Material frontal con tu diseño + efecto emisivo si es Letrero Neón
                    const esNeon = tipoProducto === "Letrero Neon Flex";
                    const materialFrente = new THREE.MeshStandardMaterial({
                        map: texture,
                        roughness: 0.35,
                        metalness: 0.15,
                        emissive: esNeon ? new THREE.Color(0x38bdf8) : new THREE.Color(0x000000),
                        emissiveMap: esNeon ? texture : null,
                        emissiveIntensity: esNeon ? 0.75 : 0
                    });

                    const mallaFrente = new THREE.Mesh(geo, materialFrente);
                    scene.add(mallaFrente);

                    // 3. Base trasera sólida (Acrílico negro para Neón o base naranja Kawa para Corpóreos/Llaveros)
                    const baseGeo = new THREE.BoxGeometry(ancho3D + 0.08, alto3D + 0.08, 0.08);
                    const baseMat = new THREE.MeshStandardMaterial({
                        color: esNeon ? 0x0f172a : 0xea580c,
                        roughness: 0.4,
                        metalness: 0.3
                    });
                    const baseMalla = new THREE.Mesh(baseGeo, baseMat);
                    baseMalla.position.z = -0.04;
                    scene.add(baseMalla);

                    // 4. Argolla metálica superior si elige "Llaveros o Letras Corpóreas"
                    if (tipoProducto === "Llavero / Corporeo") {
                        const aroGeo = new THREE.TorusGeometry(0.16, 0.035, 16, 32);
                        const aroMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.2 });
                        const aro = new THREE.Mesh(aroGeo, aroMat);
                        aro.position.set(0, (alto3D / 2) + 0.14, 0);
                        scene.add(aro);
                    }

                    onProgreso("Empaquetando archivo .GLB listo para impresión/visor...");

                    // 5. Exportar a .GLB binario
                    const exporter = new GLTFExporter();
                    exporter.parse(
                        scene,
                        (glbBuffer) => {
                            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
                            const urlGLB = URL.createObjectURL(blob);
                            resolve({
                                url: urlGLB,
                                modo: `Relieve 3D Extruido (${tipoProducto})`
                            });
                        },
                        (err) => reject(new Error("Error generando archivo 3D: " + err)),
                        { binary: true }
                    );
                } catch (error) {
                    reject(error);
                }
            };
            img.onerror = () => reject(new Error("No se pudo procesar la imagen."));
            img.src = evento.target.result;
        };

        reader.onerror = () => reject(new Error("Error leyendo el archivo."));
        reader.readAsDataURL(archivoImagen);
    });
}
