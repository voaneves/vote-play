import React, { useState } from 'react';
import { Song } from '@/types';
import VotingBar from './VotingBar';
import { useToast } from '@/hooks/use-toast';

interface SongItemProps {
  song: Song;
  totalVotes: number;
  onVote: (id: number) => void;
}

const SongItem: React.FC<SongItemProps> = ({ song, totalVotes, onVote }) => {
  const votePercentage = totalVotes > 0 ? (song.votes / totalVotes) * 100 : 0;
  const [isVoting, setIsVoting] = useState(false);
  const { toast } = useToast();

  const handleVote = async () => {
    setIsVoting(true);
    onVote(song.id);
    
    toast({
      title: "Voto registrado!",
      description: `Você votou em "${song.title}" - ${song.artist}`,
      duration: 2000,
    });

    // Reset animation after a short delay
    setTimeout(() => setIsVoting(false), 1000);
  };

  return (
    <div className={`bg-white/80 backdrop-blur-sm p-4 rounded-lg shadow-md transition-all duration-300 hover:shadow-lg ${isVoting ? 'scale-[1.02] ring-2 ring-highlight-action/50' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-primary-dark text-lg truncate">{song.title}</h3>
          <p className="text-text-detail text-sm truncate">{song.artist}</p>
        </div>
        <div className="ml-4">
          <button 
            onClick={handleVote}
            disabled={isVoting}
            className={`font-bold py-2 px-4 rounded-full transition-all duration-200 transform ${
              isVoting 
                ? 'bg-green-500 text-white scale-110' 
                : 'bg-highlight-action text-white hover:bg-secondary-highlight hover:scale-105'
            } disabled:cursor-not-allowed`}
          >
            {isVoting ? '✓' : 'Votar'}
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <VotingBar percentage={votePercentage} />
        <span className="font-semibold text-sm text-primary-dark w-16 text-right">
          {votePercentage.toFixed(0)}% ({song.votes})
        </span>
      </div>
    </div>
  );
};

export default SongItem;