import React from 'react';
import { Song } from '@/types';
import SongItem from './SongItem';

interface MusicVotingProps {
  songs: Song[];
  timer: number;
  totalVotes: number;
  onVote: (songId: number) => void;
}

const MusicVoting: React.FC<MusicVotingProps> = ({ songs, timer, totalVotes, onVote }) => {
  const minutes = Math.floor(timer / 60);
  const seconds = timer % 60;
  const isTimeRunningOut = timer <= 60; // Last minute warning

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6">
      <div className={`text-center mb-6 p-6 bg-primary-dark text-white rounded-xl shadow-lg transition-all duration-300 ${
        isTimeRunningOut ? 'animate-pulse ring-4 ring-red-400/50' : ''
      }`}>
        <h1 className="text-3xl font-bold mb-2">Votação Musical</h1>
        <p className="text-lg mb-4">A próxima música é por sua conta!</p>
        
        <div className={`text-5xl font-mono bg-white/20 rounded-lg py-3 px-4 inline-block ${
          isTimeRunningOut ? 'bg-red-500/30 text-red-100' : ''
        }`}>
          <span>{String(minutes).padStart(2, '0')}</span>
          <span className="animate-pulse mx-1">:</span>
          <span>{String(seconds).padStart(2, '0')}</span>
        </div>
        
        {isTimeRunningOut && (
          <p className="text-red-200 text-sm mt-2 font-semibold animate-bounce">
            ⏰ Tempo se esgotando!
          </p>
        )}
        
        <div className="mt-4 text-sm text-white/80">
          Total de votos: <span className="font-bold">{totalVotes}</span>
        </div>
      </div>
      
      <div className="space-y-4">
        {songs.sort((a, b) => b.votes - a.votes).map(song => (
          <SongItem key={song.id} song={song} totalVotes={totalVotes} onVote={onVote} />
        ))}
      </div>
    </div>
  );
};

export default MusicVoting;