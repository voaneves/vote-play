import React from 'react';
import { Screen } from '@/types';

interface NavButtonProps {
  label: string;
  screen: Screen;
  Icon: React.ElementType;
  isActive: boolean;
  onClick: (screen: Screen) => void;
}

const NavButton: React.FC<NavButtonProps> = ({ label, screen, Icon, isActive, onClick }) => {
  return (
    <button 
      onClick={() => onClick(screen)}
      className={`flex flex-col items-center justify-center w-full py-2 px-4 rounded-lg transition-all duration-200 transform hover:scale-105 ${
        isActive 
          ? 'text-highlight-action bg-highlight-action/10' 
          : 'text-text-detail/60 hover:text-highlight-action hover:bg-highlight-action/5'
      }`}
    >
      <Icon className="w-6 h-6 mb-1" />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
};

export default NavButton;