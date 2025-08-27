import React, { useState, useCallback } from 'react';
import { Screen } from '@/types';
import ShowEntry from '@/components/ShowEntry';
import MusicVoting from '@/components/MusicVoting';
import PixMusic from '@/components/PixMusic';
import Navigation from '@/components/Navigation';
import { useShowData } from '@/hooks/useShowData';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [activeScreen, setActiveScreen] = useState<Screen>(Screen.Voting);
  const [message, setMessage] = useState<string | null>(null);
  
  // Centralized state management
  const { songs, pixRequests, timer, totalVotes, votingRound, handleVote, handleAddPixRequest } = useShowData();

  const handleLogin = useCallback((code: string) => {
    if (code.trim().toUpperCase() === 'ABC123') {
      setIsAuthenticated(true);
      setMessage(null);
    } else {
      setMessage('Código do show inválido.');
      setTimeout(() => setMessage(null), 3000);
    }
  }, []);
  
  const renderContent = () => {
    switch (activeScreen) {
      case Screen.Voting:
        return <MusicVoting songs={songs} timer={timer} totalVotes={totalVotes} onVote={handleVote} />;
      case Screen.PixMusic:
        return <PixMusic pixRequests={pixRequests} onAddPixRequest={handleAddPixRequest} />;
      default:
        return <MusicVoting songs={songs} timer={timer} totalVotes={totalVotes} onVote={handleVote} />;
    }
  };

  if (!isAuthenticated) {
    return (
      <>
        {message && (
          <div className="fixed top-5 left-1/2 transform -translate-x-1/2 bg-secondary-highlight text-white px-5 py-2 rounded-lg shadow-lg z-50">
            {message}
          </div>
        )}
        <ShowEntry onLogin={handleLogin} />
      </>
    );
  }

  return (
    <div className="bg-background-light text-text-detail min-h-screen font-sans flex flex-col">
      <main className="flex-grow p-4 pb-28 overflow-y-auto">
        {renderContent()}
      </main>
      <Navigation activeScreen={activeScreen} setActiveScreen={setActiveScreen} />
    </div>
  );
};

export default Index;
