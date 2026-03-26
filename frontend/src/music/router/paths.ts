export const MUSIC_ROOT_PATH = "/music";
export const MUSIC_PLAYER_PATH = "/music/music_player";
export const CHANGYOU_PATH = "/music/changyou";
export const CHANGYOU_ROOM_PATH = "/music/changyou/room";

export function getChangyouDetailPath(entryId: string | number) {
  return `${CHANGYOU_PATH}/${entryId}`;
}

export function getChangyouRoomPath(roomId: string) {
  return `${CHANGYOU_ROOM_PATH}/${roomId}`;
}
