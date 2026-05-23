# patrol_chase.py — Standard enemy behaviour
#
# Injected globals (read-only):
#   state           str   — current FSM state
#   hp / max_hp     int
#   x / y           int   — current tile position
#   spawn_x/spawn_y int   — tile position where the entity was created
#   memory          dict  — persisted across ticks
#   nearby_players  list[dict{ id, name, x, y, level }]
#   aggro_range     int   — detection radius in tiles
#   power           int   — base damage dealt per attack
#
# Action callbacks:
#   move(dx, dy)          — move one step (collision checked)
#   attack(player_id)     — deal damage to a player
#   set_state(s)          — change FSM state
#   speak(text)           — emit a proximity chat message
#   set_memory(key, val)  — persist a value (str/int/float/bool/None only)

# description: 
# A simple enemy that idly wanders around until it detects a player,
# at which point it chases and attacks them.

if state == 'idle':
    found = None
    for p in nearby_players:
        if max(abs(p['x'] - x), abs(p['y'] - y)) <= aggro_range:
            found = p
            break
    if found:
        set_state('chasing')
        set_memory('target_id', found['id'])
    else:
        move(random.randint(-1, 1), random.randint(-1, 1))

elif state == 'chasing':
    target = None
    for p in nearby_players:
        if p['id'] == memory.get('target_id'):
            target = p
            break
    if target is None and nearby_players:
        target = nearby_players[0]
    if target is None:
        set_state('idle')
    else:
        dist = max(abs(target['x'] - x), abs(target['y'] - y))
        if dist > aggro_range * 2:
            set_state('idle')
        elif dist <= 1:
            attack(target['id'])
        else:
            dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)
            dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)
            move(dx, dy)
