extends "res://scripts/multiplayer_world.gd"

var can_transition: bool = false
var _dialogue_was_open: bool = false

func _ready() -> void:
	super._ready()
	await spawn_world_npcs()
	_sync_trial_givers()
	await get_tree().create_timer(0.3).timeout
	can_transition = true

func _process(_delta: float) -> void:
	if global.player_in_range and can_transition and not Dialogue.is_open and not _dialogue_was_open and not global.ui_blocked() and Input.is_action_just_pressed("interact"):
		can_transition = false
		global.request_transition("village", "PlayerSpawn")
		Loader.change_scene("res://scenes/village.tscn", "Loading")
	_dialogue_was_open = Dialogue.is_open

# A Trial-giver (Ridit/Wren/Rill/Cass) hides from the open world once their
# Trial is accepted, they've relocated to the village to check in on the
# player, and reappears once it's completed, with a one-time "welcome back"
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
