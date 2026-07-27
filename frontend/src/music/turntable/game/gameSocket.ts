// The 问答游戏 shares the same Socket.IO server as the buzzer.
export { connectQuizSocket as connectGameSocket } from "../quiz/quizSocket";

export function buildGamePlayerUrl(token: string): string {
  if (typeof window === "undefined") return "";
  if (window.location.port === "5173") {
    return `${window.location.origin}/#/music/turntable/game?token=${token}`;
  }
  return `${window.location.origin}/game?token=${token}`;
}
