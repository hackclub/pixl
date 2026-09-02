extends SceneTree
# Headless test for scripts/intro_cinematic.gd state machine. Run:
#   godot --headless --path . --script res://tests/test_cinematic.gd

var _fail := 0

func _initialize() -> void:
	_run()

func check(cond: bool, msg: String) -> void:
	if cond: print("  ok  ", msg)
	else:
		_fail += 1
		printerr("  FAIL ", msg)

func _frames(n: int) -> void:
	for i in n:
		await process_frame

func _run() -> void:
	var C = load("res://scripts/intro_cinematic.gd").new()
	root.add_child(C)
	await _frames(2)
	var panel_count: int = C.PANELS.size()

	# ── finished fires exactly once ────────────────────────────────────────
	var fires := [0]
	C.finished.connect(func(): fires[0] += 1)

	# ── play() starts on panel 0 with its first caption loaded ─────────────
	C.play()
	check(C._panel == 0, "play() starts on panel 0")
	check(C.visible, "cinematic visible while playing")
	check(C._caption.text == String(C.PANELS[0]["lines"][0]), "first caption line loaded")
	check(C._typing, "first line is typing")

	# ── _advance() snaps a typing line, then walks lines/panels ────────────
	C._advance()  # snap
	check(not C._typing and C._caption.visible_characters == C._type_len, "[E] snaps typing line to full")

	# Walk every line of every panel via _advance(); must end finished, once.
	var guard := 0
	while not C._done and guard < 200:
		C._advance()
		if C._typing:  # snap any freshly-started line so the next _advance moves on
			C._advance()
		guard += 1
	check(C._done, "advancing through all panels finishes")
	check(fires[0] == 1, "finished emitted exactly once")
	check(not C.visible, "hidden after finish")
	check(C._panel >= panel_count - 1, "reached the last panel")

	# ── skip() from mid-sequence finishes immediately, still once ──────────
	var C2 = load("res://scripts/intro_cinematic.gd").new()
	root.add_child(C2)
	await _frames(2)
	var fired2 := [0]
	C2.finished.connect(func(): fired2[0] += 1)
	C2.play()
	C2.next_panel()  # jump to panel 1
	check(C2._panel == 1, "next_panel advances index")
	C2.skip()
	check(C2._done and fired2[0] == 1, "skip() finishes once from mid-sequence")
	C2.skip()  # idempotent, must not re-fire
	check(fired2[0] == 1, "skip() is idempotent (no double finish)")

	if _fail == 0: print("\nALL CINEMATIC TESTS PASSED")
	else: printerr("\n", _fail, " TEST(S) FAILED")
	quit(_fail)
