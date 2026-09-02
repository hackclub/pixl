# Trial-Giver Teleport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each Trial-giver NPC (Ridit, Wren, Rill, Cass) visibly teleport from the open world to the village the moment their Trial is accepted, and teleport back once it's completed, with a one-time pixel-dust burst per real transition.

**Architecture:** A new `play_teleport_fx()` method on the shared `npc.gd` script spawns a one-shot `CPUParticles2D` pixel-dust burst (built in code, like the existing `night_ambience.gd` firefly emitter). The live accept moment in `npc.gd` plays it directly. Scene-load syncs in `open_world.gd` (new) and `village.gd` (existing, extended) poll `/api/sidequests` and toggle each giver's presence, gated through a new `TrialFx` helper that persists last-seen state per trial per account in a local save file, so the burst only plays once per real transition instead of on every visit.

**Tech Stack:** Godot 4 / GDScript. This repo has no automated test suite for game code (see root `CLAUDE.md`), so verification steps use `godot --headless --check-only --script <path>` (parses a script for errors without running it, no display needed) instead of a test runner, plus a manual in-editor playtest at the end.

---

## Spec coverage checklist

- Teleport FX helper → Task 1
- One-time transition tracking (`TrialFx`) → Task 2
- Live accept-moment vanish → Task 3
- `open_world.gd` sync (hide on accept, reveal + fx on completion) → Task 4
- `village.gd` reveal + fx (hand-authored check-ins) → Task 5
- `village.gd` reveal + fx (dynamically-spawned check-ins) → Task 5
- Literal good-job `quest_done` copy for all 4 givers → Task 6
- Manual playtest of the full loop → Task 7

---

### Task 1: Teleport FX on `npc.gd`

**Files:**
- Modify: `apps/game/scripts/npc.gd:71` (add a static texture cache var)
- Modify: `apps/game/scripts/npc.gd:454-464` (append two new public methods after `set_present`)

- [ ] **Step 1: Add the cached dust texture var**

In `apps/game/scripts/npc.gd`, find this existing line (71):

```gdscript
var _last_pos: Vector2
```

Add a new line directly after it:

```gdscript
var _last_pos: Vector2
static var _dust_tex: ImageTexture
```

- [ ] **Step 2: Append the teleport FX methods**

At the end of `apps/game/scripts/npc.gd`, after the existing `set_present` function (which currently ends the file at line 464), add:

```gdscript

# One-shot pixel-dust burst used when a Trial-giver relocates between the open
# world and the village. Spawned on the parent (not self) so it keeps playing
# even if this call is immediately followed by set_present(false).
func play_teleport_fx() -> void:
	var fx := CPUParticles2D.new()
	fx.texture = _teleport_dust_texture()
	fx.z_index = 25
	fx.amount = 18
	fx.lifetime = 0.5
	fx.one_shot = true
	fx.explosiveness = 1.0
	fx.emission_shape = CPUParticles2D.EMISSION_SHAPE_SPHERE
	fx.emission_sphere_radius = 4.0
	fx.direction = Vector2(0, -1)
	fx.spread = 180.0
	fx.gravity = Vector2.ZERO
	fx.initial_velocity_min = 40.0
	fx.initial_velocity_max = 90.0
	fx.damping_min = 40.0
	fx.damping_max = 80.0
	fx.scale_amount_min = 1.0
	fx.scale_amount_max = 2.0
	fx.color = Color(1, 0.85, 0.1)
	var ramp := Gradient.new()
	ramp.offsets = PackedFloat32Array([0.0, 0.7, 1.0])
	ramp.colors = PackedColorArray([
		Color(1, 1, 1, 1), Color(1, 1, 1, 1), Color(1, 1, 1, 0),
	])
	fx.color_ramp = ramp
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	fx.material = mat
	var parent := get_parent()
	if parent == null:
		return
	parent.add_child(fx)
	fx.global_position = global_position + Vector2(0, -20)
	fx.emitting = true
	await get_tree().create_timer(fx.lifetime + 0.1).timeout
	fx.queue_free()

func _teleport_dust_texture() -> ImageTexture:
	if _dust_tex == null:
		var img := Image.create(4, 4, false, Image.FORMAT_RGBA8)
		img.fill(Color(1, 1, 1, 1))
		_dust_tex = ImageTexture.create_from_image(img)
	return _dust_tex
```

- [ ] **Step 3: Verify the script parses**

Run:
```bash
cd apps/game && godot --headless --path . --check-only --script scripts/npc.gd 2>&1
```
Expected: only the `Godot Engine v4.6...` banner line, no `SCRIPT ERROR` or `ERROR:` lines.

