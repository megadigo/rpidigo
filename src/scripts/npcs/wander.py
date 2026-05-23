# wander.py — Basic NPC wander behaviour
#
# Injected globals (read-only):
#   state           str   — current FSM state
#   hp / max_hp     int
#   x / y           int   — current tile position
#   spawn_x/spawn_y int   — home tile position (homeX/homeY from NpcInstance)
#   memory          dict  — persisted across ticks
#   nearby_players  list[dict{ id, name, x, y, level }]
#   aggro_range     int   — used here as the wander radius
#
# Action callbacks:
#   move(dx, dy)          — move one step (collision checked)
#   speak(text)           — emit a proximity chat message
#   set_state(s)          — change FSM state
#   set_memory(key, val)  — persist a value

dist_from_home = max(abs(x - spawn_x), abs(y - spawn_y))

if dist_from_home > aggro_range:
    # Drift back toward home
    dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
    dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
    move(dx, dy)
else:
    # Wander randomly with a 40 % chance each tick
    if random.random() < 0.4:
        move(random.randint(-1, 1), random.randint(-1, 1))
