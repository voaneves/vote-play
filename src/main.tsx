import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { registrarServiceWorker } from './lib/pwa';
import './index.css';

// O QR do show carrega a URL seguida de "#" e dígitos: são os bits que
// desenham o logo nos módulos (src/lib/qr/qrArt.ts). O navegador não manda o
// fragmento ao servidor; aqui ele sai da barra de endereço antes do primeiro
// render, para ninguém copiar e compartilhar o link com a sopa de números.
if (/^#\d+$/.test(window.location.hash)) {
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

createRoot(document.getElementById('root')!).render(<App />);

// Depois do render, nunca antes: o cache offline não pode disputar rede com a
// primeira pintura da tela de quem acabou de escanear o QR.
registrarServiceWorker();
