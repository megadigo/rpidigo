# patrol_pack.py — Pack coward: passive alone, aggressive when provoked
#
# Injected globals (read-only):
#   state, hp, max_hp, x, y, spawn_x, spawn_y, memory, nearby_players,
#   aggro_range, power, random
#
# Actions: move(dx, dy), attack(player_id), set_state(s), speak(text),
#          set_memory(key, val)
#
# description:
# In 'idle' the entity patrols passively and NEVER initiates combat.
# It stores its HP each tick (last_hp in memory). The moment HP drops
# (player landed a hit), it switches to 'alerted' and aggressively chases
# the nearest player — simulating pack courage: the fight started, so it
# joins. De-aggros only when no players are visible.
# Ideal for: weak bandits, cowardly humanoids that gain courage in a brawl.

WANDER_RADIUS = 4
ALERT_LINES = ["You'll pay for that!", 'Get them!', 'Attack!', 'For the pack!']

# ── idle ─────────────────────────────────────────────────────────────────────
if state == 'idle':
    last_hp = memory.get('last_hp', max_hp)

    if hp < last_hp:
        # We took a hit — wake up and fight back
        set_state('alerted')
        set_memory('last_hp', hp)
        if random.random() < 0.40:
            speak(random.choice(ALERT_LINES))
    else:
        set_memory('last_hp', hp)
        # Passive patrol near spawn; ignore all players
        dist_from_spawn = max(abs(x - spawn_x), abs(y - spawn_y))
        if dist_from_spawn > WANDER_RADIUS:
            dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
            dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
            move(dx, dy)
        elif random.random() < 0.40:
            move(random.randint(-1, 1), random.randint(-1, 1))

# ── alerted ──────────────────────────────────────────────────────────────────
elif state == 'alerted':
    set_memory('last_hp', hp)

    # Chase the nearest visible player
    target = None
    for p in nearby_players:
        target = p
        break

    if not target:
        # No players visible — cool down back to idle
        set_state('idle')
    else:
        dist = max(abs(target['x'] - x), abs(target['y'] - y))
        if dist <= 1:
            attack(target['id'])
        else:
            dx = 1 if target['x'] > x else (-1 if target['x'] < x else 0)
            dy = 1 if target['y'] > y else (-1 if target['y'] < y else 0)
            move(dx, dy)
