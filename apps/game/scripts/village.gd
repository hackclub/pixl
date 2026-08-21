extends "res://scripts/multiplayer_world.gd"

# New Day-0 arrival flow (cinematic → Pixo greeting → naming → experience →
# first Trial). Launched here on first arrival; the GuideHud manual is separate.
const ONBOARDING := preload("res://scripts/onboarding.gd")
# Where the auto-spawned Trial check-in copies cluster in the village.
const DYNAMIC_NPC_BASE := Vector2(250, -60)

var can_transition: bool = false
var _dialogue_was_open: bool = false
var _npcs: Array = []
var _npcs_by_id: Dictionary = {}
var _dynamic_npcs: Array = []
var _save_accum: float = 0.0

func _ready() -> void:
	super._ready()
	await spawn_world_npcs()
	_spawn_npcs()
	if NetworkManager.is_connected_to_server():
		NetworkManager.npc_init.connect(_on_npc_init)
	_reveal_trial_npcs()
	await get_tree().create_timer(0.3).timeout
	can_transition = true
	_maybe_start_arrival()

# A Trial-giver's check-in copy (e.g. Ridit) is hidden until the player has
# accepted that Trial and not yet finished it. Reveal on load by matching each
# check-in NPC's trial_name against the player's active Trials, then spawn a
# generic check-in NPC for any other active Trial that has no hand-authored
# copy in this scene.
func _reveal_trial_npcs() -> void:
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
		var active := {}  # trial name -> true when unlocked and not completed
		for q in quests:
			if typeof(q) == TYPE_DICTIONARY and bool(q.get("unlocked", false)) and not bool(q.get("completed", false)):
				active[String(q.get("name", ""))] = true
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
	)
	if req.request(url) != OK:
		req.queue_free()

# Generic version of the hand-authored check-in pattern above: any Trial the
# player has accepted but not finished gets its giver NPC spawned into their
# own view of the village, without needing a scene-authored copy per Trial.
# Client-local only - never added to _npcs/_npcs_by_id, so _save_npcs() and the
# lobby's shared NPC position sync never see it. That's deliberate: a village
# is a shared lobby, so two players in it can have different accepted Trials
# at once, and each should only see their own Trial-givers show up.
func _spawn_dynamic_trial_npcs(quests: Array, skip_names: Dictionary) -> void:
	# For every Trial the player has accepted but not finished, drop a check-in
	# copy of its giver into the village: same name/look, showing the giver's
	# authored reminder line (npc_reminder from /api/sidequests). This is what
	# makes a Trial-giver "follow you home" while its open-world copy is hidden.
	# Skips Trials that already have a hand-authored check-in NPC in this scene.
	for n in _dynamic_npcs:
		if is_instance_valid(n):
			n.queue_free()
	_dynamic_npcs.clear()
	var i := 0
	for q in quests:
		if typeof(q) != TYPE_DICTIONARY:
			continue
		if not bool(q.get("unlocked", false)) or bool(q.get("completed", false)):
			continue
		var quest_name := String(q.get("name", ""))
		if quest_name == "" or skip_names.has(quest_name):
			continue
		var giver := String(q.get("npc_name", "")).strip_edges()
		if giver == "":
			giver = String(q.get("npc", "")).strip_edges()
		if giver == "":
			continue
		var reminder := String(q.get("npc_reminder", "")).strip_edges()
		if reminder == "":
			reminder = "Still working on \"%s\"? %s" % [quest_name, String(q.get("description", ""))]
		var inst = NPC_SCENE.instantiate()
		inst.npc_name = giver
		inst.skin = String(q.get("npc_skin", "cvc:1"))
		inst.quest_trial = true
		inst.trial_checkin = true
		inst.trial_name = quest_name
		inst.trial_reminder = reminder
		inst.quest_offer = reminder
		inst.dialogue = reminder
		# Wander like any other villager instead of standing frozen in a row: a
		# straight horizontal line (the old DYNAMIC_NPC_STEP.x per NPC) ran off
		# the grass into the water within 1-2 NPCs. A tight centered grid plus a
		# small wander radius keeps the whole cluster near the one spot
		# (DYNAMIC_NPC_BASE) that's actually safe, regardless of headcount.
		inst.wanders = true
		inst.wander_radius = 34.0
		var col := i % 3
		var row := i / 3
		inst.position = DYNAMIC_NPC_BASE + Vector2((col - 1) * 22.0, row * 22.0)
		add_child(inst)
		_dynamic_npcs.append(inst)
		if TrialFx.has_changed(quest_name, "active"):
			inst.play_teleport_fx()
		i += 1

# Decide whether to run the first-run arrival flow. Signed-in players are gated
# on the server's shared onboarding counter (step 0 = never onboarded), so a
# server-side reset re-triggers it. Signed-out / offline dev falls back to the
# old once-per-device slide-deck guide.
func _maybe_start_arrival() -> void:
	if NetworkManager.session_token == "":
		GuideHud.maybe_show_intro()
		return
	GuideHud.fetch_onboarding_step(func(step):
		# The step check is an HTTP round-trip; the player may have left the
		# village (Quit to Main Menu) before it lands. Don't start the flow onto
		# a scene we're no longer in.
		if step == 0 and is_inside_tree() and get_tree().current_scene == self:
			_start_arrival()
	)

func _start_arrival() -> void:
	var flow := ONBOARDING.new()
	add_child(flow)
	flow.finished.connect(func(): flow.queue_free())
	flow.start()

func _exit_tree() -> void:
	_save_npcs()

func _spawn_npcs() -> void:
	for child in get_children():
		if child.has_method("npc_id"):
			_npcs.append(child)
			_npcs_by_id[child.npc_id()] = child

func _on_npc_init(scene: String, npcs: Array) -> void:
	if scene != _network_scene_name():
		return
	for saved in npcs:
		var n = _npcs_by_id.get(saved["id"])
		if n:
			n.apply_saved_position(saved["pos"])

func _save_npcs() -> void:
	if not NetworkManager.is_connected_to_server():
		return
	var payload: Array = []
	for n in _npcs:
		# Skip hidden conditional NPCs (a not-yet-revealed check-in copy) so we
		# don't persist a placeholder position for them.
		if is_instance_valid(n) and n.visible:
			payload.append({"id": n.npc_id(), "posX": n.position.x, "posY": n.position.y})
	NetworkManager.send_save_npcs(_network_scene_name(), payload)

func _process(delta: float) -> void:
	_save_accum += delta
	if _save_accum >= 5.0:
		_save_accum = 0.0
		_save_npcs()
	if global.player_in_range and can_transition and not Dialogue.is_open and not _dialogue_was_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		if global.active_door_target == "shop":
			WebPages.open("shop")
			_dialogue_was_open = Dialogue.is_open
			return
		if global.active_door_target == "dashboard":
			WebPages.open("dashboard")
			_dialogue_was_open = Dialogue.is_open
			return
		if global.active_door_target == "lobbies":
			_save_npcs()
			get_tree().change_scene_to_file("res://scenes/lobby_menu.tscn")
			return
		if global.active_door_target == "character":
			global.editor_return_scene = "res://scenes/village.tscn"
			_save_npcs()
			get_tree().change_scene_to_file("res://scenes/character_editor.tscn")
			return
	_dialogue_was_open = Dialogue.is_open
