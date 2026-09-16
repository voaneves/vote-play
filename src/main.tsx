import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { registrarServiceWorker } from './lib/pwa';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// Depois do render, nunca antes: o cache offline não pode disputar rede com a
// primeira pintura da tela de quem acabou de escanear o QR.
registrarServiceWorker();
