# patrol_persistent.py — Slow to notice, never gives up
#
# Injected globals (read-only):
#   state, hp, max_hp, x, y, spawn_x, spawn_y, memory, nearby_players,
#   aggro_range, power, random
#
# Actions: move(dx, dy), attack(player_id), set_state(s), speak(text),
#          set_memory(key, val)
#
# description:
# Only detects players at short range (aggro_range // 2), simulating limited
# awareness. Once triggered, enters 'hunting' and NEVER fully de-aggros:
# tracks last known player position and keeps moving toward it even when
# the player is out of sight. Only returns to idle after reaching the last
# known spot with no player visible and being close enough to spawn.
# Ideal for: zombies, mummies, armoured undead — slow but relentless.

NOTICE_RADIUS = max(1, aggro_range // 2)

# ── idle ─────────────────────────────────────────────────────────────────────
if state == 'idle':
    # Slow, oblivious patrol — only notices very close players
    target = None
    for p in nearby_players:
        if max(abs(p['x'] - x), abs(p['y'] - y)) <= NOTICE_RADIUS:
            target = p
            break

    if target:
        set_state('hunting')
        set_memory('last_x', target['x'])
        set_memory('last_y', target['y'])
    else:
        dist_from_spawn = max(abs(x - spawn_x), abs(y - spawn_y))
        if dist_from_spawn > aggro_range:
            dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
            dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
            move(dx, dy)
        elif random.random() < 0.30:
            move(random.randint(-1, 1), random.randint(-1, 1))

# ── hunting ──────────────────────────────────────────────────────────────────
elif state == 'hunting':
    # Update last known position whenever the player is visible
    target = None
    for p in nearby_players:
        target = p
        set_memory('last_x', p['x'])
        set_memory('last_y', p['y'])
        break

    lx = int(memory.get('last_x', spawn_x))
    ly = int(memory.get('last_y', spawn_y))

    if target:
        dist = max(abs(target['x'] - x), abs(target['y'] - y))
        if dist <= 1:
            attack(target['id'])
        else:
            dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)
            dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)
            move(dx, dy)
    else:
        # Shamble toward last known position
        dist_to_last = max(abs(lx - x), abs(ly - y))
        if dist_to_last <= 1:
            # Reached last known spot — player gone
            dist_from_spawn = max(abs(x - spawn_x), abs(y - spawn_y))
            if dist_from_spawn > aggro_range * 2:
                # Too far from home — reluctantly drift back
                dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
                dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
                move(dx, dy)
            else:
                set_state('idle')
        else:
            dx = 1 if lx > x else (-1 if lx < x else 0)
            dy = 1 if ly > y else (-1 if ly < y else 0)
            move(dx, dy)
