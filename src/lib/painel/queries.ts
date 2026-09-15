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
  instagram_handle: string | null;
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
  'id,title,venue,city,status,join_code,vote_mode,instagram_handle,round_duration_seconds,direct_request_price_cents,scheduled_for,created_at';

/**
 * Desembrulha a resposta do supabase-js.
 *
 * O retorno é `NonNullable<T>` de propósito: sem isso a inferência aceita
 * `T = X | null` e o null vaza para quem chama, que passa a precisar de
 * checagem redundante — ou, pior, esquece dela.
 */
function unwrap<T>(res: { data: T | null; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null || res.data === undefined) {
    throw new Error('resposta vazia do servidor');
  }
  return res.data as NonNullable<T>;
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

/**
 * O join_code é gerado por trigger no banco — não mandamos nada daqui.
 * O tipo de retorno é explícito porque o cliente não carrega o schema tipado:
 * sem isso a inferência colapsa para `never` e o erro só aparece no consumo.
 */
export async function createShow(
  ownerId: string,
  input: {
    title: string;
    venue?: string;
    city?: string;
    voteMode: VoteMode;
    instagramHandle?: string | null;
  },
): Promise<{ id: string; join_code: string }> {
  return unwrap(
    await getSupabase()
      .from('shows')
      .insert({
        owner_id: ownerId,
        title: input.title.trim(),
        venue: input.venue?.trim() || null,
        city: input.city?.trim() || null,
        status: 'draft',
        vote_mode: input.voteMode,
        instagram_handle: input.instagramHandle || null,
      })
      .select('id,join_code')
      .single<{ id: string; join_code: string }>(),
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

export interface ParticipantRow {
  instagram_handle: string;
  nickname: string | null;
  votos: number;
  entrou_em: string;
}

/**
 * Quem participou do show, com o @ declarado.
 *
 * É o que o modo Instagram entrega de fato: não existe API que confirme que
 * alguém segue um perfil, então o valor está no registro — o artista cruza com
 * os próprios seguidores se quiser.
 */
export async function listParticipants(showId: string): Promise<ParticipantRow[]> {
  const { data, error } = await getSupabase().rpc('show_participants', {
    p_show_id: showId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ParticipantRow[];
}

export interface SummaryRoundRow {
  id: string;
  seq: number;
  label: string | null;
  status: string;
  settledAt: string | null;
  totalVotes: number;
  totalWeight: number;
  amountCents: number;
  winner: { title: string; artistName: string; weight: number; votes: number } | null;
  runnersUp: { title: string; weight: number }[];
}

export interface ShowSummary {
  show: {
    id: string;
    title: string;
    venue: string | null;
    city: string | null;
    status: ShowStatus;
    voteMode: VoteMode;
    joinCode: string;
    startedAt: string | null;
    endedAt: string | null;
  };
  totals: {
    rounds: number;
    participants: number;
    withInstagram: number;
    votes: number;
    amountCents: number;
  };
  rounds: SummaryRoundRow[];
}

/**
 * O que aconteceu na noite: rodadas, vencedoras e totais.
 *
 * Os totais vêm dos contadores denormalizados da rodada, a mesma fonte que
 * alimentou o placar ao vivo — somar as linhas de `votes` daria um número que
 * pode divergir do que a plateia viu, e aí o artista tem razão em desconfiar
 * dos dois.
 */
export async function getShowSummary(showId: string): Promise<ShowSummary> {
  const { data, error } = await getSupabase().rpc('show_summary', { p_show_id: showId });
  if (error) throw new Error(error.message);
  return data as ShowSummary;
}

export interface InstagramMetrics {
  funnel: { entered: number; clicked: number; declared: number; voted: number };
  newHandles: number;
  followers: { before: number | null; after: number | null };
}

/**
 * Funil do portão do Instagram.
 *
 * NÃO existe "seguidores ganhos" aqui, e a ausência é deliberada: nenhuma API
 * pública devolve o número de seguidores de um perfil. O que o app apura é o
 * funil; o antes/depois vem digitado pelo artista e a tela diz isso.
 */
export async function getInstagramMetrics(showId: string): Promise<InstagramMetrics> {
  const { data, error } = await getSupabase().rpc('show_instagram_metrics', {
    p_show_id: showId,
  });
  if (error) throw new Error(error.message);
  return data as InstagramMetrics;
}

export async function setInstagramFollowers(
  showId: string,
  patch: { before?: number | null; after?: number | null },
) {
  const update: Record<string, number | null> = {};
  if ('before' in patch) update.instagram_followers_before = patch.before ?? null;
  if ('after' in patch) update.instagram_followers_after = patch.after ?? null;
  const { error } = await getSupabase().from('shows').update(update).eq('id', showId);
  if (error) throw new Error(error.message);
}

/** Rede de segurança caso o pg_cron esteja fora: o painel faz a rodada andar. */
export async function tickRounds() {
  const { error } = await getSupabase().rpc('tick_rounds');
  if (error) throw new Error(error.message);
}
