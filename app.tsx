import React, { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

type Player = "red" | "blue";
type Seat = Player | "spectator";
type PieceKind = "rock" | "paper" | "scissors";
type BattleResult = "win" | "lose";
type ConnectionStatus = "config-missing" | "loading" | "connected" | "error";
type Cell = Piece | null;
type Board = Cell[][];

type Position = {
  row: number;
  col: number;
};

type Piece = {
  id: string;
  player: Player;
  kind: PieceKind;
};

type Move = Position & {
  battle?: BattleResult;
};

type HistoryItem = {
  text: string;
  player: Player;
};

type GameState = {
  board: Board;
  turn: Player;
  captured: Piece[];
  history: HistoryItem[];
  result: string | null;
  turnNumber: number;
};

type GameRow = {
  id: string;
  state: GameState;
  version: number;
  red_player: string | null;
  blue_player: string | null;
  updated_at?: string;
};

const SIZE = 9;
const ROOM_ID_LENGTH = 6;
const PLAYER_STORAGE_KEY = "ott-v2-player-id";
const PIECES: Record<PieceKind, { name: string; symbol: string; short: string }> = {
  rock: { name: "Đấm", symbol: "✊", short: "Đ" },
  paper: { name: "Lá", symbol: "✋", short: "L" },
  scissors: { name: "Kéo", symbol: "✌", short: "K" },
};
const PLAYER_LABEL: Record<Player, string> = {
  red: "Đỏ",
  blue: "Xanh",
};
const PLAYER_FULL: Record<Player, string> = {
  red: "Đội Đỏ",
  blue: "Đội Xanh",
};
const HOME_ROW: PieceKind[] = [
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
  "rock",
  "paper",
  "scissors",
];
const GOAL_SQUARES: Record<Player, Position> = {
  red: { row: 0, col: 0 },
  blue: { row: SIZE - 1, col: SIZE - 1 },
};
const PIECE_KINDS = Object.keys(PIECES) as PieceKind[];

function other(player: Player): Player {
  return player === "red" ? "blue" : "red";
}

function createPiece(player: Player, kind: PieceKind, index: number): Piece {
  return { id: `${player}-${kind}-${index}`, player, kind };
}

function createGame(): GameState {
  const board = Array.from({ length: SIZE }, () => Array<Cell>(SIZE).fill(null));

  HOME_ROW.forEach((kind, col) => {
    board[0][col] = createPiece("blue", kind, col);
    board[SIZE - 1][SIZE - 1 - col] = createPiece("red", kind, col);
  });

  return {
    board,
    turn: "red",
    captured: [],
    history: [],
    result: null,
    turnNumber: 1,
  };
}

function inBounds(row: number, col: number) {
  return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

function squareName(row: number, col: number) {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function countPieces(board: Board, player: Player) {
  return board.flat().filter((piece) => piece?.player === player).length;
}

function countPieceKind(board: Board, player: Player, kind: PieceKind) {
  return board.flat().filter((piece) => piece?.player === player && piece.kind === kind).length;
}

function missingPieceKind(board: Board, player: Player) {
  return PIECE_KINDS.find((kind) => countPieceKind(board, player, kind) === 0);
}

function isGoalSquare(player: Player, position: Position) {
  const goal = GOAL_SQUARES[player];
  return goal.row === position.row && goal.col === position.col;
}

function battle(attacker: PieceKind, defender: PieceKind): BattleResult {
  if (
    (attacker === "rock" && defender === "scissors") ||
    (attacker === "scissors" && defender === "paper") ||
    (attacker === "paper" && defender === "rock")
  ) {
    return "win";
  }
  return "lose";
}

function legalMoves(game: GameState, from: Position): Move[] {
  const piece = game.board[from.row]?.[from.col];
  if (!piece || piece.player !== game.turn || game.result) return [];

  const moves: Move[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue;
      const row = from.row + dr;
      const col = from.col + dc;
      if (!inBounds(row, col)) continue;

      const target = game.board[row][col];
      if (!target) {
        moves.push({ row, col });
      } else if (target.player !== piece.player && target.kind !== piece.kind) {
        moves.push({ row, col, battle: battle(piece.kind, target.kind) });
      }
    }
  }
  return moves;
}

function hasMove(game: GameState, player: Player) {
  const scopedGame = { ...game, turn: player, result: null };
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (legalMoves(scopedGame, { row, col }).length > 0) return true;
    }
  }
  return false;
}

