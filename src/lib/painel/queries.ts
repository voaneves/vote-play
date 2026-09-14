import { getSupabase } from '@/lib/supabase/client';
import type { ShowStatus, VoteMode } from '@/types/domain';

/** Linhas do painel do artista. A RLS garante que só vêm as do próprio dono. */

export interface SongRow {
  id: string;
  title: string;
  artist_name: string;
  is_active: boolean;
  times_played: number;
}

export interface ShowRow {
  id: string;
  title: string;
  venue: string | null;
  city: string | null;
  status: ShowStatus;
  join_code: string;
  vote_mode: VoteMode;
  round_duration_seconds: number;
  direct_request_price_cents: number;
  scheduled_for: string | null;
  created_at: string;
}

export interface ShowSongRow {
  id: string;
  song_id: string;
  status: string;
  songs: { title: string; artist_name: string } | null;
}

export interface RoundRow {
  id: string;
  seq: number;
  status: string;
  closes_at: string | null;
  total_votes: number;
  total_weight: number;
  winner_candidate_id: string | null;
}

const SHOW_COLUMNS =
  'id,title,venue,city,status,join_code,vote_mode,round_duration_seconds,direct_request_price_cents,scheduled_for,created_at';

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('resposta vazia do servidor');
  return res.data;
}

// --------------------------------------------------------------- repertório

export async function listSongs(): Promise<SongRow[]> {
  return unwrap(
    await getSupabase()
      .from('songs')
      .select('id,title,artist_name,is_active,times_played')
      .order('title'),
  );
}

export async function createSong(ownerId: string, title: string, artistName: string) {
  return unwrap(
    await getSupabase()
      .from('songs')
      .insert({ owner_id: ownerId, title: title.trim(), artist_name: artistName.trim() })
      .select('id,title,artist_name,is_active,times_played')
      .single(),
  );
}

export async function deleteSong(id: string) {
  const { error } = await getSupabase().from('songs').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// -------------------------------------------------------------------- shows

export async function listShows(): Promise<ShowRow[]> {
  return unwrap(
    await getSupabase().from('shows').select(SHOW_COLUMNS).order('created_at', { ascending: false }),
  );
}

export async function getShow(id: string): Promise<ShowRow> {
  return unwrap(await getSupabase().from('shows').select(SHOW_COLUMNS).eq('id', id).single());
}

/** O join_code é gerado por trigger no banco — não mandamos nada daqui. */
export async function createShow(
  ownerId: string,
  input: { title: string; venue?: string; city?: string },
) {
  return unwrap(
    await getSupabase()
      .from('shows')
      .insert({
        owner_id: ownerId,
        title: input.title.trim(),
        venue: input.venue?.trim() || null,
        city: input.city?.trim() || null,
        status: 'draft',
      })
      .select('id,join_code')
      .single(),
  );
}

export async function setShowStatus(id: string, status: ShowStatus) {
  const patch: Record<string, unknown> = { status };
  if (status === 'live') patch.started_at = new Date().toISOString();
  if (status === 'ended') patch.ended_at = new Date().toISOString();
  const { error } = await getSupabase().from('shows').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

// ----------------------------------------------------- repertório do show

export async function listShowSongs(showId: string): Promise<ShowSongRow[]> {
  const res = await getSupabase()
    .from('show_songs')
    .select('id,song_id,status,songs(title,artist_name)')
    .eq('show_id', showId);
  return unwrap(res) as unknown as ShowSongRow[];
}

export async function addSongsToShow(showId: string, songIds: string[]) {
  if (songIds.length === 0) return;
  const { error } = await getSupabase()
    .from('show_songs')
    .upsert(
      songIds.map((song_id) => ({ show_id: showId, song_id })),
      { onConflict: 'show_id,song_id', ignoreDuplicates: true },
    );
  if (error) throw new Error(error.message);
}

// ------------------------------------------------------------------ rodadas

export async function currentRound(showId: string): Promise<RoundRow | null> {
  const { data, error } = await getSupabase()
    .from('rounds')
    .select('id,seq,status,closes_at,total_votes,total_weight,winner_candidate_id')
    .eq('show_id', showId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Toda ação de rodada passa por RPC, nunca por UPDATE direto: as funções
 * carregam as regras (uma rodada ativa por show, desempate, carência de
 * apuração) e checam a posse do show.
 */
export async function openRound(showId: string, songIds: string[], durationSeconds?: number) {
  const { error } = await getSupabase().rpc('open_round', {
    p_show_id: showId,
    p_song_ids: songIds,
    p_duration_seconds: durationSeconds ?? null,
    p_label: null,
  });
  if (error) throw new Error(error.message);
}

export async function closeRoundVoting(roundId: string) {
  const { error } = await getSupabase().rpc('close_round_voting', { p_round_id: roundId });
  if (error) throw new Error(error.message);
}

export async function settleRound(roundId: string, force = false) {
  const { error } = await getSupabase().rpc('settle_round', {
    p_round_id: roundId,
    p_force: force,
  });
  if (error) throw new Error(error.message);
}

/** Rede de segurança caso o pg_cron esteja fora: o painel faz a rodada andar. */
export async function tickRounds() {
  const { error } = await getSupabase().rpc('tick_rounds');
  if (error) throw new Error(error.message);
}