- [ ] **Step 4: Commit**

```bash
git add apps/game/scripts/npc.gd
git commit -m "add a pixel-dust teleport burst to npc.gd"
```

---

### Task 2: `TrialFx` one-time-transition tracker

**Files:**
- Create: `apps/game/scripts/trial_fx_state.gd`

- [ ] **Step 1: Write the helper**

Create `apps/game/scripts/trial_fx_state.gd`:

```gdscript
class_name TrialFx

# One-time-per-transition gate for the trial-giver teleport flourish.
# open_world.gd and village.gd both poll trial state on every scene load;
# without this, the reveal/hide burst would replay on every single visit
# instead of once per real accept/complete transition. State is persisted
# locally per Hack Club account (NetworkManager.user_id) so two accounts on
# the same device never share history.
const SAVE_PATH := "user://trial_fx_seen.cfg"

# Records current_state for trial_name and returns true only if it differs
# from what was last recorded for this trial (a real transition happened
# since this device last checked). Always persists, regardless of the result.
static func has_changed(trial_name: String, current_state: String) -> bool:
	var data := _load()
	var user_key := _user_key()
	var seen: Dictionary = data.get(user_key, {})
	var previous := String(seen.get(trial_name, ""))
	seen[trial_name] = current_state
	data[user_key] = seen
	_save(data)
	# previous == "" means this device has never recorded this trial before
	# (fresh install, or the trial existed before this feature shipped) ,
	# treated as a baseline, not a transition, so we don't fire a flourish
	# for something that didn't just happen.
	return previous != "" and previous != current_state

# Records current_state without checking for a change. Used right after the
# live in-game accept moment, so a later completion check has an accurate
# "active" baseline to compare against instead of an empty one.
static func mark(trial_name: String, current_state: String) -> void:
	var data := _load()
	var user_key := _user_key()
	var seen: Dictionary = data.get(user_key, {})
	seen[trial_name] = current_state
	data[user_key] = seen
	_save(data)

static func _user_key() -> String:
	return NetworkManager.user_id if NetworkManager.user_id != "" else "_offline"

static func _load() -> Dictionary:
	if not FileAccess.file_exists(SAVE_PATH):
		return {}
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		return {}
	var parsed = JSON.parse_string(f.get_as_text())
	f.close()
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}

static func _save(data: Dictionary) -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(data))
		f.close()
```

- [ ] **Step 2: Verify the script parses**

Run:
```bash
cd apps/game && godot --headless --path . --check-only --script scripts/trial_fx_state.gd 2>&1
```
Expected: only the banner line, no `SCRIPT ERROR` or `ERROR:` lines.

- [ ] **Step 3: Commit**

```bash
git add apps/game/scripts/trial_fx_state.gd
git commit -m "add TrialFx, a one-time-per-transition local state tracker"
```

---

### Task 3: Live accept-moment vanish

**Files:**
- Modify: `apps/game/scripts/npc.gd:400-405`

- [ ] **Step 1: Wire the fx + hide into the accept branch**

In `apps/game/scripts/npc.gd`, inside `_start_trial_quest()`, find:

```gdscript
	if choice == "accept":
		await _accept_trial(tid)
		Dialogue.open(npc_name, ["Then it's yours. Get building, I'll be around your village if you need me."])
		# Fresh accept → run the Builder Terminal walkthrough, tuned to this Trial.
		var accept_path := "projects?onboard=first-project&trial=%d" % tid if tid > 0 else "projects?onboard=first-project"
		Dialogue.closed.connect(func(): WebPages.open(accept_path), CONNECT_ONE_SHOT)
```

Replace with:

```gdscript
	if choice == "accept":
		await _accept_trial(tid)
		TrialFx.mark(trial_name, "active")
		play_teleport_fx()
		await get_tree().create_timer(0.35).timeout
		set_present(false)
		Dialogue.open(npc_name, ["Then it's yours. Get building, I'll be around your village if you need me."])
		# Fresh accept → run the Builder Terminal walkthrough, tuned to this Trial.
		var accept_path := "projects?onboard=first-project&trial=%d" % tid if tid > 0 else "projects?onboard=first-project"
		Dialogue.closed.connect(func(): WebPages.open(accept_path), CONNECT_ONE_SHOT)
```

- [ ] **Step 2: Verify the script parses**

