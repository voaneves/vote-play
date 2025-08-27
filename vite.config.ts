import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { fileURLToPath } from 'url'; // Import para resolver caminhos em ESM
import { componentTagger } from "lovable-tagger";

// Helper para obter __dirname em módulos ES (padrão do Vite)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // 1. Essencial para o deploy em um subdiretório (GitHub Pages)
  base: "/vote-play/",

  server: {
    host: "::", // Permite acesso na rede local
    port: 8080,
  },
  plugins: [
    react(),
    // Plugin que roda apenas em modo de desenvolvimento
    mode === 'development' && componentTagger(),
  ].filter(Boolean), // Remove valores falsos (como o plugin desativado) do array
  resolve: {
    alias: {
      // 2. Forma correta de definir o alias "@" em projetos com ES Modules
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
