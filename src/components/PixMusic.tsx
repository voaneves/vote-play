import React, { useState } from 'react';
import { PixRequest } from '@/types';
import QrCodeIcon from './icons/QrCodeIcon';
import PixRequestItem from './PixRequestItem';
import { useToast } from '@/hooks/use-toast';

interface PixMusicProps {
  pixRequests: PixRequest[];
  onAddPixRequest: (title: string, artist: string) => void;
}

const PixMusic: React.FC<PixMusicProps> = ({ pixRequests, onAddPixRequest }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get('title') as string;
    const artist = formData.get('artist') as string;
    
    if (title && artist) {
      setIsSubmitting(true);
      
      // Simulate processing time
      setTimeout(() => {
        onAddPixRequest(title, artist);
        
        toast({
          title: "Pedido enviado!",
          description: `"${title}" - ${artist} foi adicionada à fila`,
          duration: 3000,
        });
        
        e.currentTarget.reset();
        setIsSubmitting(false);
      }, 1500);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6">
      <div className="text-center mb-6">
        <h1 className="text-4xl font-bold text-primary-dark mb-2">Pix Music</h1>
        <p className="text-text-detail text-lg">Peça sua música e fure a fila!</p>
        <div className="mt-2 text-sm text-text-detail/70">
          💰 Fure a fila por apenas R$ 20,00
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-lg mb-8 border border-gray-100">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="song-title" className="block text-sm font-semibold text-text-detail mb-2">
              Nome da Música *
            </label>
            <input 
              type="text" 
              name="title" 
              id="song-title" 
              required 
              disabled={isSubmitting}
              placeholder="Ex: Evidências"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-highlight-action focus:border-highlight-action transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed" 
            />
          </div>
          <div>
            <label htmlFor="song-artist" className="block text-sm font-semibold text-text-detail mb-2">
              Artista *
            </label>
            <input 
              type="text" 
              name="artist" 
              id="song-artist" 
              required 
              disabled={isSubmitting}
              placeholder="Ex: Chitãozinho & Xororó"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-highlight-action focus:border-highlight-action transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed" 
            />
          </div>
          <button 
            type="submit" 
            disabled={isSubmitting}
            className={`w-full flex justify-center items-center gap-3 py-4 px-6 border border-transparent rounded-lg shadow-sm text-base font-semibold text-white transition-all duration-200 ${
              isSubmitting 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-highlight-action hover:bg-secondary-highlight focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-highlight-action transform hover:scale-[1.02]'
            }`}
          >
            {isSubmitting ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <QrCodeIcon className="w-6 h-6" />
                Pedir com Pix (R$ 20,00)
              </>
            )}
          </button>
        </form>
      </div>
      
      <div>
        <h2 className="text-2xl font-bold text-primary-dark mb-4 flex items-center gap-2">
          <span>🎵</span> Fila de Pedidos
          {pixRequests.length > 0 && (
            <span className="text-sm bg-highlight-action text-white px-2 py-1 rounded-full">
              {pixRequests.length}
            </span>
          )}
        </h2>
        {pixRequests.length > 0 ? (
          <ul className="space-y-3">
            {pixRequests.map((req, index) => (
              <PixRequestItem key={req.id} request={req} index={index} />
            ))}
          </ul>
        ) : (
          <div className="text-center text-text-detail bg-gradient-to-br from-white/80 to-gray-50/80 p-8 rounded-lg border-2 border-dashed border-gray-200">
            <div className="text-6xl mb-4">🎤</div>
            <p className="text-lg font-medium mb-2">A fila de pedidos está vazia</p>
            <p className="text-sm">Seja o primeiro a pedir uma música!</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PixMusic;