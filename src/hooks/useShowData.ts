import { useState, useCallback, useEffect, useMemo } from 'react';
import { Song, PixRequest } from '@/types';

const initialSongs: Song[] = [
  { id: 1, title: 'Bohemian Rhapsody', artist: 'Queen', votes: 120 },
  { id: 2, title: 'Smells Like Teen Spirit', artist: 'Nirvana', votes: 95 },
  { id: 3, title: 'Hotel California', artist: 'Eagles', votes: 150 },
  { id: 4, title: 'Stairway to Heaven', artist: 'Led Zeppelin', votes: 110 },
];

const initialPixRequests: PixRequest[] = [
  { id: 1, title: 'Wonderwall', artist: 'Oasis', amount: 20, user: 'Ana' },
  { id: 2, title: 'Evidências', artist: 'Chitãozinho & Xororó', amount: 20, user: 'Carlos' },
];

export const useShowData = () => {
  const [songs, setSongs] = useState<Song[]>(initialSongs);
  const [pixRequests, setPixRequests] = useState<PixRequest[]>(initialPixRequests);
  const [timer, setTimer] = useState<number>(300); // 5 minutes
  const [votingRound, setVotingRound] = useState<number>(1);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      setTimer(prev => {
        if (prev <= 1) {
          // Timer ended - reset for next round
          setVotingRound(round => round + 1);
          return 300; // Reset to 5 minutes
        }
        return prev - 1;
      });
    }, 1000);

    const voteInterval = setInterval(() => {
      setSongs(prevSongs => {
        const randomSongIndex = Math.floor(Math.random() * prevSongs.length);
        const voteIncrease = Math.floor(Math.random() * 3) + 1; // 1-3 votes
        return prevSongs.map((song, index) => 
          index === randomSongIndex ? { ...song, votes: song.votes + voteIncrease } : song
        );
      });
    }, 3000); // Slightly slower for better UX

    return () => {
      clearInterval(timerInterval);
      clearInterval(voteInterval);
    };
  }, []);

  const totalVotes = useMemo(() => {
    return songs.reduce((acc, song) => acc + song.votes, 0);
  }, [songs]);

  const handleVote = useCallback((songId: number) => {
    setSongs(prevSongs =>
      prevSongs.map(song =>
        song.id === songId ? { ...song, votes: song.votes + 1 } : song
      )
    );
  }, []);

  const handleAddPixRequest = useCallback((title: string, artist: string) => {
    const newRequest: PixRequest = {
        id: Date.now(),
        title,
        artist,
        amount: 20.00,
        user: 'Você'
    };
    setPixRequests(prev => [...prev, newRequest]);
    // In a real app, this would trigger a Pix payment flow.
  }, []);

  return { 
    songs, 
    pixRequests, 
    timer, 
    totalVotes, 
    votingRound, 
    handleVote, 
    handleAddPixRequest 
  };
};