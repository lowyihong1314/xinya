// 「别人眼中的我」 shares the same Socket.IO server as the buzzer / quiz game.
export { connectQuizSocket as connectMirrorSocket } from "../quiz/quizSocket";

export function buildMirrorPlayerUrl(token: string): string {
  if (typeof window === "undefined") return "";
  if (window.location.port === "5173") {
    return `${window.location.origin}/#/music/turntable/mirror?token=${token}`;
  }
  return `${window.location.origin}/mirror?token=${token}`;
}
