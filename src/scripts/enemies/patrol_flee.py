# patrol_flee.py — Coward: flees from players, attacks only when cornered
#
# Injected globals (read-only):
#   state, hp, max_hp, x, y, spawn_x, spawn_y, memory, nearby_players,
#   aggro_range, power, random
#
# Actions: move(dx, dy), attack(player_id), set_state(s), speak(text),
#          set_memory(key, val)
#
# description:
# Patrols near spawn in 'idle'. When a player enters aggro_range, switches
# to 'fleeing' and runs in the opposite direction. If cornered (player
# adjacent), panic-attacks. Returns to 'idle' once the player is safely
# beyond 1.5× aggro_range.
# Ideal for: goblin scouts, giant spiders, thieves, dark mages, water spirits,
# ghosts, necromancers.

WANDER_RADIUS = 5
FLEE_LINES = ['Help!', 'Run!', 'Back off!', 'Eek!', 'Not today!']

# ── idle ─────────────────────────────────────────────────────────────────────
if state == 'idle':
    closest = None
    closest_dist = aggro_range + 1
    for p in nearby_players:
        d = max(abs(p['x'] - x), abs(p['y'] - y))
        if d <= aggro_range and d < closest_dist:
            closest, closest_dist = p, d

    if closest:
        set_state('fleeing')
        set_memory('flee_from_id', closest['id'])
        if random.random() < 0.30:
            speak(random.choice(FLEE_LINES))
    else:
        dist_from_spawn = max(abs(x - spawn_x), abs(y - spawn_y))
        if dist_from_spawn > WANDER_RADIUS:
            dx = 1 if spawn_x > x else (-1 if spawn_x < x else 0)
            dy = 1 if spawn_y > y else (-1 if spawn_y < y else 0)
            move(dx, dy)
        elif random.random() < 0.40:
            move(random.randint(-1, 1), random.randint(-1, 1))

# ── fleeing ──────────────────────────────────────────────────────────────────
elif state == 'fleeing':
    # Prefer stored target, fall back to nearest visible player
    threat = None
    for p in nearby_players:
        if p['id'] == memory.get('flee_from_id'):
            threat = p
            break
    if not threat and nearby_players:
        threat = nearby_players[0]

    if not threat:
        # No player in sight — safe to return to patrol
        set_state('idle')
    else:
        dist = max(abs(threat['x'] - x), abs(threat['y'] - y))

        if dist > aggro_range * 1.5:
            # Far enough — de-escalate
            set_state('idle')
        elif dist <= 1:
            # Cornered — panic-attack
            attack(threat['id'])
        else:
            # Move directly away; add slight jitter to avoid wall-hugging
            dx = -1 if threat['x'] > x else (1 if threat['x'] < x else 0)
            dy = -1 if threat['y'] > y else (1 if threat['y'] < y else 0)
            if dx == 0:
                dx = random.choice([-1, 0, 1])
            if dy == 0:
                dy = random.choice([-1, 0, 1])
            move(dx, dy)
