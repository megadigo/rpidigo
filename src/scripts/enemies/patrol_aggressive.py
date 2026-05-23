# patrol_aggressive.py — Relentless aggressor
#
# Injected globals (read-only):
#   state, hp, max_hp, x, y, spawn_x, spawn_y, memory, nearby_players,
#   aggro_range, power, random
#
# Actions: move(dx, dy), attack(player_id), set_state(s), speak(text),
#          set_memory(key, val)
#
# description:
# Highly aggressive: detects players at full aggro_range and transitions to
# 'charging' immediately. Tracks the last known player position and continues
# moving toward it even when the player is temporarily out of sight.
# De-aggros only at 3× aggro_range — extremely persistent.
# Ideal for: dire wolves, bandit captains, enraged spirits, death knights,
# arch necromancers, wraiths, dungeon bosses.

CHARGE_LINES = ['CHARGE!', 'Kill!', 'No escape!', "You're mine!", 'Face me!']

# ── idle ─────────────────────────────────────────────────────────────────────
if state == 'idle':
    target = None
    for p in nearby_players:
        if max(abs(p['x'] - x), abs(p['y'] - y)) <= aggro_range:
            target = p
            break

    if target:
        set_state('charging')
        set_memory('target_id', target['id'])
        set_memory('last_x', target['x'])
        set_memory('last_y', target['y'])
        if random.random() < 0.25:
            speak(random.choice(CHARGE_LINES))
    else:
        # Wander freely — more movement than weaker enemies
        if random.random() < 0.55:
            move(random.randint(-1, 1), random.randint(-1, 1))

# ── charging ─────────────────────────────────────────────────────────────────
elif state == 'charging':
    # Prefer stored target, re-assign to nearest if lost
    target = None
    for p in nearby_players:
        if p['id'] == memory.get('target_id'):
            target = p
            break
    if not target and nearby_players:
        target = nearby_players[0]
        if target:
            set_memory('target_id', target['id'])

    if target:
        # Keep last known position fresh
        set_memory('last_x', target['x'])
        set_memory('last_y', target['y'])

        dist = max(abs(target['x'] - x), abs(target['y'] - y))
        if dist > aggro_range * 3:
            # Only give up when extremely far
            set_state('idle')
        elif dist <= 1:
            attack(target['id'])
        else:
            dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)
            dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)
            move(dx, dy)
    else:
        # Target out of sight — charge toward last known position
        lx = memory.get('last_x')
        ly = memory.get('last_y')
        if lx is not None and ly is not None:
            dist = max(abs(int(lx) - x), abs(int(ly) - y))
            if dist <= 1:
                set_state('idle')
            else:
                dx = 1 if int(lx) > x else (-1 if int(lx) < x else 0)
                dy = 1 if int(ly) > y else (-1 if int(ly) < y else 0)
                move(dx, dy)
        else:
            set_state('idle')
