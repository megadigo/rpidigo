# patrol_only.py — Territorial guard
#
# Injected globals (read-only):
#   state, hp, max_hp, x, y, spawn_x, spawn_y, memory, nearby_players,
#   aggro_range, power, random
#
# Actions: move(dx, dy), attack(player_id), set_state(s), speak(text),
#          set_memory(key, val)
#
# description:
# Stays within a tight radius of its spawn point and never actively chases.
# Attacks only if a player steps directly adjacent (Chebyshev dist ≤ 1).
# Ideal for territorial/slow enemies: treants, river trolls, slimes, scorpions,
# skeletons, sand worms.

WANDER_RADIUS = 4  # tiles from spawn before drifting back

if state == 'idle':
    # --- 1. Attack any adjacent player (dist ≤ 1) ---
    adjacent = None
    for p in nearby_players:
        if max(abs(p['x'] - x), abs(p['y'] - y)) <= 1:
            adjacent = p
            break

    if adjacent:
        attack(adjacent['id'])
    else:
        dist_from_spawn = max(abs(x - spawn_x), abs(y - spawn_y))
        if dist_from_spawn > WANDER_RADIUS:
            # --- 2. Drift back toward spawn ---
            dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
            dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
            move(dx, dy)
        elif random.random() < 0.45:
            # --- 3. Lazy random wander ---
            move(random.randint(-1, 1), random.randint(-1, 1))
