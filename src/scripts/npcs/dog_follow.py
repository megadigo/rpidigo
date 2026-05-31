# dog_follow.py — Village dog NPC behaviour
#
# Injected globals (read-only):
#   state           str   — current FSM state ('idle' | 'following')
#   x / y           int   — current tile position
#   spawn_x/spawn_y int   — home tile (village centre vicinity)
#   memory          dict  — persisted across ticks
#   nearby_players  list[dict{ id, name, x, y, level }]
#   now_ms          int   — current wall-clock time in milliseconds
#
# Memory keys written externally (via E-key / DialogScene):
#   follow_player_id  str | None  — player ID to follow
#   last_interact_at  int         — ms timestamp of last E-key interaction
#
# Action callbacks:
#   move(dx, dy)          — move one step (collision checked)
#   speak(text)           — emit a proximity chat message
#   set_state(s)          — change FSM state
#   set_memory(key, val)  — persist a value

FOLLOW_TIMEOUT_MS = 300_000  # 5 minutes — dog loses interest
HOME_RADIUS       = 8        # max tiles to wander from spawn when idle
FOLLOW_GAP        = 2        # stay this many tiles away from the player

follow_id = memory.get('follow_player_id')
last_at   = memory.get('last_interact_at', 0)

if state == 'idle' or not follow_id:
    # Wander lazily near home
    dist = max(abs(x - spawn_x), abs(y - spawn_y))
    if dist > HOME_RADIUS:
        dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
        dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
        move(dx, dy)
    elif random.random() < 0.3:
        move(random.randint(-1, 1), random.randint(-1, 1))

elif state == 'following':
    # Lose interest after 5 minutes without re-interaction
    if now_ms - last_at > FOLLOW_TIMEOUT_MS:
        set_state('idle')
        set_memory('follow_player_id', None)
        speak('*wanders off*')
    else:
        target = None
        for p in nearby_players:
            if p['id'] == follow_id:
                target = p
                break

        if target is None:
            # Player out of vicinity — wait patiently
            pass
        else:
            dist = max(abs(target['x'] - x), abs(target['y'] - y))
            if dist > FOLLOW_GAP:
                dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)
                dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)
                move(dx, dy)
