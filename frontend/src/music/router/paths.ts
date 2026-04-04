export const MUSIC_ROOT_PATH = "/music";
export const MUSIC_PLAYER_PATH = "/music/music_player";
export const CHANGYOU_PATH = "/music/changyou";
export const CHANGYOU_ROOM_PATH = "/music/changyou/room";
export const CHANGYOU_PUBLIC_ROOM_PATH = "/changyou-room";
<<<<<<< HEAD
=======
export const CHANGYOU_PUBLIC_ROOM_V2_PATH = "/changyou-room-v2";
>>>>>>> 7410128 (update changyou)

export function getChangyouDetailPath(entryId: string | number) {
  return `${CHANGYOU_PATH}/${entryId}`;
}

export function getChangyouRoomPath(roomId: string) {
  return `${CHANGYOU_ROOM_PATH}/${roomId}`;
}

export function getChangyouPublicRoomPath(roomId: string) {
  return `${CHANGYOU_PUBLIC_ROOM_PATH}/${roomId}`;
}
<<<<<<< HEAD
=======

export function getChangyouPublicRoomV2Path(roomId: string) {
  return `${CHANGYOU_PUBLIC_ROOM_V2_PATH}/${roomId}`;
}
>>>>>>> 7410128 (update changyou)
