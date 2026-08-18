import { defineConfig } from 'vite';
import { resolve } from 'path';
import fs from 'fs';
import { build as viteBuild } from 'vite';

/**
 * ARQUITECTURA DE BUILD PARA CHROMIUM MV3:
 * - content.js  → IIFE autocontenido (content scripts NO soportan ES modules)
 * - background.js → ES module (manifest declara "type": "module")
 * - popup.js    → ES module (cargado desde popup.html con type="module")
 */
const buildContentScripts = () => {
  return {
    name: 'build-content-scripts',
    async writeBundle() {
      // === 1. Compilar content.js como IIFE ===
      await viteBuild({
        configFile: false,
        build: {
          outDir: resolve(__dirname, 'dist'),
          emptyOutDir: false,
          lib: {
            entry: resolve(__dirname, 'src/content.ts'),
            name: 'VideoEnhancerContent',
            formats: ['iife'],
            fileName: () => 'content.js'
          },
          rollupOptions: {
            output: {
              inlineDynamicImports: true
            }
          },
          minify: false
        },
        logLevel: 'warn'
      });

      // === 2. Compilar background.js como ES module ===
      await viteBuild({
        configFile: false,
        build: {
          outDir: resolve(__dirname, 'dist'),
          emptyOutDir: false,
          rollupOptions: {
            input: { background: resolve(__dirname, 'src/background.ts') },
            output: {
              entryFileNames: '[name].js',
              format: 'es'
            }
          },
          minify: false
        },
        logLevel: 'warn'
      });

      // === 3. Copiar assets estáticos a dist/ ===
      fs.copyFileSync('manifest.json', 'dist/manifest.json');
      if (fs.existsSync('icon.png')) fs.copyFileSync('icon.png', 'dist/icon.png');
      if (fs.existsSync('welcome.html')) fs.copyFileSync('welcome.html', 'dist/welcome.html');
      if (fs.existsSync('welcome.js')) fs.copyFileSync('welcome.js', 'dist/welcome.js');

      // === 4. Arreglar popup.html: corregir todas las rutas a relativas planas ===
      const nestedPopup = resolve(__dirname, 'dist/src/popup/popup.html');
      const distPopup = resolve(__dirname, 'dist/popup.html');
      if (fs.existsSync(nestedPopup)) {
        let popupContent = fs.readFileSync(nestedPopup, 'utf-8');
        // Vite genera rutas como "../../popup.js" o "/popup.js" 
        // Reemplazar CUALQUIER ruta a popup.js/css/logger.js con "./filename"
        popupContent = popupContent.replace(/src="[^"]*popup\.js"/g, 'src="./popup.js"');
        popupContent = popupContent.replace(/href="[^"]*popup\.css"/g, 'href="./popup.css"');
        popupContent = popupContent.replace(/href="[^"]*logger\.js"/g, 'href="./logger.js"');
        popupContent = popupContent.replace(/src="[^"]*logger\.js"/g, 'src="./logger.js"');
        fs.writeFileSync(distPopup, popupContent);
        fs.rmSync(resolve(__dirname, 'dist/src'), { recursive: true, force: true });
      }

      // === 5. Sincronizar todo a la RAÍZ para Brave ===
      const filesToSync = ['content.js', 'background.js', 'popup.js', 'popup.css', 'popup.html', 'logger.js'];
      for (const file of filesToSync) {
        const distFile = resolve(__dirname, `dist/${file}`);
        if (fs.existsSync(distFile)) {
          fs.copyFileSync(distFile, resolve(__dirname, file));
        }
      }
    }
  };
};

export default defineConfig({
  plugins: [buildContentScripts()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    }
  }
});