function formatAction(piece: Piece, from: Position, move: Move, target: Piece | null) {
  const prefix = `${PLAYER_LABEL[piece.player]} ${PIECES[piece.kind].name}`;
  const route = `${squareName(from.row, from.col)} → ${squareName(move.row, move.col)}`;
  if (!target) return `${prefix} đi ${route}`;

  const defender = PIECES[target.kind].name;
  if (move.battle === "win") return `${prefix} thắng ${defender} tại ${squareName(move.row, move.col)}`;
  return `${prefix} thua ${defender} tại ${squareName(move.row, move.col)}`;
}

function winnerFromResult(result: string | null): Player | null {
  if (!result) return null;
  if (result.includes(PLAYER_FULL.red)) return "red";
  if (result.includes(PLAYER_FULL.blue)) return "blue";
  return null;
}

function applyMove(game: GameState, from: Position, move: Move): GameState {
  const board = cloneBoard(game.board);
  const piece = board[from.row][from.col];
  const target = board[move.row][move.col];
  if (!piece) return game;

  const captured = [...game.captured];
  board[from.row][from.col] = null;

  if (!target) {
    board[move.row][move.col] = piece;
  } else if (move.battle === "win") {
    captured.push(target);
    board[move.row][move.col] = piece;
  } else if (move.battle === "lose") {
    captured.push(piece);
  }

  const nextTurn = other(game.turn);
  const nextGame: GameState = {
    board,
    turn: nextTurn,
    captured,
    history: [
      { text: formatAction(piece, from, move, target), player: piece.player },
      ...game.history,
    ].slice(0, 10),
    result: null,
    turnNumber: game.turnNumber + 1,
  };

  const attackerSurvived = board[move.row][move.col]?.id === piece.id;
  const missingDefenderKind = missingPieceKind(board, nextTurn);
  const missingAttackerKind = missingPieceKind(board, piece.player);
  if (attackerSurvived && isGoalSquare(piece.player, move)) {
    nextGame.result = `${PLAYER_FULL[piece.player]} thắng vì đưa quân vào ô ${squareName(move.row, move.col)}`;
  } else if (target && move.battle === "win" && missingDefenderKind) {
    nextGame.result = `${PLAYER_FULL[piece.player]} thắng vì ăn sạch quân ${PIECES[missingDefenderKind].name} của ${PLAYER_FULL[nextTurn]}`;
  } else if (target && move.battle === "lose" && missingAttackerKind) {
    nextGame.result = `${PLAYER_FULL[nextTurn]} thắng vì ăn sạch quân ${PIECES[missingAttackerKind].name} của ${PLAYER_FULL[piece.player]}`;
  } else if (!hasMove(nextGame, nextTurn)) {
    nextGame.result = `${PLAYER_FULL[piece.player]} thắng vì ${PLAYER_FULL[nextTurn]} hết nước đi`;
  }

  return nextGame;
}

function isGameState(value: unknown): value is GameState {
  const state = value as GameState;
  return Array.isArray(state?.board) && state.board.length === SIZE && state.turnNumber > 0;
}

function normalizeRow(row: Record<string, unknown>): GameRow {
  return {
    id: String(row.id),
    state: isGameState(row.state) ? row.state : createGame(),
    version: typeof row.version === "number" ? row.version : 1,
    red_player: typeof row.red_player === "string" ? row.red_player : null,
    blue_player: typeof row.blue_player === "string" ? row.blue_player : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : undefined,
  };
}

