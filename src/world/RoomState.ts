/**
 * RoomState — tiny shared module for room-level flags that both GameScene and
 * PlayerController need to read/write without being directly coupled.
 */

/** True when a dungeon boss is aggroed — blocks all exits from the room. */
let _locked = false

export function setRoomLocked(v: boolean): void { _locked = v }
export function isRoomLocked(): boolean { return _locked }
