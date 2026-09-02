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
	# (fresh install, or the trial existed before this feature shipped),
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