function makeRandomId(length: number) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function getPlayerId() {
  const existing = localStorage.getItem(PLAYER_STORAGE_KEY);
  if (existing) return existing;

  const playerId = `player-${makeRandomId(16)}`;
  localStorage.setItem(PLAYER_STORAGE_KEY, playerId);
  return playerId;
}

function getRoomId() {
  const url = new URL(window.location.href);
  const existing = url.searchParams.get("room");
  if (existing) return existing.toLowerCase();

  const roomId = makeRandomId(ROOM_ID_LENGTH);
  url.searchParams.set("room", roomId);
  window.history.replaceState({}, "", url.toString());
  return roomId;
}

function seatForPlayer(row: GameRow | null, playerId: string): Seat {
  if (row?.red_player === playerId) return "red";
  if (row?.blue_player === playerId) return "blue";
  return "spectator";
}

async function ensureRoom(roomId: string) {
  if (!supabase) throw new Error("Supabase chưa được cấu hình");

  const { data: existing, error: selectError } = await supabase
    .from("ott_games")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return normalizeRow(existing);

  const { data: inserted, error: insertError } = await supabase
    .from("ott_games")
    .insert({
      id: roomId,
      state: createGame(),
      version: 1,
    })
    .select("*")
    .maybeSingle();

  if (!insertError && inserted) return normalizeRow(inserted);

  const { data: retry, error: retryError } = await supabase
    .from("ott_games")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();

  if (retryError || !retry) throw retryError ?? insertError ?? new Error("Không thể tạo phòng");
  return normalizeRow(retry);
}

async function claimSeat(row: GameRow, playerId: string) {
  if (!supabase) return row;
  if (row.red_player === playerId || row.blue_player === playerId) return row;

  if (!row.red_player) {
    const { data } = await supabase
      .from("ott_games")
      .update({ red_player: playerId })
      .eq("id", row.id)
      .is("red_player", null)
      .select("*")
      .maybeSingle();
    if (data) return normalizeRow(data);
  }

  if (!row.blue_player) {
    const { data } = await supabase
      .from("ott_games")
      .update({ blue_player: playerId })
      .eq("id", row.id)
      .is("blue_player", null)
      .select("*")
      .maybeSingle();
    if (data) return normalizeRow(data);
  }

  const { data: latest } = await supabase.from("ott_games").select("*").eq("id", row.id).maybeSingle();
  return latest ? normalizeRow(latest) : row;
}

