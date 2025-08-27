import React from 'react';
import { Screen } from '@/types';
import NavButton from './NavButton';
import VoteIcon from './icons/VoteIcon';
import PixIcon from './icons/PixIcon';

interface NavigationProps {
  activeScreen: Screen;
  setActiveScreen: (screen: Screen) => void;
}

const Navigation: React.FC<NavigationProps> = ({ activeScreen, setActiveScreen }) => {
  return (
    <footer className="fixed bottom-0 left-0 right-0 h-20 bg-background-light border-t border-gray-200 shadow-[0_-4px_20px_-8px_rgba(0,0,0,0.15)] backdrop-blur-sm">
      <nav className="flex items-center justify-around h-full max-w-2xl mx-auto px-6">
        <NavButton 
          label="Votação"
          screen={Screen.Voting}
          Icon={VoteIcon}
          isActive={activeScreen === Screen.Voting}
          onClick={setActiveScreen}
        />
        <div className="w-px h-8 bg-gray-300" />
        <NavButton 
          label="Pix Music"
          screen={Screen.PixMusic}
          Icon={PixIcon}
          isActive={activeScreen === Screen.PixMusic}
          onClick={setActiveScreen}
        />
      </nav>
    </footer>
  );
};

export default Navigation;