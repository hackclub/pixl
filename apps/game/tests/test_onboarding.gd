extends Node
# Headless integration test for scripts/onboarding.gd. Runs as a *scene* (not
# --script) so the project autoloads (global/Dialogue/NetworkManager/WebPages)
# that onboarding.gd depends on are actually present. Run:
#   godot --headless --path . res://tests/test_onboarding.tscn
# Drives the whole arrival flow in mock mode, auto-advancing dialogue, submitting
# the name overlay (with a rejected-name retry), and picking choices.

var _fail := 0
var _name_queue: Array = ["badword one", "Ridit"]  # first is rejected by the mock
var _names_submitted := 0
var _submitted_this_overlay := false

func _ready() -> void:
	_run()

func check(cond: bool, msg: String) -> void:
	if cond: print("  ok  ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

func _run() -> void:
	var O = load("res://scripts/onboarding.gd").new()
	O.mock = true
	O.skip_cinematic = true
	add_child(O)
	await get_tree().process_frame

	var done := [false]
	O.finished.connect(func(): done[0] = true)
	O.start()  # coroutine, runs alongside our driver loop

	var guard := 0
	while not done[0] and guard < 2000:
		_drive(O)
		await get_tree().process_frame
		guard += 1

	check(done[0], "flow reaches finished")
	check(_names_submitted >= 2, "rejected name re-prompts (overlay shown twice)")
	check(O.captured_name == "Ridit", "captured_name is the accepted name")
	check(O.captured_experience == "beginner", "captured_experience matches the picked option")
	check(O.handoff_path == "lobby_menu", "picking 'Open the Lobbies' routes to the lobby browser")
	check(not global.ui_blocked(), "ui blocker released at the end")

	if _fail == 0: print("\nALL ONBOARDING TESTS PASSED")
	else: printerr("\n", _fail, " TEST(S) FAILED")
	get_tree().quit(_fail)

# One driver tick: inject whatever input the current beat is waiting on.
func _drive(O) -> void:
	# 1. name overlay open → type the next queued name and submit (once).
	if O._name_root != null and O._name_edit != null:
		if not _submitted_this_overlay:
			var name: String = _name_queue[mini(_names_submitted, _name_queue.size() - 1)]
			O._name_edit.text = name
			O._submit_name_overlay()
			_names_submitted += 1
			_submitted_this_overlay = true
		return
	_submitted_this_overlay = false

	# 2. choice buttons up → always pick the first option.
	if Dialogue.is_open and Dialogue._choosing and Dialogue._choices.visible:
		Dialogue._on_choice(0)
		return

	# 3. any other open dialogue → advance (walks prompt lines / closes).
	if Dialogue.is_open:
		Dialogue.advance()
