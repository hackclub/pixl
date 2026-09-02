extends SceneTree
# Headless unit test for scripts/dialogue.gd. Run:
#   godot --headless --path . --script res://tests/test_dialogue.gd
# Instantiates the Dialogue script directly (not the autoload) and drives it.

var _fail := 0

func _initialize() -> void:
	_run()

func check(cond: bool, msg: String) -> void:
	if cond:
		print("  ok  ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

func _step() -> void:
	# Advance a few frames so _process (typewriter) and deferred UI run.
	for i in 5:
		await process_frame

# Pump frames until `pred` is true or we hit `budget` frames (guards against a
# hang if the condition never holds). Headless delta is tiny, so the typewriter
# reveals ~1 char/frame, a short line still needs a few dozen frames.
func _pump_until(pred: Callable, budget: int = 400) -> bool:
	for i in budget:
		if pred.call():
			return true
		await process_frame
	return pred.call()

func _run() -> void:
	var D = load("res://scripts/dialogue.gd").new()
	root.add_child(D)
	await _step()

	# ── 1. backward-compatible open() ──────────────────────────────────────
	check(not D.is_open, "starts closed")
	D.open("Pixo", ["Line one.", "Line two."])
	check(D.is_open, "open() sets is_open")
	check(D._body.text == "Line one.", "first line loaded")
	check(D._body.visible_characters == 0, "typewriter starts hidden")
	var done1 = await _pump_until(func(): return not D._typing)
	check(done1 and D._body.visible_characters >= D._type_len, "line finishes typing")

	# advance to second line, then close
	D.advance()
	check(D._body.text == "Line two.", "advance() moves to line two")
	var closed_fired := [false]
	D.closed.connect(func(): closed_fired[0] = true, CONNECT_ONE_SHOT)
	D.advance()
	check(not D.is_open, "advancing past last line closes")
	check(closed_fired[0], "closed signal fired")

	# ── 2. [E] snaps a typing line to full instead of advancing ─────────────
	D.open("Pixo", ["A longer line that is still typing.", "Second."])
	check(D._typing, "line is typing right after open")
	D._skip_or_advance()  # simulates [E]
	check(not D._typing and D._body.visible_characters == D._type_len, "[E] snaps to full")
	check(D._body.text.begins_with("A longer"), "did not advance while typing")
	D.close()

	# ── 3. ask() choice mode ────────────────────────────────────────────────
	var got := {"i": -99, "id": ""}
	D.chosen.connect(func(i, id): got["i"] = i; got["id"] = id, CONNECT_ONE_SHOT)
	D.ask("Pixo", ["How much have you built before?"],
		PackedStringArray(["Just starting", "A few things", "All the time"]),
		PackedStringArray(["beginner", "intermediate", "advanced"]))
	check(D.is_open and D._choosing, "ask() enters choosing mode")
	# prompt types on, then choices reveal (wait for the buttons to exist)
	var shown = await _pump_until(func(): return D._choices.visible and D._choices.get_child_count() == 3)
	check(shown and D._choices.visible, "choices become visible after prompt types")
	check(D._choices.get_child_count() == 3, "three choice buttons built")
	# simulate clicking the middle option
	D._on_choice(1)
	check(got["i"] == 1, "chosen emits picked index")
	check(got["id"] == "intermediate", "chosen emits matching id")
	check(not D.is_open, "picking closes the dialogue")
	check(not D._choosing, "choosing flag cleared after pick")

	# ── 3b. multi-line prompt in ask(): [E] must walk prompt lines then reveal
	var got2 := {"i": -99}
	D.chosen.connect(func(i, _id): got2["i"] = i, CONNECT_ONE_SHOT)
	D.ask("Pixo", ["One more thing, so I know how much to explain.", "How much have you built before?"],
		PackedStringArray(["A", "B"]), PackedStringArray(["a", "b"]))
	var typed1 = await _pump_until(func(): return not D._typing)
	check(typed1, "first prompt line finishes typing")
	check(not D._choices.visible, "choices hidden until the last prompt line")
	D.advance()  # [E] on line 1, must move to line 2, NOT be a no-op (the bug)
	check(D._body.text.begins_with("How much"), "[E] walks to the next prompt line in choice mode")
	var shown2 = await _pump_until(func(): return D._choices.visible and D._choices.get_child_count() == 2)
	check(shown2, "choices reveal after the final prompt line")
	D._on_choice(0)
	check(got2["i"] == 0, "multi-line ask still emits chosen")

	# ── 4. interact is ignored once buttons are up (no accidental advance) ──
	D.chosen.connect(func(_i, _id): pass, CONNECT_ONE_SHOT)
	D.ask("Pixo", [], PackedStringArray(["Only option"]), PackedStringArray(["x"]))
	await _step()
	D.advance()  # should be a no-op in choice mode
	check(D.is_open, "advance() is a no-op while choosing")
	D._on_choice(0)

	if _fail == 0:
		print("\nALL DIALOGUE TESTS PASSED")
	else:
		printerr("\n", _fail, " TEST(S) FAILED")
	quit(_fail)
