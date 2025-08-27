export enum Screen {
  Voting = 'VOTING',
  PixMusic = 'PIX_MUSIC',
}

export interface Song {
  id: number;
  title: string;
  artist: string;
  votes: number;
}

export interface PixRequest {
  id: number;
  title: string;
  artist: string;
  amount: number;
  user: string;
}