Run:
```bash
cd apps/game && godot --headless --path . --check-only --script scripts/npc.gd 2>&1
```
Expected: only the banner line, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/game/scripts/npc.gd
git commit -m "make the open-world trial-giver visibly teleport away on accept"
```

---

### Task 4: `open_world.gd` presence sync

**Files:**
- Modify: `apps/game/scripts/open_world.gd` (entire file, currently 15 lines)

- [ ] **Step 1: Replace the file contents**

Current `apps/game/scripts/open_world.gd`:

```gdscript
extends "res://scripts/multiplayer_world.gd"

var can_transition: bool = false

func _ready() -> void:
	super._ready()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		Loader.change_scene("res://scenes/village.tscn", "Loading")
```

Replace it with:

```gdscript
extends "res://scripts/multiplayer_world.gd"

var can_transition: bool = false

func _ready() -> void:
	super._ready()
	_sync_trial_givers()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		Loader.change_scene("res://scenes/village.tscn", "Loading")

# A Trial-giver (Ridit/Wren/Rill/Cass) hides from the open world once their
# Trial is accepted , they've relocated to the village to check in on the
# player , and reappears once it's completed, with a one-time "welcome back"
# pixel-dust burst. Mirrors village.gd's _reveal_trial_npcs poll.
func _sync_trial_givers() -> void:
	if NetworkManager.session_token == "":
		return
	var req := HTTPRequest.new()
	add_child(req)
	var url := NetworkManager.SERVER_HTTP_URL + "/api/sidequests?token=" + NetworkManager.session_token.uri_encode()
	req.request_completed.connect(func(_result, code, _headers, data):
		req.queue_free()
		if code != 200 or data.size() == 0:
			return
		var json = JSON.parse_string(data.get_string_from_utf8())
		if typeof(json) != TYPE_DICTIONARY or not json.get("ok", false):
			return
		var quests = json.get("quests", [])
		if typeof(quests) != TYPE_ARRAY:
			return
		var state_by_name := {}
		for q in quests:
			if typeof(q) != TYPE_DICTIONARY:
				continue
			var qname := String(q.get("name", ""))
			if qname == "":
				continue
			var unlocked := bool(q.get("unlocked", false))
			var completed := bool(q.get("completed", false))
			state_by_name[qname] = "completed" if completed else ("active" if unlocked else "none")
		for child in get_children():
			if not (child.has_method("npc_id") and child.get("quest_trial") == true):
				continue
			var tn := String(child.get("trial_name"))
			if tn == "" or not state_by_name.has(tn):
				continue
			var state: String = state_by_name[tn]
			if state == "none":
				child.set_present(true)
				continue
			var changed := TrialFx.has_changed(tn, state)
			child.set_present(state != "active")
			if state == "completed" and changed:
				child.play_teleport_fx()
	)
	if req.request(url) != OK:
		req.queue_free()
```

- [ ] **Step 2: Verify the script parses**

Run:
```bash
cd apps/game && godot --headless --path . --check-only --script scripts/open_world.gd 2>&1
```
Expected: only the banner line, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/game/scripts/open_world.gd
git commit -m "hide/reveal open-world trial-givers based on trial state"
```

---

### Task 5: `village.gd` reveal fx (hand-authored + dynamic)

**Files:**
- Modify: `apps/game/scripts/village.gd:51-58` (hand-authored check-in loop)
- Modify: `apps/game/scripts/village.gd:87-102` (dynamic spawn loop)

- [ ] **Step 1: Add fx to the hand-authored check-in reveal**

In `apps/game/scripts/village.gd`, inside `_reveal_trial_npcs()`, find:

```gdscript
			var checkins: Array = _npcs.filter(func(n): return is_instance_valid(n) and n.get("trial_checkin") == true)
			var hand_authored := {}
			for n in checkins:
				if is_instance_valid(n):
					var tn := String(n.get("trial_name"))
					hand_authored[tn] = true
					n.set_present(active.has(tn))
			_spawn_dynamic_trial_npcs(quests, hand_authored)
```

Replace with:

```gdscript
			var checkins: Array = _npcs.filter(func(n): return is_instance_valid(n) and n.get("trial_checkin") == true)
			var hand_authored := {}
			for n in checkins:
				if is_instance_valid(n):
					var tn := String(n.get("trial_name"))
					hand_authored[tn] = true
					var is_active := active.has(tn)
					var changed := TrialFx.has_changed(tn, "active") if is_active else false
					n.set_present(is_active)
					if is_active and changed:
						n.play_teleport_fx()
			_spawn_dynamic_trial_npcs(quests, hand_authored)
```

- [ ] **Step 2: Add fx to the dynamic spawn loop**

Still in `apps/game/scripts/village.gd`, inside `_spawn_dynamic_trial_npcs()`, find:

