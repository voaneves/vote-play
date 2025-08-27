import React from 'react';

interface VotingBarProps {
  percentage: number;
}

const VotingBar: React.FC<VotingBarProps> = ({ percentage }) => (
  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
    <div 
      className="bg-gradient-to-r from-highlight-action to-secondary-highlight h-3 rounded-full transition-all duration-700 ease-out relative"
      style={{ width: `${Math.max(percentage, 2)}%` }}
    >
      {percentage > 0 && (
        <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
      )}
    </div>
  </div>
);

export default VotingBar;