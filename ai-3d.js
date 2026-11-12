import * as THREE from 'https://esm.sh/three@0.160.0';
import { GLTFExporter } from 'https://esm.sh/three@0.160.0/examples/jsm/exporters/GLTFExporter.js';

/**
 * Genera un modelo 3D real (.GLB) en el navegador a partir de la imagen subida
 * y el tipo de producto elegido (Letrero Neón, Llavero o Pieza 3D).
 */
export async function generarModelo3D(archivoImagen, tipoProducto = "Impresion 3D", onProgreso = () => {}) {
    onProgreso("Procesando imagen y extrayendo geometría 3D en el navegador...");

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function (evento) {
            const img = new Image();
            img.onload = function () {
                try {
                    onProgreso("Construyendo malla tridimensional y texturas...");

                    // 1. Crear escena Three.js
                    const scene = new THREE.Scene();

                    // Cargar la imagen del cliente como textura
                    const texture = new THREE.Texture(img);
                    texture.colorSpace = THREE.SRGBColorSpace;
                    texture.needsUpdate = true;

                    // Proporción real de la imagen subida
                    const aspect = img.width / img.height;
                    const ancho = aspect >= 1 ? 2.2 : 2.2 * aspect;
                    const alto = aspect >= 1 ? 2.2 / aspect : 2.2;
                    const grosor = tipoProducto === "Letrero Neon Flex" ? 0.12 : 0.25;

                    // 2. Construir volumen 3D según el producto
                    const geometriaBase = new THREE.BoxGeometry(ancho, alto, grosor);

                    // Material frontal con el diseño del cliente + bordes en tono Kawa/Neón
                    const colorBorde = tipoProducto === "Letrero Neon Flex" ? 0x38bdf8 : 0xea580c;
                    const matBorde = new THREE.MeshStandardMaterial({
                        color: colorBorde,
                        roughness: 0.3,
                        metalness: 0.2,
                        emissive: tipoProducto === "Letrero Neon Flex" ? 0x0284c7 : 0x000000,
                        emissiveIntensity: tipoProducto === "Letrero Neon Flex" ? 0.6 : 0
                    });

                    const matFrontal = new THREE.MeshStandardMaterial({
                        map: texture,
                        roughness: 0.4
                    });

                    // Aplicar textura al frente y atrás, y color sólido a los cantos
                    const materiales = [
                        matBorde, matBorde,
                        matBorde, matBorde,
                        matFrontal, matFrontal
                    ];

                    const malla = new THREE.Mesh(geometriaBase, materiales);
                    scene.add(malla);

                    // Si es llavero, agregar argolla superior 3D
                    if (tipoProducto === "Llavero / Corporeo") {
                        const aroGeo = new THREE.TorusGeometry(0.18, 0.04, 16, 32);
                        const aroMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.8, roughness: 0.2 });
                        const aro = new THREE.Mesh(aroGeo, aroMat);
                        aro.position.set(0, (alto / 2) + 0.15, 0);
                        scene.add(aro);
                    }

                    onProgreso("Exportando archivo .GLB para el visor...");

                    // 3. Exportar la escena a formato binario .GLB estándar
                    const exporter = new GLTFExporter();
                    exporter.parse(
                        scene,
                        (glbBuffer) => {
                            const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
                            const urlGLB = URL.createObjectURL(blob);
                            resolve({
                                url: urlGLB,
                                modo: "Motor Paramétrico Kawa3D (Local, Sin Tokens)"
                            });
                        },
                        (error) => reject(new Error("Error exportando malla GLB: " + error)),
                        { binary: true }
                    );
                } catch (err) {
                    reject(err);
                }
            };
            img.onerror = () => reject(new Error("No se pudo leer el archivo de imagen."));
            img.src = evento.target.result;
        };

        reader.onerror = () => reject(new Error("Error cargando la imagen."));
        reader.readAsDataURL(archivoImagen);
    });
}