```gdscript
		inst.position = DYNAMIC_NPC_BASE + DYNAMIC_NPC_STEP * i
		add_child(inst)
		_dynamic_npcs.append(inst)
		i += 1
```

Replace with:

```gdscript
		inst.position = DYNAMIC_NPC_BASE + DYNAMIC_NPC_STEP * i
		add_child(inst)
		_dynamic_npcs.append(inst)
		if TrialFx.has_changed(quest_name, "active"):
			inst.play_teleport_fx()
		i += 1
```

(Every NPC reaching this point is already filtered to `unlocked && !completed` earlier in the same loop, so it's always the "active" state - see the `continue` guard a few lines above this block.)

- [ ] **Step 3: Verify the script parses**

Run:
```bash
cd apps/game && godot --headless --path . --check-only --script scripts/village.gd 2>&1
```
Expected: only the banner line, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/game/scripts/village.gd
git commit -m "play a teleport burst when a trial check-in npc appears in the village"
```

---

### Task 6: Literal good-job `quest_done` copy

**Files:**
- Modify: `apps/game/scenes/open_world.tscn:5698` (Ridit)
- Modify: `apps/game/scenes/open_world.tscn:5710` (Wren)
- Modify: `apps/game/scenes/open_world.tscn:5722` (Rill)
- Modify: `apps/game/scenes/open_world.tscn:5734` (Cass)

- [ ] **Step 1: Update Ridit's line**

Find:
```
quest_done = "Mabel's wall is back up, partner. Proud of you. The frontier's wide open now, plenty more Trials where that came from."
```
Replace with:
```
quest_done = "Good job, partner. The frontier's proud of you."
```

- [ ] **Step 2: Update Wren's line**

Find:
```
quest_done = "Now that's a region I'd sign my name to. Nice work."
```
Replace with:
```
quest_done = "Good job, that draft came together exactly right."
```

- [ ] **Step 3: Update Rill's line**

Find:
```
quest_done = "Now I can see the well without hauling a bucket down first. That's real work, partner."
```
Replace with:
```
quest_done = "Good job. The well's finally got eyes on it."
```

- [ ] **Step 4: Update Cass's line**

Find:
```
quest_done = "Signal's still clean. You've got a knack for this, welcome to keeping the relay."
```
Replace with:
```
quest_done = "Good job. The relay's in good hands now."
```

- [ ] **Step 5: Sanity-check the scene file isn't corrupted**

Run:
```bash
grep -c 'quest_done = "Good job' apps/game/scenes/open_world.tscn
```
Expected: `4`

- [ ] **Step 6: Commit**

```bash
git add apps/game/scenes/open_world.tscn
git commit -m "rewrite trial-giver completion lines as literal good-job copy"
```

---

### Task 7: Manual playtest

There's no automated way to visually confirm particle effects or scene transitions from this environment. This task is a checklist for whoever next opens the project in the Godot editor (or plays an exported build):

- [ ] Open the project in the Godot editor, run `open_world.tscn` (or the full game from the main menu), and find Ridit.
- [ ] Interact with Ridit, choose "Accept this Trial". Confirm: a burst of gold pixel motes appears at Ridit's feet, then Ridit disappears (no longer visible, can't be interacted with) before the "Then it's yours..." dialogue line shows.
- [ ] Leave the Builder Terminal web overlay, walk to the village door, enter `village.tscn`. Confirm: the check-in Ridit is present near the village, and a pixel-dust burst played as the scene loaded (watch closely near scene fade-in, it's quick).
- [ ] Re-enter the village a second time (walk back out and back in) with the same trial still active. Confirm: Ridit is still present, but the burst does **not** replay this time (one-time-per-transition).
- [ ] With a test account, mark the trial's linked project as reviewed/approved from the dashboard (or directly flip `completed` for that `sidequest_unlocks` row in the DB for a throwaway test account) so the Trial shows `completed: true` from `/api/sidequests`.
- [ ] Re-enter `village.tscn`. Confirm: check-in Ridit is now gone (hidden, no burst, matches spec).
- [ ] Re-enter `open_world.tscn`. Confirm: Ridit is back, a "welcome back" pixel-dust burst plays once, and interacting with Ridit now shows the new "Good job, partner..." line.
- [ ] Re-enter `open_world.tscn` a second time. Confirm: Ridit is present but the burst does **not** replay.
- [ ] Repeat the accept step for one other giver (Wren, Rill, or Cass) to confirm the mechanism isn't Ridit-specific.

If any step fails, note which one and check the corresponding task above before moving on - this task has no code changes of its own, so there's nothing to commit here.