export function App() {
  const [roomId] = useState(getRoomId);
  const [playerId] = useState(getPlayerId);
  const [record, setRecord] = useState<GameRow | null>(null);
  const [selected, setSelected] = useState<Position | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(
    isSupabaseConfigured ? "loading" : "config-missing"
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [winEffect, setWinEffect] = useState<string | null>(null);

  const game = record?.state ?? createGame();
  const seat = seatForPlayer(record, playerId);
  const winner = winnerFromResult(winEffect);
  const canMove = seat === game.turn && !game.result && !isSaving && status === "connected";
  const moves = useMemo(
    () => (selected && canMove ? legalMoves(game, selected) : []),
    [canMove, game, selected]
  );
  const moveMap = useMemo(
    () => new Map(moves.map((move) => [`${move.row}-${move.col}`, move])),
    [moves]
  );
  const redCount = countPieces(game.board, "red");
  const blueCount = countPieces(game.board, "blue");

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function load() {
      try {
        setStatus("loading");
        const room = await ensureRoom(roomId);
        const seatedRoom = await claimSeat(room, playerId);
        if (cancelled) return;
        setRecord(seatedRoom);
        setStatus("connected");
        setError("");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setError(err instanceof Error ? err.message : "Không thể kết nối Supabase");
      }
    }

    load();

    const channel = supabase
      .channel(`ott-games-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ott_games", filter: `id=eq.${roomId}` },
        (payload) => {
          if (!payload.new || cancelled) return;
          setRecord(normalizeRow(payload.new as Record<string, unknown>));
          setSelected(null);
          setIsSaving(false);
          setStatus("connected");
        }
      )
      .subscribe((nextStatus) => {
        if (nextStatus === "CHANNEL_ERROR") {
          setStatus("error");
          setError("Realtime channel bị lỗi. Hãy kiểm tra bảng đã bật Realtime chưa.");
        }
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [playerId, roomId]);

  useEffect(() => {
    if (!game.result || !record || status !== "connected") {
      if (!game.result) setWinEffect(null);
      return;
    }

    setWinEffect(game.result);

    const timer = window.setTimeout(() => {
      persistState(createGame()).finally(() => {
        setSelected(null);
        setWinEffect(null);
      });
    }, 4200);

    return () => window.clearTimeout(timer);
  }, [game.result, record?.id, record?.version, status]);

  async function persistState(nextState: GameState) {
    if (!supabase || !record) return;

    const nextVersion = record.version + 1;
    setIsSaving(true);
    setError("");

    const { data, error: updateError } = await supabase
      .from("ott_games")
      .update({
        state: nextState,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", roomId)
      .eq("version", record.version)
      .select("*");

    if (updateError) {
      setIsSaving(false);
      setStatus("error");
      setError(updateError.message);
      return;
    }

    const updated = data?.[0];
    if (!updated) {
      setIsSaving(false);
      setStatus("error");
      setError("Phòng đã có nước đi mới. Mình đã tải lại ván, hãy thử lại.");
      const { data: latest } = await supabase.from("ott_games").select("*").eq("id", roomId).maybeSingle();
      if (latest) {
        setRecord(normalizeRow(latest));
        setStatus("connected");
      }
      return;
    }

    setRecord(normalizeRow(updated));
    setIsSaving(false);
    setStatus("connected");
  }

  function chooseSquare(row: number, col: number) {
    const piece = game.board[row][col];
    const move = moveMap.get(`${row}-${col}`);

    if (selected && move && canMove) {
      persistState(applyMove(game, selected, move));
      setSelected(null);
      return;
    }

    if (piece?.player === seat && canMove) {
      setSelected({ row, col });
      return;
    }

    setSelected(null);
  }

  async function resetGame() {
    await persistState(createGame());
    setSelected(null);
    setWinEffect(null);
  }

  function createRoom() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", makeRandomId(ROOM_ID_LENGTH));
    window.location.assign(url.toString());
  }

  async function copyInviteLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1300);
  }

  return (
    <main className="ott-shell">
      <OttStyles />
      <section className="ott-topbar">
        <div>
          <p className="eyebrow">OTT v2 realtime</p>
          <h1>Oẳn tù tì chiến thuật</h1>
        </div>
        <div className="top-actions">
          <button className="reset-button primary-action" type="button" onClick={createRoom}>
            Tạo phòng
          </button>
          <button className="reset-button" type="button" onClick={copyInviteLink}>
            {copied ? "Đã copy" : "Mời bạn chơi"}
          </button>
          <button className="reset-button" type="button" onClick={resetGame} disabled={!record || isSaving}>
            Ván mới
          </button>
        </div>
      </section>

      {!isSupabaseConfigured ? (
        <section className="setup-card">
          <p className="label">Thiếu cấu hình</p>
          <h2>Cần thêm biến môi trường Supabase</h2>
          <p>
            Tạo file <code>.env.local</code> từ <code>.env.example</code>, điền
            <code> VITE_SUPABASE_URL</code> và <code> VITE_SUPABASE_ANON_KEY</code>, rồi chạy lại dev server.
          </p>
        </section>
      ) : (
        <section className="game-layout">
          <div className="board-frame">
            <div className="files top">
              {Array.from({ length: SIZE }, (_, i) => (
                <span key={i}>{String.fromCharCode(65 + i)}</span>
              ))}
            </div>
            <div className="ranked-board">
              <div className="ranks">
                {Array.from({ length: SIZE }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
              <div className="board" role="grid" aria-label="Bàn cờ OTT v2 9x9">
                {game.board.map((rank, row) =>
                  rank.map((piece, col) => {
                    const move = moveMap.get(`${row}-${col}`);
                    const isSelected = selected?.row === row && selected?.col === col;
                    const isGoal = isGoalSquare("red", { row, col }) || isGoalSquare("blue", { row, col });
                    const tone = (row + col) % 2 === 0 ? "light" : "dark";

                    return (
                      <button
                        key={`${row}-${col}`}
                        className={[
                          "square",
                          tone,
                          isGoal ? "goal" : "",
                          isSelected ? "selected" : "",
                          move ? "target" : "",
                          move?.battle ? `battle-${move.battle}` : "",
                        ].join(" ")}
                        type="button"
                        role="gridcell"
                        aria-label={`${squareName(row, col)}${piece ? ` ${PIECES[piece.kind].name} ${PLAYER_FULL[piece.player]}` : ""}`}
                        onClick={() => chooseSquare(row, col)}
                      >
                        {piece ? (
                          <span className={`piece ${piece.player}`}>
                            <span className="piece-symbol">{PIECES[piece.kind].symbol}</span>
                            <span className="piece-tag">{PIECES[piece.kind].short}</span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="ranks right">
                {Array.from({ length: SIZE }, (_, i) => (
                  <span key={i}>{i + 1}</span>
                ))}
              </div>
            </div>
            <div className="files">
              {Array.from({ length: SIZE }, (_, i) => (
                <span key={i}>{String.fromCharCode(65 + i)}</span>
              ))}
            </div>
          </div>

          <aside className="panel">
            <div className="status-row">
              <span className={`turn-stone ${game.turn}`} />
              <div>
                <p className="label">Lượt hiện tại</p>
                <strong>{PLAYER_FULL[game.turn]}</strong>
              </div>
            </div>

            <div className="room-box">
              <p className="label">Phòng</p>
              <strong>{roomId}</strong>
              <span>{seat === "spectator" ? "Bạn đang xem" : `Bạn là ${PLAYER_FULL[seat]}`}</span>
            </div>

            <div className="message">
              {error ||
                game.result ||
                (status === "loading"
                  ? "Đang tải phòng..."
                  : isSaving
                    ? "Đang lưu nước đi..."
                    : seat === "spectator"
                      ? "Phòng đã đủ 2 người, bạn đang xem ván"
                      : canMove
                        ? selected
                          ? "Chọn ô đích liền kề để đi hoặc giao chiến"
                          : "Đến lượt bạn"
                        : "Chờ đối thủ đi")}
            </div>

            <div className="score-grid">
              <div>
                <p className="label">Đội Đỏ</p>
                <strong>{redCount}</strong>
              </div>
              <div>
                <p className="label">Đội Xanh</p>
                <strong>{blueCount}</strong>
              </div>
            </div>

            <div className="rules">
              <p className="label">Luật nhanh</p>
              <div className="rule-chain">
                <span>✊ thắng ✌</span>
                <span>✌ thắng ✋</span>
                <span>✋ thắng ✊</span>
              </div>
              <p>Mỗi quân đi đúng 1 ô theo 8 hướng như quân vua. Hai quân cùng loại không ăn nhau, chỉ chặn ô. Đỏ thắng khi vào A1, Xanh thắng khi vào I9, hoặc khi ăn sạch một loại quân của đối phương.</p>
            </div>

            <div>
              <p className="label">Quân bị loại</p>
              <div className="captured">
                {game.captured.length
                  ? game.captured.map((piece, index) => (
                      <span className={`captured-piece ${piece.player}`} key={`${piece.id}-${index}`}>
                        {PIECES[piece.kind].symbol}
                      </span>
                    ))
                  : "Chưa có"}
              </div>
            </div>

            <div>
              <p className="label">Lịch sử</p>
              <ol className="history">
                {game.history.length
                  ? game.history.map((item, index) => (
                      <li className={item.player} key={`${item.text}-${index}`}>
                        {item.text}
                      </li>
                    ))
                  : <li>Chưa có nước đi</li>}
              </ol>
            </div>
          </aside>
        </section>
      )}

      {winEffect ? (
        <div className={`win-overlay ${winner ?? ""}`} role="status" aria-live="polite">
          <div className="burst-ring" />
          <div className="confetti-field" aria-hidden="true">
            {Array.from({ length: 28 }, (_, index) => (
              <span key={index} style={{ "--i": index } as React.CSSProperties} />
            ))}
          </div>
          <div className="win-card">
            <p className="eyebrow">Chiến thắng</p>
            <h2>{winner ? `${PLAYER_FULL[winner]} thắng!` : "Có người thắng!"}</h2>
            <p>{winEffect}</p>
            <span>Tự động tạo ván mới...</span>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function OttStyles() {
  return (
    <style>{`
      :root {
        color: #1d231f;
        background: #f3f0e7;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        background:
          linear-gradient(135deg, rgba(40, 129, 118, 0.16), transparent 34rem),
          linear-gradient(270deg, rgba(202, 79, 52, 0.14), transparent 30rem),
          #f3f0e7;
      }

      button {
        font: inherit;
      }

      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      code {
        border: 1px solid rgba(29, 35, 31, 0.18);
        border-radius: 6px;
        padding: 2px 5px;
        background: rgba(255, 255, 255, 0.56);
      }

      .ott-shell {
        width: min(1180px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 26px 0;
      }

      .ott-topbar {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
      }

      .top-actions {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 10px;
      }

      .eyebrow,
      .label {
        margin: 0 0 6px;
        color: #667069;
        font-size: 0.73rem;
        font-weight: 850;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        max-width: 760px;
        font-size: clamp(2rem, 6vw, 4.6rem);
        line-height: 0.95;
      }

      h2 {
        margin: 0 0 8px;
      }

      .reset-button {
        min-height: 42px;
        border: 2px solid #1d231f;
        border-radius: 8px;
        padding: 0 16px;
        background: #fffaf0;
        box-shadow: 4px 4px 0 #1d231f;
        color: #1d231f;
        cursor: pointer;
        font-weight: 850;
      }

      .reset-button:active {
        transform: translate(4px, 4px);
        box-shadow: none;
      }

      .primary-action {
        background: #1d231f;
        color: #fffaf0;
      }

      .setup-card {
        max-width: 760px;
        border: 2px solid #1d231f;
        border-radius: 8px;
        padding: 18px;
        background: rgba(255, 250, 240, 0.92);
        box-shadow: 5px 5px 0 rgba(29, 35, 31, 0.18);
      }

      .setup-card p {
        margin: 0;
        line-height: 1.5;
      }

      .game-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 320px;
        gap: 22px;
        align-items: start;
      }

      .board-frame {
        min-width: 0;
      }

      .ranked-board {
        display: grid;
        grid-template-columns: 24px minmax(280px, 760px) 24px;
        gap: 8px;
        align-items: center;
      }

      .board {
        display: grid;
        grid-template-columns: repeat(9, 1fr);
        width: min(100%, 760px);
        aspect-ratio: 1;
        border: 3px solid #1d231f;
        box-shadow: 8px 8px 0 rgba(29, 35, 31, 0.22);
        background: #1d231f;
      }

      .square {
        position: relative;
        display: grid;
        place-items: center;
        width: 100%;
        aspect-ratio: 1;
        border: 0;
        cursor: pointer;
      }

      .square.light {
        background: #efe3c6;
      }

      .square.dark {
        background: #82a388;
      }

      .square.selected {
        outline: 4px solid #2c4ddd;
        outline-offset: -4px;
      }

      .square.goal::before {
        content: "";
        position: absolute;
        inset: 8%;
        border: 3px solid rgba(255, 250, 240, 0.72);
        box-shadow: inset 0 0 0 3px rgba(29, 35, 31, 0.28);
      }

      .square.target::after {
        content: "";
        position: absolute;
        inset: 18%;
        border: 3px solid rgba(29, 35, 31, 0.5);
        border-radius: 999px;
        background: rgba(255, 250, 240, 0.42);
      }

      .square.battle-win::after {
        border-color: #166f4f;
        background: rgba(39, 170, 115, 0.34);
      }

      .square.battle-lose::after {
        border-color: #a3382c;
        background: rgba(218, 83, 65, 0.34);
      }

      .piece {
        z-index: 1;
        position: relative;
        display: grid;
        place-items: center;
        width: 72%;
        aspect-ratio: 1;
        border: 2px solid #1d231f;
        border-radius: 999px;
        box-shadow: 0 3px 0 rgba(29, 35, 31, 0.34);
      }

      .piece.red {
        background: #d94d3d;
        color: #fffaf0;
      }

      .piece.blue {
        background: #23867b;
        color: #fffaf0;
      }

      .piece-symbol {
        font-size: clamp(1.3rem, 4.7vw, 3.2rem);
        line-height: 1;
      }

      .piece-tag {
        position: absolute;
        right: -3px;
        bottom: -5px;
        display: grid;
        place-items: center;
        width: 22px;
        height: 22px;
        border: 2px solid #1d231f;
        border-radius: 999px;
        background: #fffaf0;
        color: #1d231f;
        font-size: 0.72rem;
        font-weight: 900;
      }

      .files {
        display: grid;
        grid-template-columns: repeat(9, 1fr);
        max-width: 760px;
        margin: 8px 32px 0;
        color: #667069;
        font-size: 0.78rem;
        font-weight: 850;
        text-align: center;
      }

      .files.top {
        margin: 0 32px 8px;
      }

      .ranks {
        display: grid;
        grid-template-rows: repeat(9, 1fr);
        height: 100%;
        color: #667069;
        font-size: 0.78rem;
        font-weight: 850;
        align-items: center;
      }

      .ranks.right {
        text-align: right;
      }

      .panel {
        display: grid;
        gap: 16px;
        padding: 18px;
        border: 2px solid #1d231f;
        border-radius: 8px;
        background: rgba(255, 250, 240, 0.92);
        box-shadow: 5px 5px 0 rgba(29, 35, 31, 0.18);
      }

      .status-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .turn-stone {
        width: 24px;
        height: 24px;
        border: 2px solid #1d231f;
        border-radius: 999px;
      }

      .turn-stone.red {
        background: #d94d3d;
      }

      .turn-stone.blue {
        background: #23867b;
      }

      .status-row strong {
        font-size: 1.45rem;
      }

      .room-box {
        border: 1px solid rgba(29, 35, 31, 0.24);
        border-radius: 8px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.34);
      }

      .room-box strong {
        display: block;
        margin-bottom: 4px;
        font-size: 1.55rem;
        letter-spacing: 0.08em;
      }

      .room-box span {
        color: #4b5550;
        font-weight: 760;
      }

      .message {
        min-height: 48px;
        border-left: 4px solid #d94d3d;
        padding: 10px 12px;
        background: #fff2cf;
        font-weight: 850;
      }

      .score-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      .score-grid > div {
        border: 1px solid rgba(29, 35, 31, 0.24);
        border-radius: 8px;
        padding: 10px;
        background: rgba(255, 255, 255, 0.34);
      }

      .score-grid strong {
        font-size: 2rem;
        line-height: 1;
      }

      .rules p:last-child {
        margin: 8px 0 0;
        color: #3f4742;
        line-height: 1.45;
      }

      .rule-chain {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .rule-chain span {
        border: 1px solid rgba(29, 35, 31, 0.24);
        border-radius: 999px;
        padding: 6px 9px;
        background: #f8efdb;
        font-weight: 800;
      }

      .captured {
        min-height: 36px;
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        color: #667069;
      }

      .captured-piece {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 1px solid rgba(29, 35, 31, 0.32);
        border-radius: 999px;
        filter: grayscale(0.15);
      }

      .captured-piece.red {
        background: rgba(217, 77, 61, 0.2);
      }

      .captured-piece.blue {
        background: rgba(35, 134, 123, 0.2);
      }

      .history {
        display: grid;
        gap: 6px;
        max-height: 190px;
        margin: 0;
        padding-left: 1.2rem;
        overflow: auto;
        font-size: 0.9rem;
      }

      .history li.red::marker {
        color: #d94d3d;
      }

      .history li.blue::marker {
        color: #23867b;
      }

      .win-overlay {
        position: fixed;
        inset: 0;
        z-index: 20;
        display: grid;
        place-items: center;
        padding: 24px;
        overflow: hidden;
        background: rgba(29, 35, 31, 0.72);
        animation: overlay-in 260ms ease-out both;
      }

      .burst-ring {
        position: absolute;
        width: min(72vmin, 620px);
        aspect-ratio: 1;
        border: 4px solid rgba(255, 250, 240, 0.82);
        border-radius: 999px;
        animation: burst-ring 1300ms ease-out infinite;
      }

      .confetti-field {
        position: absolute;
        inset: 0;
        pointer-events: none;
      }

      .confetti-field span {
        --spread: calc((var(--i) - 14) * 3.4vw);
        position: absolute;
        top: -24px;
        left: calc(50% + var(--spread));
        width: 10px;
        height: 18px;
        border: 2px solid rgba(29, 35, 31, 0.42);
        border-radius: 3px;
        background: #f4c84f;
        transform: rotate(calc(var(--i) * 17deg));
        animation: confetti-fall 1800ms ease-in infinite;
        animation-delay: calc((var(--i) % 9) * 110ms);
      }

      .confetti-field span:nth-child(3n) {
        background: #d94d3d;
      }

      .confetti-field span:nth-child(3n + 1) {
        background: #23867b;
      }

      .win-card {
        position: relative;
        width: min(520px, 100%);
        border: 3px solid #1d231f;
        border-radius: 8px;
        padding: 26px;
        background: #fffaf0;
        box-shadow: 9px 9px 0 rgba(29, 35, 31, 0.42);
        text-align: center;
        animation: win-pop 520ms cubic-bezier(.2, 1.24, .4, 1) both;
      }

      .win-card h2 {
        margin: 0;
        font-size: clamp(2rem, 8vw, 4.2rem);
        line-height: 0.95;
      }

      .win-card p:not(.eyebrow) {
        margin: 14px 0 12px;
        color: #3f4742;
        font-weight: 800;
        line-height: 1.45;
      }

      .win-card span {
        display: inline-block;
        border: 2px solid #1d231f;
        border-radius: 999px;
        padding: 8px 12px;
        background: #fff2cf;
        font-weight: 900;
      }

      .win-overlay.red .win-card {
        border-color: #a3382c;
      }

      .win-overlay.blue .win-card {
        border-color: #166b64;
      }

      @keyframes overlay-in {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      @keyframes win-pop {
        from {
          opacity: 0;
          transform: translateY(18px) scale(0.92);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }

      @keyframes burst-ring {
        0% {
          opacity: 0.8;
          transform: scale(0.42);
        }
        100% {
          opacity: 0;
          transform: scale(1.2);
        }
      }

      @keyframes confetti-fall {
        0% {
          opacity: 0;
          transform: translateY(0) rotate(calc(var(--i) * 17deg));
        }
        16% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translateY(112vh) translateX(calc((var(--i) - 14) * 5px)) rotate(calc(var(--i) * 34deg));
        }
      }

      @media (max-width: 900px) {
        .game-layout {
          grid-template-columns: 1fr;
        }

        .panel {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @media (max-width: 560px) {
        .ott-shell {
          width: min(100vw - 20px, 1180px);
          padding: 14px 0;
        }

        .ott-topbar {
          align-items: start;
          flex-direction: column;
        }

        .top-actions {
          justify-content: flex-start;
        }

        .ranked-board {
          grid-template-columns: 16px minmax(0, 1fr) 16px;
          gap: 4px;
        }

        .files {
          margin-inline: 24px;
        }

        .piece-tag {
          display: none;
        }

        .panel {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  );
}
